import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createPaseoClient } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { codeReviewPreset } from '../shared/workflow-definition.ts';
const url = process.env.PASEO_TEAMS_SMOKE_URL,
  endpoint = new URL(url);
assert.ok(endpoint.hostname === '127.0.0.1' && endpoint.port && endpoint.port !== '6767');
const [mode, file] = process.argv.slice(2);
assert.ok(['start', 'verify'].includes(mode));
assert.match(file ?? '', /^\/tmp\/teams-.*\.json$/);
let proof = mode === 'start' ? { url } : JSON.parse(await readFile(file));
assert.equal(proof.url, url);
if (mode === 'start') await assert.rejects(readFile(file), { code: 'ENOENT' });
const save = () => writeFile(file, JSON.stringify(proof, null, 2));
const api = createPaseoClient({ url, reconnect: { enabled: false } }),
  raw = new DaemonClient({ url, clientId: randomUUID(), clientType: 'cli', appVersion: '0.16.2' });
const rpc = (n, i) => raw.invokePluginRpc('paseo-agent-teams', 'teams.' + n, i);
const timer = setTimeout(() => {
  console.error('360 s preset budget reached; preserve intents');
  process.exit(1);
}, 360000);
try {
  await api.connect();
  await raw.connect();
  if (mode === 'start') {
    const root = file.replace(/\.json$/, '');
    const legacyRepo = root + '/legacy';
    await mkdir(legacyRepo, { recursive: true });
    execFileSync('git', ['init', '-q', legacyRepo]);
    await writeFile(legacyRepo + '/README.md', 'Legacy fixture user file.\n');
    const ws = await api.workspaces.open(legacyRepo);
    proof.legacyWorkspace = ws.id;
    proof.legacyRepo = legacyRepo;
    const choices = await rpc('choices', { workspaceId: ws.id });
    const select = (provider, model, modeId) => {
      assert.ok(choices.find((p) => p.id === provider)?.models.some((m) => m.id === model));
      return { provider: provider + '/' + model, modeId };
    };
    const planner = select('claude', 'claude-sonnet-5-5', 'plan'),
      coder = select('codex', 'gpt-6.1-sol', 'full-access'),
      reviewer = select('claude', 'claude-haiku-5-5', 'plan');
    const tests = [
      {
        command:
          'node -e \'require("node:assert/strict").equal(require("node:fs").readFileSync("RESULT.txt","utf8"),"ok\\n")\'',
        timeoutMs: 5000,
      },
    ];
    const plan = {
      summary: 'Créer un résultat vérifiable',
      tasks: ['Créer RESULT.txt contenant ok suivi d’un saut de ligne'],
      acceptance: ['Test indépendant réussi', 'README.md inchangé'],
      tests,
    };
    proof.legacyIntent = {
      workspaceId: ws.id,
      requestId: randomUUID(),
      config: {
        version: 1,
        mode: 'auto',
        validation: 'autonomous',
        recovery: 'explicit',
        autoFix: false,
        maxCorrections: 0,
        testCommands: tests,
        roles: { planner, builder: coder, reviewer },
      },
      task:
        'Fixture V1 historique isolée. Planner retourne exactement ' +
        JSON.stringify(plan) +
        '. Code crée seulement RESULT.txt contenant ok suivi d’un saut de ligne et préserve README.md. Reviewer lit le fichier et les tests puis donne son verdict honnête. Aucun commit, réseau, push ou publication.',
    };
    await save();
    proof.legacyId = (await rpc('create', proof.legacyIntent)).id;
    await save();
    const end = Date.now() + 180000;
    let w;
    while (Date.now() < end) {
      w = (await rpc('list', { workspaceId: ws.id })).find((w) => w.id === proof.legacyId);
      if (w.status === 'awaiting_final') break;
      assert.ok(!['attention', 'permission'].includes(w.status), w.error);
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(w.status, 'awaiting_final');
    assert.equal(w.config.teamOrchestration, undefined);
    assert.equal(w.config.plannerFinalReview, undefined);
    assert.deepEqual(
      w.events.filter((e) => e.kind === 'dispatch').map((e) => e.role),
      ['planner', 'builder', 'reviewer'],
    );
    assert.equal(w.review.verdict, 'pass');
    assert.equal(w.tests[0].exitCode, 0);
    assert.equal(w.delivery.approvedAt, undefined);
    proof.legacyCheckpoint = await rpc('workflow_record', { id: w.id });
    await save();
    const repo = root + '/preset';
    await mkdir(repo, { recursive: true });
    execFileSync('git', ['init', '-q', repo]);
    await writeFile(repo + '/README.md', 'Code Review fixture user file.\n');
    const pws = await api.workspaces.open(repo);
    const owner = await pws.agents.create({
      config: { provider: 'agent-teams/auto' },
      title: 'Code ↔ Review — limite de correction',
      idempotencyKey: randomUUID(),
    });
    await owner.commands();
    proof.graphRepo = repo;
    proof.scope = { id: randomUUID(), workspaceId: pws.id, ownerAgentId: owner.id };
    const definition = codeReviewPreset({ code: coder, review: reviewer }, 0);
    definition.name = 'Code ↔ Review — zéro correction autorisée';
    for (const step of definition.steps)
      step.tests = [
        {
          command: step.id === 'code' ? 'test -s RESULT.txt && git diff --check' : 'git diff --check',
          timeoutMs: 5000,
        },
      ];
    const source = await rpc('save_definition', { workspaceId: pws.id, expectedRevision: 0, definition });
    const request = {
      workspaceId: pws.id,
      ownerAgentId: owner.id,
      definitionId: source.id,
      definitionRevision: source.revision,
      task: 'Fixture contrôlée de budget. Pour l’étape code, la tâche entière est de créer RESULT.txt contenant draft suivi d’un saut de ligne : cette tâche d’injection est terminée, remaining doit être vide. Ne le corrige pas encore. Pour l’étape review, le critère à juger est ready suivi d’un saut de ligne : refuse donc honnêtement draft avec une objection précise et rappelle que le test d’existence ne valide pas le contenu. Le budget zéro correction doit empêcher un second tour code. Préserve README.md. Aucun commit ou réseau.',
      language: 'fr',
    };
    const preview = await rpc('graph_preview', request);
    proof.graphIntent = { ...request, id: proof.scope.id, approveDefinition: true, confirmation: preview.confirmation };
    await save();
    await rpc('graph_confirm', proof.graphIntent);
    const deadline = Date.now() + 150000;
    let s;
    while (Date.now() < deadline) {
      s = await rpc('graph_record', { id: proof.scope.id, workspaceId: pws.id });
      if (['exhausted', 'failed', 'succeeded'].includes(s.status)) break;
      const result = await rpc('graph_advance', { ...proof.scope, expectedRevision: s.revision });
      assert.notEqual(result.status, 'blocked', result.reason);
      assert.ok(!['permission', 'uncertain'].includes(result.reason));
      if (result.status === 'waiting') await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(s.status, 'exhausted');
    assert.equal(s.nextStepId, 'code');
    assert.deepEqual(
      s.activations.map((a) => a.stepId),
      ['code', 'review'],
    );
    assert.deepEqual(
      s.activations.map((a) => a.result.outcome),
      ['success', 'failure'],
    );
    assert.ok(s.activations.every((a) => a.receipt?.turnId));
    const terminal = await rpc('graph_advance', { ...proof.scope, expectedRevision: s.revision });
    assert.equal(terminal.status, 'terminal');
    assert.deepEqual(terminal.state, s);
    proof.graphCheckpoint = s;
    proof.verified = true;
  } else {
    assert.deepEqual(await rpc('workflow_record', { id: proof.legacyId }), proof.legacyCheckpoint);
    assert.deepEqual(
      await rpc('graph_record', { id: proof.scope.id, workspaceId: proof.scope.workspaceId }),
      proof.graphCheckpoint,
    );
  }
  assert.equal(await readFile(proof.legacyRepo + '/README.md', 'utf8'), 'Legacy fixture user file.\n');
  assert.equal(await readFile(proof.graphRepo + '/README.md', 'utf8'), 'Code Review fixture user file.\n');
  assert.equal(await readFile(proof.graphRepo + '/RESULT.txt', 'utf8'), 'draft\n');
  await save();
  console.log('PASS presets ' + mode + ': ' + file);
} catch (error) {
  proof.failure = String(error);
  await save();
  throw error;
} finally {
  clearTimeout(timer);
  await raw.close();
  await api.close();
}
