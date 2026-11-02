import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createPaseoClient } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';

// Opt-in, bounded live test. The caller owns the isolated daemon lifecycle.
const url = process.env.PASEO_TEAMS_SMOKE_URL;
if (!url) throw Error('Set PASEO_TEAMS_SMOKE_URL to an isolated daemon; this test runs real models.');
const endpoint = new URL(url);
if (
  !['ws:', 'wss:'].includes(endpoint.protocol) ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
  !endpoint.port ||
  endpoint.port === '6767'
)
  throw Error('Use an explicit isolated loopback port, never primary port 6767');
const prepareFile = process.argv[2] === '--continue' ? process.argv[3] : undefined;
const resumeFile = prepareFile ? undefined : process.argv[2];
const existingFile = prepareFile ?? resumeFile;
const root = existingFile
  ? JSON.parse(await readFile(existingFile, 'utf8')).root
  : await mkdtemp('/tmp/teams-native-live-');
const proofFile = root + '/proof.json';
const api = createPaseoClient({ url, reconnect: { enabled: false } });
const client = new DaemonClient({
  url,
  clientId: randomUUID(),
  clientType: 'cli',
  appVersion: '0.13.0',
  reconnect: { enabled: false },
});
const rpc = (name, input) => client.invokePluginRpc('paseo-agent-teams', 'teams.' + name, input);
let proof, w;
const save = async () => writeFile(proofFile, JSON.stringify(proof, null, 2));
try {
  await api.connect();
  await client.connect();
  const read = async () =>
    (await rpc('list', { workspaceId: proof.workspaceId })).find((v) => v.id === proof.workflowId);
  const action = async (action, extra = {}) => {
    w = await read();
    w = await rpc('action', {
      id: w.id,
      workspaceId: proof.workspaceId,
      expectedRevision: w.revision,
      requestId: randomUUID(),
      action,
      ...extra,
    });
    return w;
  };
  const checkpoint = async (predicate) => {
    const deadline = Date.now() + 150000;
    do {
      w = await read();
      if (predicate(w)) return w;
      if (['attention', 'permission'].includes(w.status))
        throw Error(JSON.stringify({ status: w.status, error: w.error }));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } while (Date.now() < deadline);
    throw Error('Checkpoint deadline exceeded; inspect the isolated workflow, do not resend');
  };
  const native = async (role, prompt) => {
    const agent = api.agents.ref(w.agents[role]);
    const result = await agent.run(prompt, { timeoutMs: 120000, activeTurnBehavior: 'steer' });
    assert.equal(result.status, 'idle');
    proof.nativeTurns.push({ role, prompt, result });
    await save();
  };
  const noBuilderTurns = async () => {
    const page = await api.agents
      .ref(w.agents.builder)
      .timeline.refetch({ direction: 'before', limit: 100, projection: 'canonical' });
    assert.equal(page.agent.lastUserMessageAt, null);
    assert.equal(page.window.maxSeq, 0);
    assert.equal(page.entries.filter((e) => e.item.type === 'user_message').length, 0);
  };
  if (!resumeFile) {
    if (prepareFile) {
      proof = JSON.parse(await readFile(prepareFile, 'utf8'));
      assert.equal(proof.nativeTurns.length, 0, 'Preparation recovery only before the first native turn');
      delete proof.failure;
    } else {
      execFileSync('git', ['init', '-q', root]);
      await writeFile(root + '/README.md', 'User documentation; preserve exactly.\n');
      const workspace = await api.workspaces.open(root);
      const catalog = await rpc('catalog', { workspaceId: workspace.id });
      const select = (family, preferred, modeId) => {
        const provider = catalog.providers.find((p) => p.id === family);
        const model = provider?.models.find((m) => m.id === preferred) ?? provider?.models.find((m) => m.isDefault);
        assert.ok(model, family + ' model must be discovered');
        return { provider: family + '/' + model.id, modeId };
      };
      const config = {
        version: 1,
        mode: 'auto',
        validation: 'plan',
        recovery: 'explicit',
        maxCorrections: 1,
        roles: {
          planner: select('codex', 'gpt-6.1-sol', 'read-only'),
          builder: select('codex', 'gpt-6.1-sol', 'auto'),
          reviewer: select('claude', 'claude-opus-5-5', 'plan'),
        },
      };
      const clarification = {
        kind: 'clarification',
        summary: 'Choose documentation scope',
        questions: [
          {
            id: 'scope',
            title: 'Which documentation scope?',
            recommendedOptionId: 'small',
            options: [
              { id: 'small', label: 'One paragraph', tradeoff: 'Small, focused change' },
              { id: 'large', label: 'Full guide', tradeoff: 'Broader, longer change' },
            ],
          },
        ],
      };
      const task = `Read-only orchestration test. Plan documentation in a NEW file GUIDE.md; never edit README.md. No delegation, commits, network or shell execution. The human has not chosen the documentation scope. On your FIRST turn return exactly this clarification JSON: ${JSON.stringify(clarification)}. After the saved human answer, return a plan reflecting their choice with tests [{"command":"git diff --check","timeoutMs":10000}]. Never implement the plan yourself. No Builder is authorized until explicit Team approval.`;
      const created = await rpc('create', { workspaceId: workspace.id, task, config, requestId: randomUUID() });
      proof = { root, url, workspaceId: workspace.id, workflowId: created.id, config, nativeTurns: [], assertions: [] };
      await save();
      console.log(JSON.stringify({ proofFile, workflowId: created.id }));
    }
    await checkpoint((v) => v.status === 'attention' && v.clarifications?.some((q) => !q.resolvedAt));
    assert.equal(w.plan, undefined);
    await noBuilderTurns();
    await action('pause');
    const question = w.clarifications.find((q) => !q.resolvedAt);
    const answer = {
      workflowId: w.id,
      clarificationId: question.id,
      answers: [{ questionId: 'scope', optionId: 'small', text: 'One paragraph in GUIDE.md, preserve README.md.' }],
    };
    await native('planner', JSON.stringify(answer));
    await action('import_planner_answers');
    assert.equal(w.status, 'paused');
    assert.ok(w.clarifications[0].resolvedAt);
    await noBuilderTurns();
    assert.equal(w.testsApproved, false);
    proof.assertions.push('Native human JSON imported while paused; no Builder prompt or approval');
    await action('resume');
    await checkpoint((v) => v.status === 'awaiting_plan' && !!v.plan);
    assert.match(JSON.stringify(w.plan), /GUIDE\.md/);
    await action('followup', {
      purpose: 'plan_revision',
      message:
        'Discuss the plan without proposing changes yet. Return kind discussion, summary Scope considered. Stay read-only.',
    });
    await checkpoint((v) => v.status === 'awaiting_plan' && v.phase !== 'followup');
    await action('pause');
    const plan = { ...w.plan, summary: 'Native revision one: one paragraph in GUIDE.md' };
    const envelope = {
      workflowId: w.id,
      baseVersion: w.planVersions.at(-1).version,
      kind: 'proposal',
      summary: 'Keep scope explicit',
      plan,
    };
    await native(
      'reviewer',
      `Read-only test. Do not use tools. Return exactly this JSON, without commentary: ${JSON.stringify(envelope)}`,
    );
    const original = structuredClone(w.plan);
    await action('import_reviewer_plan');
    assert.deepEqual(w.plan, original);
    assert.deepEqual(w.planProposal.plan, plan);
    assert.equal(w.testsApproved, false);
    proof.beforeRestart = await rpc('workflow_record', { id: w.id });
    proof.assertions.push('Reviewer proposal imported without replacing plan or approving');
    await save();
    console.log('PASS preparation. Restart ONLY the isolated daemon, then rerun with ' + proofFile);
  } else {
    proof = JSON.parse(await readFile(resumeFile, 'utf8'));
    assert.equal(proof.url, url);
    assert.deepEqual(await rpc('workflow_record', { id: proof.workflowId }), proof.beforeRestart);
    try {
      await action('import_reviewer_plan');
      proof.restartImport = 'replayed';
    } catch (error) {
      // Some daemon/provider versions restore history without canonical turn IDs.
      // Keep the checkpoint intact; never invent provenance or resend the old prompt.
      assert.match(String(error), /No uniquely identified native response/);
      proof.restartImport = 'blocked: restored history has no unique native turn';
    }
    assert.deepEqual(await rpc('workflow_record', { id: w.id }), proof.beforeRestart);
    const plan = {
      ...w.planProposal.plan,
      summary: 'Native revision two: preserve README.md and create GUIDE.md',
      tests: [{ command: 'git diff --check -- README.md GUIDE.md', timeoutMs: 10000 }],
    };
    const envelope = {
      workflowId: w.id,
      baseVersion: w.planVersions.at(-1).version,
      kind: 'proposal',
      summary: 'Narrow verification to documentation files',
      plan,
    };
    await native(
      'reviewer',
      `Read-only test, second revision. Do not use tools. Return exactly this JSON: ${JSON.stringify(envelope)}`,
    );
    const oldVersions = structuredClone(w.planVersions);
    await action('import_reviewer_plan');
    assert.deepEqual(w.planVersions, oldVersions);
    assert.equal(w.events.filter((e) => e.kind === 'native_plan_imported').length, 2);
    await action('adopt_plan');
    assert.equal(w.status, 'paused');
    assert.deepEqual(w.plan, plan);
    assert.deepEqual(w.planVersions.slice(0, -1), oldVersions);
    assert.equal(w.planVersions.at(-1).source, 'reviewer');
    assert.ok(w.planVersions.at(-1).nativeSource);
    assert.equal(w.testsApproved, false);
    await action('resume');
    assert.equal(w.status, 'awaiting_plan');
    await noBuilderTurns();
    assert.equal(await readFile(root + '/README.md', 'utf8'), 'User documentation; preserve exactly.\n');
    delete proof.failure;
    proof.after = await rpc('workflow_record', { id: w.id });
    proof.assertions.push(
      'Checkpoint identical after caller restart; replay result recorded separately; a new explicit native proposal adopted; versions preserved; approval still required; no Builder prompt',
    );
    await save();
    console.log('PASS native checkpoints and explicit adoption; awaiting human plan approval. Proof: ' + proofFile);
  }
} catch (error) {
  if (proof) {
    proof.failure = String(error);
    await save();
  }
  throw error;
} finally {
  await api.close();
  await client.close();
}
