import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createPaseoClient } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';

// Opt-in live models, at most four native dispatches and five activations.
// The caller owns the isolated daemon lifecycle; failures never trigger resend.
const url = process.env.PASEO_TEAMS_SMOKE_URL;
assert.ok(url, 'Set PASEO_TEAMS_SMOKE_URL to an isolated daemon');
const endpoint = new URL(url);
assert.ok(
  ['ws:', 'wss:'].includes(endpoint.protocol) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) &&
    endpoint.port &&
    endpoint.port !== '6767',
  'Use an explicit isolated loopback port, never primary port 6767',
);
const mode = process.argv[2];
assert.ok(!mode || ['--continue', '--resume', '--verify'].includes(mode));
const existing = mode ? JSON.parse(await readFile(process.argv[3], 'utf8')) : undefined;
if (existing) assert.equal(existing.url, url);
const root = existing?.root ?? (await mkdtemp('/tmp/teams-custom-live-'));
const file = root + '-proof.json'; // Evidence must not mutate the tested repository.
let proof = existing ?? { root, url, boundaries: [] };
const api = createPaseoClient({ url, reconnect: { enabled: false } });
const client = new DaemonClient({
  url,
  clientId: randomUUID(),
  clientType: 'cli',
  appVersion: '0.13.0',
  reconnect: { enabled: false },
});
const rpc = (name, input) => client.invokePluginRpc('paseo-agent-teams', 'teams.' + name, input);
const save = () => writeFile(file, JSON.stringify(proof, null, 2));
const record = () => rpc('graph_record', proof.scope);
const advance = (state) =>
  rpc('graph_advance', { ...proof.scope, ownerAgentId: proof.ownerId, expectedRevision: state.revision });
const response = (state, submission) => ({
  ...proof.scope,
  ownerAgentId: proof.ownerId,
  expectedRevision: state.revision,
  operationId: state.activations.at(-1).operationId,
  submission,
});
try {
  await api.connect();
  await client.connect();
  if (mode === '--verify') {
    assert.ok(proof.completed && !proof.failure);
    assert.deepEqual(await record(), proof.completed);
    console.log('PASS completed custom graph preserved after reload/restart: ' + file);
  } else if (mode === '--resume') {
    assert.ok(proof.waiting && !proof.failure);
    const state = await record();
    assert.deepEqual(state, proof.waiting, 'Exact human checkpoint must survive daemon restart');
    const still = await advance(state);
    assert.equal(still.reason, 'human_response_required');
    assert.deepEqual(still.state, state, 'Silence cannot approve or create another activation');
    const input = response(state, {
      action: 'decide',
      decision: {
        id: randomUUID(),
        outcome: 'approve',
        summary: 'Explicit approval of isolated custom graph evidence; no delivery or publication.',
      },
    });
    proof.approvalRequest = input;
    await save();
    const completed = await rpc('graph_response', input);
    assert.equal(completed.status, 'succeeded');
    assert.deepEqual(await rpc('graph_response', input), completed);
    assert.deepEqual(completed.activations.slice(0, -1), state.activations.slice(0, -1));
    assert.equal(completed.activations.length, 5);
    assert.equal((await advance(completed)).status, 'terminal');
    assert.equal(await readFile(root + '/RESULT.txt', 'utf8'), 'ready\n');
    proof.completed = completed;
    await save();
    console.log('PASS persisted human checkpoint → explicit approval → idempotent terminal graph: ' + file);
  } else {
    let state;
    if (existing) {
      state = await record();
      assert.deepEqual(state.source, proof.source);
      proof.recoveredFailures = [...(proof.recoveredFailures ?? []), proof.failure].filter(Boolean);
      delete proof.failure;
      delete proof.lastRecord;
    } else {
      execFileSync('git', ['init', '-q', root]);
      await writeFile(root + '/README.md', 'Isolated custom graph validation.\n');
      const workspace = await api.workspaces.open(root);
      const discovery = await api.providers.waitForReady({ cwd: root, timeoutMs: 20000 });
      const choose = (family, preferred) => {
        const entry = discovery.entries.find((e) => e.provider === family && e.status === 'ready');
        assert.ok(entry?.models?.length, 'Ready models required: ' + family);
        return family + '/' + (entry.models.find((m) => m.id === preferred)?.id ?? entry.models[0].id);
      };
      const code = { provider: choose('codex', 'gpt-6.1-sol'), modeId: 'full-access' };
      const review = { provider: choose('claude', 'claude-opus-5-5'), modeId: 'plan' };
      assert.ok((await api.providers.listModes('codex', { cwd: root })).modes.some((m) => m.id === code.modeId));
      assert.ok((await api.providers.listModes('claude', { cwd: root })).modes.some((m) => m.id === review.modeId));
      proof.discovery = discovery;
      const owner = await api.workspaces.ref(workspace.id).agents.create({
        config: { provider: 'agent-teams/auto' },
        title: 'Isolated custom graph failure and correction',
        idempotencyKey: randomUUID(),
      });
      proof.scope = { workspaceId: workspace.id, id: randomUUID() };
      proof.ownerId = owner.id;
      const exact = [
        {
          command:
            'node -e \'require("node:assert/strict").equal(require("node:fs").readFileSync("RESULT.txt","utf8"),"ready\\n")\'',
          timeoutMs: 10000,
        },
      ];
      const readable = [{ command: 'test -s RESULT.txt && git diff --check', timeoutMs: 10000 }];
      const edges = (success, failure) => [
        { outcome: 'success', target: success },
        { outcome: 'failure', target: failure },
      ];
      const definition = {
        version: 1,
        name: 'English custom graph with real failure and correction',
        entry: 'draft',
        maxTransitions: 5,
        steps: [
          {
            id: 'draft',
            instruction:
              'Controlled negative fixture: write RESULT.txt containing exactly draft followed by a newline. Do not fix it yet, even though acceptance requires ready. Return build JSON and explain the intentional remaining issue in English. Never commit or publish.',
            selection: code,
            access: 'write',
            contract: 'build',
            tests: exact,
            transitions: edges('inspect', 'inspect'),
          },
          {
            id: 'inspect',
            instruction:
              'Read RESULT.txt. Acceptance is exactly ready followed by a newline. Return review JSON in English: fail with an actionable issue for any other content, pass only when exact. Never modify files, invoke plan tools, commit or publish.',
            selection: review,
            access: 'read-only',
            contract: 'review',
            tests: readable,
            transitions: edges('human', 'repair'),
          },
          {
            id: 'repair',
            instruction:
              'Use previous test rejection and review findings. Fix RESULT.txt to exactly ready followed by a newline. Return build JSON in English with remaining: [] if the implementation is complete. Remaining describes unresolved implementation defects, not future independent verification or later workflow steps. Preserve README.md. Never commit or publish.',
            selection: code,
            access: 'write',
            contract: 'build',
            tests: exact,
            transitions: edges('inspect', null),
          },
          {
            id: 'human',
            instruction: 'Approve the independently verified correction or reject it. Silence is never approval.',
            selection: { provider: 'human/decision', modeId: 'explicit' },
            access: 'read-only',
            contract: 'human',
            transitions: [
              { outcome: 'approve', target: null },
              { outcome: 'reject', target: null },
            ],
          },
        ],
      };
      const source = await rpc('save_definition', { workspaceId: workspace.id, expectedRevision: 0, definition });
      proof.source = source;
      const launch = {
        workspaceId: workspace.id,
        ownerAgentId: owner.id,
        definitionId: source.id,
        definitionRevision: source.revision,
        task: 'Exercise a controlled draft failure, independent tests, review rejection, repair, read-only validation and persistent human approval. All prose in English. Only RESULT.txt may change. Never commit or publish.',
      };
      const preview = await rpc('graph_preview', launch);
      state = await rpc('graph_confirm', {
        ...launch,
        id: proof.scope.id,
        approveDefinition: true,
        confirmation: preview.confirmation,
      });
      proof.admitted = state;
      await save();
    }
    const deadline = Date.now() + 300000;
    for (let count = 0; count < 340 && Date.now() < deadline; count++) {
      const result = await advance(state);
      state = result.state;
      proof.boundaries.push({ revision: state.revision, reason: result.reason, status: result.status });
      assert.ok(state.activations.length <= 5);
      if (state.status === 'waiting_human') break;
      if (result.reason === 'GRAPH_TESTS_FAILED') {
        assert.equal(state.activations.length, 1, 'Only the intentional draft test may fail');
        assert.equal(state.activations[0].testRun.completion.results[0].exitCode, 1);
        assert.equal(await readFile(root + '/RESULT.txt', 'utf8'), 'draft\n');
        proof.failedTests = state;
        const input = response(state, {
          action: 'reject_tests',
          decision: {
            id: randomUUID(),
            summary: 'Controlled draft test failed; follow the failure edge and require real review/correction.',
          },
        });
        state = await rpc('graph_response', input);
        assert.deepEqual(await rpc('graph_response', input), state);
        proof.testRejectionRequest = input;
      } else {
        assert.notEqual(result.status, 'blocked', result.reason);
        assert.notEqual(result.status, 'terminal', result.reason);
        if (result.status === 'waiting') {
          assert.ok(
            ['running', 'completion_receipt_required'].includes(result.reason),
            'Do not retry permission/uncertain dispatch: ' + result.reason,
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      await save();
    }
    assert.equal(state.status, 'waiting_human', 'Bounded deadline exceeded; inspect checkpoint, never resend');
    assert.deepEqual(
      state.activations.map((a) => a.stepId),
      ['draft', 'inspect', 'repair', 'inspect', 'human'],
    );
    assert.deepEqual(
      state.activations.slice(0, 4).map((a) => a.result.outcome),
      ['failure', 'failure', 'success', 'success'],
    );
    assert.ok(state.activations[0].testRejection);
    assert.equal(new Set(state.activations.slice(0, 4).map((a) => a.dispatch.agentId)).size, 4);
    assert.ok(state.activations.slice(0, 4).every((a) => a.receipt.outcome === 'completed' && a.receipt.turnId));
    for (const index of [1, 3]) {
      const a = state.activations[index];
      assert.equal(a.integrity.unchanged, true);
      assert.ok(a.testRun.completion.results.every((t) => t.exitCode === 0 && !t.timedOut));
    }
    assert.ok(state.activations[2].dispatch.prompt.includes('testRejection'));
    assert.ok(state.activations[2].dispatch.prompt.includes('"verdict":"fail"'));
    assert.equal(state.activations[4].dispatch, undefined);
    assert.equal(await readFile(root + '/RESULT.txt', 'utf8'), 'ready\n');
    assert.equal(await readFile(root + '/README.md', 'utf8'), 'Isolated custom graph validation.\n');
    assert.deepEqual((await advance(state)).state, state);
    proof.waiting = state;
    await save();
    console.log(
      'PASS real failed tests → explicit rejection → failed review → repair → passed review → persistent human checkpoint: ' +
        file,
    );
  }
} catch (error) {
  proof.failure = String(error);
  if (proof.scope) proof.lastRecord = await record().catch(() => null);
  await save();
  throw error;
} finally {
  await client.close();
  await api.close();
}
