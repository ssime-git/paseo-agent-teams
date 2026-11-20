import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createPaseoClient } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';

// Opt-in real-model acceptance path; never calls the primary daemon or publishes.
// Every human answer/approval is an explicit fixture submission, never a timeout.
const url = process.env.PASEO_TEAMS_SMOKE_URL;
const endpoint = new URL(url);
assert.ok(endpoint.protocol === 'ws:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname));
assert.ok(endpoint.port && endpoint.port !== '6767');
const [mode, file] = process.argv.slice(2);
assert.ok(['start', 'continue', 'approve-plan', 'approve-final', 'checkpoint', 'verify'].includes(mode));
assert.match(file ?? '', /^\/tmp\/teams-[^\n]+\.json$/);
let proof = mode === 'start' ? { url, events: [], intents: [] } : JSON.parse(await readFile(file, 'utf8'));
assert.equal(proof.url, url);
if (mode === 'start') await assert.rejects(readFile(file), { code: 'ENOENT' }, 'Never overwrite an existing attempt');
const save = () => writeFile(file, JSON.stringify(proof, null, 2));
const api = createPaseoClient({ url, reconnect: { enabled: false } });
const client = new DaemonClient({ url, clientId: randomUUID(), clientType: 'cli', appVersion: '0.16.2' });
const rpc = (name, input) => client.invokePluginRpc('paseo-agent-teams', 'teams.' + name, input);
const scope = () => ({ id: proof.id, workspaceId: proof.workspaceId, ownerAgentId: proof.ownerId });
const record = () => rpc('graph_record', { id: proof.id, workspaceId: proof.workspaceId });
const git = (...args) => execFileSync('git', ['-C', proof.repo, ...args], { encoding: 'utf8' }).trim();
const watchdog = setTimeout(() => {
  console.error('600 s bound exceeded; inspect saved intents, do not resend');
  process.exit(1);
}, 600000);
watchdog.unref();
async function response(state, submission) {
  const input = {
    ...scope(),
    expectedRevision: state.revision,
    operationId: state.activations.at(-1).operationId,
    submission,
  };
  proof.intents.push({ kind: 'response', input });
  await save();
  const next = await rpc('graph_response', input);
  assert.deepEqual(await rpc('graph_response', input), next);
  return next;
}
async function drive(stopAtTests = false) {
  await api.agents.ref(proof.ownerId).commands();
  const deadline = Date.now() + 360000;
  for (let count = 0; count < 700 && Date.now() < deadline; count++) {
    let state = await record();
    if (['waiting_human', 'succeeded', 'failed', 'exhausted'].includes(state.status)) return state;
    const result = await rpc('graph_advance', { ...scope(), expectedRevision: state.revision });
    state = result.state;
    proof.events.push({
      revision: state.revision,
      status: state.status,
      reason: result.reason,
      step: state.nextStepId,
    });
    await save();
    assert.ok(state.activations.length <= 11);
    if (result.reason === 'GRAPH_TESTS_FAILED') {
      assert.equal(state.activations.at(-1).stepId, 'draft');
      assert.equal(await readFile(proof.repo + '/RESULT.txt', 'utf8'), 'draft\n');
      proof.testFailure = state;
      if (stopAtTests) return state;
      await response(state, {
        action: 'reject_tests',
        decision: {
          id: randomUUID(),
          summary: 'Fixture: test réellement échoué, poursuivre vers la revue indépendante puis la correction.',
        },
      });
    } else {
      assert.notEqual(result.status, 'blocked', result.reason);
      assert.ok(
        !['permission', 'uncertain'].includes(result.reason),
        'Do not resolve or resend an uncertain operation',
      );
      if (result.status === 'waiting') await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw Error('Bounded graph deadline exceeded; preserve checkpoint');
}
try {
  await api.connect();
  await client.connect();
  if (mode === 'start') {
    proof.repo = file.replace(/\.json$/, '') + '/repo';
    await mkdir(proof.repo, { recursive: true });
    await writeFile(proof.repo + '/README.md', 'User README; preserve exactly.\n');
    await writeFile(
      proof.repo + '/check.cjs',
      "const a=require('node:assert/strict');a.equal(require('node:fs').readFileSync('RESULT.txt','utf8'),'Bonjour\\n');console.log('RESULT conforme');\n",
    );
    execFileSync('git', ['init', '-q', '-b', 'main', proof.repo]);
    git('add', 'README.md', 'check.cjs');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture');
    await writeFile(proof.repo + '/user-note.txt', 'User untracked note.\n');
    proof.head = git('rev-parse', 'HEAD');
    proof.initialStatus = git('status', '--porcelain');
    const ws = await api.workspaces.open(proof.repo);
    proof.workspaceId = ws.id;
    const choices = await rpc('choices', { workspaceId: ws.id });
    proof.choices = choices;
    const choose = (family, model, modeId) => {
      const p = choices.find((c) => c.id === family);
      assert.ok(
        p?.models.some((m) => m.id === model),
        family + '/' + model,
      );
      assert.ok(p.modes.some((m) => m.id === modeId));
      return { provider: family + '/' + model, modeId };
    };
    const planner = choose('claude', 'claude-sonnet-5-5', 'plan');
    const reviewer = choose('claude', 'claude-haiku-5-5', 'plan');
    const coder = choose('codex', 'gpt-6.1-sol', 'full-access');
    const owner = await ws.agents.create({
      config: { provider: 'agent-teams/auto' },
      title: 'Roadmap — parcours transversal',
      idempotencyKey: randomUUID(),
    });
    proof.ownerId = owner.id;
    proof.id = randomUUID();
    await owner.commands();
    const clarification = {
      kind: 'clarification',
      summary: 'Deux choix nécessaires avant le plan',
      questions: [
        {
          id: 'greeting',
          title: 'Quelle formule écrire dans le résultat ?',
          options: [
            { id: 'bonjour', label: 'Bonjour', tradeoff: 'Formule française courte et vérifiable' },
            { id: 'salut', label: 'Salut', tradeoff: 'Formule informelle' },
          ],
          recommendedOptionId: 'bonjour',
        },
        {
          id: 'scope',
          title:
            'Quel périmètre conserver pour cette vérification avec une consigne volontairement longue afin de contrôler son affichage sur téléphone ?',
          options: [
            {
              id: 'minimal',
              label: 'Un seul fichier, préserver les documents utilisateur',
              tradeoff: 'Limite les changements et facilite la vérification',
            },
            { id: 'large', label: 'Plusieurs fichiers', tradeoff: 'Élargit inutilement cet essai' },
          ],
          recommendedOptionId: 'minimal',
        },
      ],
    };
    const check = [{ command: 'node check.cjs', timeoutMs: 5000 }];
    const readonly = [{ command: 'git diff --check', timeoutMs: 5000 }];
    const plan = {
      intent: 'implementation',
      summary: 'Écrire Bonjour dans RESULT.txt en préservant les fichiers utilisateur',
      tasks: ['Créer RESULT.txt avec Bonjour suivi d’un saut de ligne'],
      acceptance: ['RESULT.txt vaut exactement Bonjour\\n', 'README.md et user-note.txt restent inchangés'],
      tests: check,
    };
    proof.expectedPlan = plan;
    const model = (id, instruction, selection, contract, tests, success, failure = null) => ({
      id,
      instruction,
      selection,
      contract,
      access: contract === 'build' ? 'write' : 'read-only',
      tests,
      transitions: [
        { outcome: 'success', target: success },
        { outcome: 'failure', target: failure },
      ],
    });
    const human = (id, instruction, success) => ({
      id,
      instruction,
      selection: { provider: 'human/decision', modeId: 'explicit' },
      contract: 'human',
      access: 'read-only',
      transitions: [
        { outcome: 'approve', target: success },
        { outcome: 'reject', target: null },
      ],
    });
    const definition = {
      version: 1,
      name: 'Clarification → plan Reviewer → Code ↔ Review',
      entry: 'clarify',
      maxTransitions: 11,
      steps: [
        model(
          'clarify',
          `Lecture seule, aucun outil nécessaire. Si le contexte ne contient pas encore les deux réponses enregistrées pour clarify, retourne exactement ${JSON.stringify(clarification)}. Après les deux réponses enregistrées, retourne exactement ce plan ${JSON.stringify(plan)}. Aucune réponse ne peut être supposée.`,
          planner,
          'plan',
          readonly,
          'review_plan',
        ),
        model(
          'review_plan',
          `Tu es le Reviewer du PLAN. Challenge le plan précédent en précisant le contrôle de préservation. Retourne un plan complet reprenant ses décisions et tests, avec le résumé « Plan révisé par le Reviewer » et une tâche supplémentaire « Vérifier README.md et user-note.txt après la correction ». Ne modifie rien. Aucun outil nécessaire.`,
          reviewer,
          'plan',
          readonly,
          'approve_plan',
        ),
        human(
          'approve_plan',
          'Approuver explicitement ce plan révisé avant le Code. Le silence ne vaut pas accord.',
          'draft',
        ),
        model(
          'draft',
          'Fixture négative contrôlée : crée seulement RESULT.txt avec draft suivi d’un saut de ligne, même si le plan exige Bonjour. Rapporte honnêtement ce défaut volontaire dans remaining. Ne corrige pas encore. Ne touche ni README.md ni user-note.txt. Aucun commit ni réseau.',
          coder,
          'build',
          check,
          'inspect',
          'inspect',
        ),
        model(
          'inspect',
          'Reviewer indépendant : lis RESULT.txt et les preuves de tests. Refuse toute valeur différente de Bonjour suivi d’un saut de ligne, en donnant une objection précise. Valide seulement la valeur exacte et la préservation des documents. Ne modifie rien, aucun commit ni réseau.',
          reviewer,
          'review',
          readonly,
          'final_human',
          'repair',
        ),
        model(
          'repair',
          'Réponds aux objections de la revue et à l’échec du test : remplace seulement RESULT.txt par Bonjour suivi d’un saut de ligne. Préserve README.md et user-note.txt. Rapporte les changements, remaining vide quand le code est corrigé. Aucun commit ni réseau.',
          coder,
          'build',
          check,
          'inspect',
        ),
        human(
          'final_human',
          'Valider le bilan et les preuves de cette fixture sans commit, publication ni livraison.',
          null,
        ),
      ],
    };
    const source = await rpc('save_definition', { workspaceId: ws.id, expectedRevision: 0, definition });
    proof.source = source;
    const launch = {
      workspaceId: ws.id,
      ownerAgentId: owner.id,
      definitionId: source.id,
      definitionRevision: source.revision,
      task: 'Essai intégré : clarification persistante, révision indépendante du plan, approbation explicite, défaut volontaire, tests et revue refusés, correction et bilan. Toutes les explications en français. Modifier seulement RESULT.txt après approbation ; aucun commit, réseau ou publication.',
      language: 'fr',
    };
    const preview = await rpc('graph_preview', launch);
    proof.launchIntent = { ...launch, id: proof.id, approveDefinition: true, confirmation: preview.confirmation };
    await save();
    proof.initial = await rpc('graph_confirm', proof.launchIntent);
    await save();
    proof.question = await drive();
    assert.equal(proof.question.status, 'waiting_human');
    assert.equal(proof.question.activations.length, 1);
    assert.equal(proof.question.activations[0].assessment.status, 'clarification');
    assert.equal(proof.question.activations[0].assessment.request.questions.length, 2);
  } else if (mode === 'checkpoint') {
    proof.checkpoint = await record();
    const active = proof.checkpoint.activations.at(-1);
    if (active.assessment?.status === 'clarification' && active.clarificationAnswers?.length) {
      const same = {
        ...scope(),
        expectedRevision: proof.checkpoint.revision,
        operationId: active.operationId,
        submission: { action: 'answer', answer: active.clarificationAnswers[0] },
      };
      assert.deepEqual(await rpc('graph_response', same), proof.checkpoint);
      const conflicting = {
        ...same,
        submission: { action: 'answer', answer: { ...active.clarificationAnswers[0], optionId: 'salut' } },
      };
      await assert.rejects(rpc('graph_response', conflicting), /answered differently/);
      assert.deepEqual(await record(), proof.checkpoint);
      proof.partialReplayAndConflict = true;
    }
    assert.ok(['waiting_human', 'ready', 'succeeded'].includes(proof.checkpoint.status));
    proof.native = {};
    for (const activation of proof.checkpoint.activations.filter((a) => a.dispatch)) {
      const page = await api.agents
        .ref(activation.dispatch.agentId)
        .timeline.refetch({ direction: 'before', limit: 120, projection: 'canonical' });
      assert.equal(
        page.entries.filter(
          (e) =>
            e.item.type === 'user_message' &&
            e.item.text.startsWith(`[agent-teams-operation:${activation.operationId}]`),
        ).length,
        1,
      );
      proof.native[activation.operationId] = {
        agentId: activation.dispatch.agentId,
        userMessages: page.entries.filter((e) => e.item.type === 'user_message').map((e) => e.item.text),
      };
    }
  } else if (mode === 'verify') {
    assert.deepEqual(await record(), proof.checkpoint);
    if (proof.checkpoint.status === 'waiting_human') {
      const stopped = await rpc('graph_advance', { ...scope(), expectedRevision: proof.checkpoint.revision });
      assert.equal(stopped.reason, 'human_response_required');
      assert.deepEqual(stopped.state, proof.checkpoint);
    }
    for (const [operationId, native] of Object.entries(proof.native)) {
      const page = await api.agents
        .ref(native.agentId)
        .timeline.refetch({ direction: 'before', limit: 120, projection: 'canonical' });
      assert.deepEqual(
        page.entries.filter((e) => e.item.type === 'user_message').map((e) => e.item.text),
        native.userMessages,
        operationId,
      );
    }
  } else {
    let state = await record();
    if (mode.startsWith('approve')) {
      const step = mode === 'approve-plan' ? 'approve_plan' : 'final_human';
      assert.equal(state.status, 'waiting_human');
      assert.equal(state.activations.at(-1).stepId, step);
      const input = {
        ...scope(),
        expectedRevision: state.revision,
        operationId: state.activations.at(-1).operationId,
        submission: {
          action: 'decide',
          decision: {
            id: randomUUID(),
            outcome: 'approve',
            summary: 'Accord explicite de la fixture isolée, sans livraison ou publication.',
          },
        },
      };
      proof.intents.push({ kind: mode, input });
      await save();
      const competing = {
        ...input,
        submission: {
          action: 'decide',
          decision: {
            id: randomUUID(),
            outcome: 'approve',
            summary: 'Accord concurrent volontaire pour vérifier une seule décision.',
          },
        },
      };
      const results = await Promise.allSettled([rpc('graph_response', input), rpc('graph_response', competing)]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const winner = results.find((r) => r.status === 'fulfilled').value;
      assert.equal(winner.activations.at(-1).humanDecision.outcome, 'approve');
      assert.deepEqual(await rpc('graph_response', results[0].status === 'fulfilled' ? input : competing), winner);
      proof[mode] = winner;
      await save();
    }
    state = await drive(mode === 'approve-plan');
    proof.last = state;
    if (mode === 'approve-final') {
      assert.equal(state.status, 'succeeded');
      assert.deepEqual(
        state.activations.map((a) => a.stepId),
        ['clarify', 'clarify', 'review_plan', 'approve_plan', 'draft', 'inspect', 'repair', 'inspect', 'final_human'],
      );
      assert.equal(state.activations[5].result.outcome, 'failure');
      assert.equal(state.activations[7].result.outcome, 'success');
      assert.ok(state.activations.filter((a) => a.dispatch).every((a) => a.receipt?.turnId));
      assert.ok(
        state.activations
          .filter(
            (a) => a.dispatch && state.source.definition.steps.find((s) => s.id === a.stepId).access === 'read-only',
          )
          .every((a) => a.integrity?.unchanged),
      );
      assert.equal(await readFile(proof.repo + '/RESULT.txt', 'utf8'), 'Bonjour\n');
      assert.equal(await readFile(proof.repo + '/README.md', 'utf8'), 'User README; preserve exactly.\n');
      assert.equal(await readFile(proof.repo + '/user-note.txt', 'utf8'), 'User untracked note.\n');
      assert.equal(git('rev-parse', 'HEAD'), proof.head);
      assert.equal(git('remote'), '');
      assert.equal(git('diff', '--cached', '--name-only'), '');
      assert.equal(git('diff', '--name-only'), '');
      proof.finalStatus = git('status', '--porcelain');
      proof.verified = true;
    } else if (mode === 'approve-plan') {
      assert.equal(state.activations.at(-1).stepId, 'draft');
      assert.ok(state.activations.at(-1).testRun.completion.results.some((t) => t.exitCode !== 0));
    } else assert.equal(state.status, 'waiting_human');
  }
  await save();
  console.log('PASS ' + mode + ': ' + file);
} catch (error) {
  proof.failure = String(error);
  await save();
  throw error;
} finally {
  clearTimeout(watchdog);
  await client.close();
  await api.close();
}
