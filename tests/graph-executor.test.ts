import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PaseoApi } from '@getpaseo/client';
import { GraphCheckpoints } from '../server/graph-checkpoints';
import { DefinitionCatalog } from '../server/definition-catalog';
import { codeReviewPreset, type WorkflowDefinition } from '../shared/workflow-definition';
import { advanceGraph } from '../server/graph-executor';
import { git, repository } from '../server/git';

async function setup(
  t: { after: (fn: () => Promise<void>) => void },
  configure?: (definition: WorkflowDefinition) => void,
) {
  const directory = await mkdtemp(join(tmpdir(), 'teams-executor-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = join(directory, 'repo');
  await mkdir(repo);
  await git(repo, ['init', '-q']);
  await writeFile(join(repo, 'file'), 'original');
  const definition = codeReviewPreset({
    code: { provider: 'codex/model', modeId: 'read-only' },
    review: { provider: 'codex/model', modeId: 'read-only' },
  });
  definition.steps[0].access = 'read-only';
  definition.steps[0].tests = [{ command: 'test -f file && printf verified', timeoutMs: 1000 }];
  configure?.(definition);
  const source = await new DefinitionCatalog(join(directory, 'definitions')).save({
    workspaceId: 'owner',
    expectedRevision: 0,
    definition,
  });
  const store = new GraphCheckpoints(join(directory, 'graphs'));
  const state = await store.create({ id: randomUUID(), repo: (await repository(repo)).lock, task: 'Inspect', source });
  let sends = 0,
    creates = 0;
  const entries: unknown[] = [];
  const handle = {
    status: 'idle',
    activeTurn: null,
    pendingPermissions: [],
    refresh: async () => ({}),
    timeline: { refetch: async () => ({ entries, endCursor: { epoch: 'e', seq: 1 } }) },
    send: async (text: string) => {
      sends++;
      entries.push({ item: { type: 'user_message', text } });
    },
  };
  const api = {
    config: { get: async () => ({ config: { providers: {} } }) },
    providers: {
      waitForReady: async () => ({ entries: [{ provider: 'codex', status: 'ready', models: [{ id: 'model' }] }] }),
      listModes: async () => ({ modes: [{ id: 'auto' }] }),
    },
    workspaces: {
      ref: () => ({
        refresh: async () => ({ workspaceDirectory: repo }),
        agents: {
          create: async () => {
            creates++;
            return { id: randomUUID() };
          },
        },
      }),
    },
    agents: { ref: () => handle },
  } as unknown as PaseoApi;
  const input = { id: state.id, workspaceId: 'owner', expectedRevision: 1 };
  const load = () => store.get(state.id, 'owner');
  const tick = async () =>
    advanceGraph(api, new GraphCheckpoints(store.directory), { ...input, expectedRevision: (await load()).revision });
  const receipt = async (
    text = JSON.stringify({ summary: 'Done', changes: [], remaining: [] }),
    outcome: 'completed' | 'failed' | 'canceled' = 'completed',
  ) => {
    const current = await load(),
      a = current.activations.at(-1)!;
    return store.receipt(state.id, 'owner', current.revision, a.operationId, {
      agentId: a.dispatch!.agentId,
      attemptId: a.dispatch!.attemptId!,
      turnId: 'turn',
      outcome,
      text,
    });
  };
  const sent = async () => {
    for (const reason of ['reserved', 'prepared', 'sent']) assert.equal((await tick()).reason, reason);
  };
  return {
    store,
    repo,
    state,
    api,
    input,
    load,
    tick,
    receipt,
    sent,
    handle,
    sends: () => sends,
    creates: () => creates,
  };
}

test('executor advances one boundary per revision, resumes from disk and never treats idle as completion', async (t) => {
  const h = await setup(t);
  await h.sent();
  const waiting = await h.tick();
  assert.equal(waiting.reason, 'completion_receipt_required');
  assert.deepEqual(waiting.state, await h.load());
  assert.equal((await advanceGraph(h.api, h.store, h.input)).status, 'stale');
  assert.equal(h.sends(), 1);
  assert.equal(h.creates(), 1);
  await h.receipt();
  for (const reason of ['integrity_recorded', 'assessed', 'tests_recorded', 'consumed']) {
    const before = await h.load();
    const next = await h.tick();
    assert.equal(next.reason, reason);
    assert.equal(next.state.revision, before.revision + (reason === 'tests_recorded' ? 2 : 1));
    assert.equal(
      (await advanceGraph(h.api, h.store, { ...h.input, expectedRevision: before.revision })).status,
      'stale',
    );
  }
  const ready = await h.load();
  assert.equal(ready.status, 'ready');
  assert.equal(ready.nextStepId, 'review');
  assert.equal(ready.activations.length, 1);
  assert.equal(h.sends(), 1);
  assert.equal(ready.activations[0].testRun?.completion?.results[0].stdout, 'verified');
  assert.equal((await h.tick()).reason, 'reserved');
  assert.equal((await h.load()).activations.length, 2);
  assert.equal(h.creates(), 1);
});

test('executor arbitrates concurrent callers and rejects foreign workspace before any native work', async (t) => {
  const h = await setup(t);
  const results = await Promise.allSettled([
    advanceGraph(h.api, h.store, h.input),
    advanceGraph(h.api, new GraphCheckpoints(h.store.directory), h.input),
  ]);
  assert.ok(results.some((r) => r.status === 'fulfilled' && r.value.reason === 'reserved'));
  assert.equal((await h.load()).activations.length, 1);
  await assert.rejects(advanceGraph(h.api, h.store, { ...h.input, workspaceId: 'foreign' }), /access denied/);
  assert.equal(h.creates(), 0);
  assert.equal(h.sends(), 0);
});

test('executor retains uncertain sends and native permissions without retry or answering', async (t) => {
  const h = await setup(t);
  await h.tick();
  await h.tick();
  h.handle.send = async () => {
    throw new Error('lost response');
  };
  assert.equal((await h.tick()).reason, 'uncertain');
  assert.equal((await h.tick()).reason, 'uncertain');
  Object.assign(h.handle, { pendingPermissions: [{}] });
  // No exact prompt was observed: permission presence alone is not acceptance.
  assert.equal((await h.tick()).status, 'waiting');
  assert.equal(h.creates(), 1);
  assert.equal(h.sends(), 0);
  const accepted = await setup(t);
  await accepted.sent();
  Object.assign(accepted.handle, { pendingPermissions: [{}] });
  assert.equal((await accepted.tick()).reason, 'permission');
  assert.equal(accepted.sends(), 1);
});

test('executor blocks changed read-only files, invalid output and failed/canceled turns without another model', async (t) => {
  for (const kind of ['changed', 'invalid', 'failed', 'canceled'] as const) {
    const h = await setup(t);
    await h.sent();
    await h.receipt(
      kind === 'invalid' ? 'bad json' : undefined,
      kind === 'failed' || kind === 'canceled' ? kind : 'completed',
    );
    if (kind === 'changed') await writeFile(join(h.repo, 'file'), 'changed');
    assert.equal((await h.tick()).reason, 'integrity_recorded');
    if (kind !== 'changed') assert.equal((await h.tick()).reason, 'assessed');
    const blocked = await h.tick();
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.reason, kind === 'changed' ? 'read_only_changed' : kind);
    assert.equal((await h.load()).activations.length, 1);
    assert.equal(h.sends(), 1);
  }
});

test('executor never reruns uncertain tests and blocks stale evidence after successful commands', async (t) => {
  for (const kind of ['uncertain', 'stale'] as const) {
    const h = await setup(t);
    await h.sent();
    await h.receipt();
    await h.tick();
    await h.tick();
    let state = await h.load();
    const a = state.activations[0];
    if (kind === 'uncertain') {
      state = await h.store.claimTests(
        state.id,
        'owner',
        state.revision,
        a.operationId,
        randomUUID(),
        a.integrity!.fingerprint,
      );
    } else {
      await h.tick();
      await writeFile(join(h.repo, 'file'), 'later');
    }
    const before = await h.load();
    const blocked = await h.tick();
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.reason, kind === 'uncertain' ? 'test_completion_uncertain' : 'GRAPH_INTEGRITY_REQUIRED');
    assert.deepEqual(blocked.state, before);
    assert.equal(h.sends(), 1);
  }
});

test('human and clarification boundaries wait unchanged until explicit answers, then resume with context', async (t) => {
  const human = await setup(t, (d) => {
    d.steps[0].contract = 'human';
    delete d.steps[0].tests;
    d.steps[0].transitions = [
      { outcome: 'approve', target: 'review' },
      { outcome: 'reject', target: null },
    ];
  });
  await human.tick();
  const pending = await human.load();
  for (let n = 0; n < 3; n++) {
    const waiting = await human.tick();
    assert.equal(waiting.reason, 'human_response_required');
    assert.deepEqual(waiting.state, pending);
  }
  assert.equal(human.creates(), 0);
  await human.store.decideHuman(pending.id, 'owner', pending.revision, pending.activations[0].operationId, {
    id: randomUUID(),
    outcome: 'reject',
    summary: 'Explicit rejection',
  });
  assert.equal((await human.tick()).reason, 'failed');

  const h = await setup(t, (d) => {
    d.steps[0].contract = 'plan';
  });
  await h.sent();
  await h.receipt(
    JSON.stringify({
      kind: 'clarification',
      summary: 'Choose scope',
      questions: [
        {
          id: 'scope',
          title: 'Which scope?',
          recommendedOptionId: 'small',
          options: [
            { id: 'small', label: 'Small', tradeoff: 'Quick' },
            { id: 'large', label: 'Large', tradeoff: 'Complete' },
          ],
        },
      ],
    }),
  );
  await h.tick();
  await h.tick();
  const waiting = await h.tick();
  assert.equal(waiting.reason, 'human_response_required');
  assert.equal(waiting.state.activations[0].testRun, undefined);
  await h.store.answerClarification(
    waiting.state.id,
    'owner',
    waiting.state.revision,
    waiting.state.activations[0].operationId,
    { questionId: 'scope', text: 'Custom choice later' },
  );
  assert.equal((await h.tick()).reason, 'reserved');
  assert.equal((await h.tick()).reason, 'prepared');
  const resumed = await h.load();
  assert.match(resumed.activations[1].dispatch!.prompt, /Custom choice later/);
  assert.equal(h.sends(), 1);
  assert.equal(resumed.nextStepId, 'code');
});

test('missing tests and failed commands never authorize automatic exceptions or corrections', async (t) => {
  for (const kind of ['absent', 'failed', 'stale-before-tests'] as const) {
    const h = await setup(t, (d) => {
      if (kind === 'absent') delete d.steps[0].tests;
      if (kind === 'failed') d.steps[0].tests = [{ command: 'exit 7', timeoutMs: 1000 }];
    });
    await h.sent();
    await h.receipt();
    await h.tick();
    await h.tick();
    if (kind === 'stale-before-tests') await writeFile(join(h.repo, 'file'), 'changed after assessment');
    if (kind === 'failed') assert.equal((await h.tick()).reason, 'tests_recorded');
    const result = await h.tick();
    assert.equal(
      result.reason,
      kind === 'absent'
        ? 'explicit_no_tests_decision_required'
        : kind === 'failed'
          ? 'GRAPH_TESTS_FAILED'
          : 'GRAPH_INTEGRITY_REQUIRED',
    );
    assert.equal(result.state.activations.length, 1);
    assert.equal(result.state.activations[0].noTestsDecision, undefined);
    assert.equal(h.sends(), 1);
  }
});

test('custom single-step graphs finish or exhaust their saved budget without reserving another turn', async (t) => {
  for (const terminal of [true, false]) {
    const h = await setup(t, (d) => {
      d.steps = [d.steps[0]];
      d.maxTransitions = 1;
      d.steps[0].transitions = [
        { outcome: 'success', target: terminal ? null : 'code' },
        { outcome: 'failure', target: null },
      ];
    });
    await h.sent();
    await h.receipt();
    for (let n = 0; n < 4; n++) await h.tick();
    const done = await h.tick();
    assert.equal(done.status, 'terminal');
    assert.equal(done.reason, terminal ? 'succeeded' : 'exhausted');
    assert.deepEqual((await h.tick()).state, done.state);
    assert.equal(h.sends(), 1);
    assert.equal(h.creates(), 1);
  }
});

test('write steps retain stale evidence and valid negative artifacts follow the configured failure edge', async (t) => {
  for (const kind of ['stale', 'negative'] as const) {
    const h = await setup(t, (d) => {
      d.steps = [d.steps[0]];
      d.steps[0].access = 'write';
      d.steps[0].transitions = [
        { outcome: 'success', target: null },
        { outcome: 'failure', target: null },
      ];
    });
    await h.sent();
    await h.receipt(
      JSON.stringify({ summary: 'Inspected', changes: [], remaining: kind === 'negative' ? ['Unresolved'] : [] }),
    );
    assert.equal((await h.tick()).reason, 'assessed');
    assert.equal((await h.tick()).reason, 'tests_recorded');
    if (kind === 'stale') {
      await writeFile(join(h.repo, 'file'), 'later edit');
      const before = await h.load();
      const blocked = await h.tick();
      assert.equal(blocked.reason, 'GRAPH_EVIDENCE_STALE');
      assert.equal(blocked.status, 'blocked');
      assert.deepEqual(blocked.state, before);
    } else {
      assert.equal((await h.tick()).reason, 'consumed');
      assert.equal((await h.tick()).reason, 'failed');
      assert.equal((await h.load()).activations[0].result?.outcome, 'failure');
    }
    assert.equal(h.sends(), 1);
  }
});
