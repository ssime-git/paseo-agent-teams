import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GraphCheckpoints } from '../server/graph-checkpoints';
import { graphDispatchPrompt } from '../server/graph-preparation';
import { codeReviewPreset } from '../shared/workflow-definition';
import { graphCheckpointSchema } from '../shared/graph-checkpoint';
import { DefinitionCatalog } from '../server/definition-catalog';
import { Store } from '../server/store';
import { workflowFixture } from './fixtures';

async function setup(t: { after: (fn: () => Promise<void>) => void }, human = false) {
  const directory = await mkdtemp(join(tmpdir(), 'teams-graph-checkpoint-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const catalog = new DefinitionCatalog(join(directory, 'definitions'));
  const definition = codeReviewPreset(
    {
      code: { provider: 'fixture/model', modeId: 'write' },
      review: { provider: 'fixture/model', modeId: 'read' },
    },
    0,
  );
  if (human) {
    definition.steps[1].contract = 'human';
    definition.steps[1].transitions = [
      { outcome: 'approve', target: null },
      { outcome: 'reject', target: 'code' },
    ];
  }
  const source = await catalog.save({ workspaceId: 'owner', expectedRevision: 0, definition });
  const store = new GraphCheckpoints(join(directory, 'graphs'));
  const state = await store.create({ id: randomUUID(), repo: '/isolated/repo/.git', task: 'Test checkpoint', source });
  return { directory, catalog, store, state };
}

test('graph freezes a catalogue revision, reserves before dispatch and resumes without consuming twice', async (t) => {
  const { directory, catalog, store, state } = await setup(t);
  const v1 = new Store(directory),
    legacy = workflowFixture();
  await v1.put(legacy);
  const legacyPath = join(directory, `${legacy.id}.json`),
    before = await readFile(legacyPath, 'utf8');
  await catalog.save({
    workspaceId: 'owner',
    id: state.source.id,
    expectedRevision: 1,
    definition: { ...state.source.definition, name: 'Changed', maxTransitions: 20 },
  });
  const op = randomUUID();
  const reserved = await store.reserve(state.id, 'owner', 1, op);
  assert.equal(reserved.status, 'running');
  const restarted = new GraphCheckpoints(store.directory);
  assert.deepEqual(await restarted.reserve(state.id, 'owner', 1, op), reserved);
  assert.equal(reserved.source.revision, 1);
  assert.equal(reserved.source.definition.maxTransitions, 2);
  await assert.rejects(restarted.reserve(state.id, 'owner', 2, randomUUID()), /cannot activate/);
  await assert.rejects(
    restarted.resolve(state.id, 'other', 2, op, { outcome: 'success', summary: 'done' }),
    /access denied/,
  );
  const result = { outcome: 'success' as const, summary: 'Built' };
  const resolved = await restarted.resolve(state.id, 'owner', 2, op, result);
  assert.deepEqual(await restarted.resolve(state.id, 'owner', 2, op, result), resolved);
  await assert.rejects(
    restarted.resolve(state.id, 'owner', 3, op, { ...result, summary: 'Different' }),
    /different result/,
  );
  const reviewOp = randomUUID();
  const review = await restarted.reserve(state.id, 'owner', 3, reviewOp);
  const exhausted = await restarted.resolve(state.id, 'owner', review.revision, reviewOp, {
    outcome: 'failure',
    summary: 'Fix required',
  });
  assert.equal(exhausted.status, 'exhausted');
  assert.equal(exhausted.nextStepId, 'code');
  await assert.rejects(restarted.reserve(state.id, 'owner', exhausted.revision, randomUUID()), /cannot activate/);
  assert.equal(await readFile(legacyPath, 'utf8'), before);
  assert.equal((await new Store(directory).all()).length, 1);
  assert.deepEqual(await new GraphCheckpoints(store.directory).get(state.id, 'owner'), exhausted);
});

test('human checkpoint stays pending across reload; only explicit contract-compatible decisions resolve it', async (t) => {
  const { store, state } = await setup(t, true);
  const op = randomUUID(),
    humanOp = randomUUID();
  await store.reserve(state.id, 'owner', 1, op);
  await store.resolve(state.id, 'owner', 2, op, { outcome: 'success', summary: 'Built' });
  const pending = await store.reserve(state.id, 'owner', 3, humanOp);
  assert.equal(pending.status, 'waiting_human');
  assert.deepEqual(await new GraphCheckpoints(store.directory).get(state.id, 'owner'), pending);
  await assert.rejects(
    store.resolve(state.id, 'owner', 4, humanOp, { outcome: 'success', summary: 'Timeout' }),
    /contract/,
  );
  assert.equal((await store.get(state.id, 'owner')).status, 'waiting_human');
  const approved = await store.resolve(state.id, 'owner', 4, humanOp, {
    outcome: 'approve',
    summary: 'Explicit approval',
  });
  assert.equal(approved.status, 'succeeded'); // Last allowed activation can still succeed.
});

test('independent checkpoint writers conflict; malformed state cannot reset budget or invent approval', async (t) => {
  const { store, state } = await setup(t);
  const competitor = new GraphCheckpoints(store.directory);
  const outcomes = await Promise.allSettled([
    store.reserve(state.id, 'owner', 1, randomUUID()),
    competitor.reserve(state.id, 'owner', 1, randomUUID()),
  ]);
  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((item) => item.status === 'rejected').length, 1);
  const current = await store.get(state.id, 'owner');
  assert.equal(current.activations.length, 1);
  await assert.rejects(
    store.create({ id: state.id, repo: state.repo, task: state.task, source: state.source }),
    /changed/,
  );
  for (const invalid of [
    { ...current, status: 'succeeded' },
    { ...current, revision: 99 },
    { ...current, nextStepId: 'missing' },
    { ...current, activations: [...current.activations, current.activations[0]] },
    { ...current, version: 2 },
    { ...current, source: { ...current.source, definition: { ...current.source.definition, maxTransitions: 0 } } },
  ])
    assert.equal(graphCheckpointSchema.safeParse(invalid).success, false);
  const file = join(store.directory, state.id, '2.json');
  await writeFile(file, JSON.stringify({ ...current, status: 'succeeded' }));
  await assert.rejects(competitor.get(state.id, 'owner'));
  assert.equal(JSON.parse(await readFile(file, 'utf8')).status, 'succeeded'); // Evidence is preserved.
});

test('failure exits remain failures even when there is unused transition budget', async (t) => {
  const { store, state } = await setup(t);
  const op = randomUUID();
  await store.reserve(state.id, 'owner', 1, op);
  const failed = await store.resolve(state.id, 'owner', 2, op, { outcome: 'failure', summary: 'Build failed' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.nextStepId, null);
  await assert.rejects(store.reserve(state.id, 'owner', 3, randomUUID()), /cannot activate/);
});

test('structured artifacts survive restart and reject changed evidence even with the same summary', async (t) => {
  const { store, state } = await setup(t);
  const op = randomUUID();
  await store.reserve(state.id, 'owner', 1, op);
  const build = { summary: 'Built', changes: ['Implemented feature'], remaining: [] };
  const resolved = await store.resolveArtifact(state.id, 'owner', 2, op, JSON.stringify(build));
  assert.equal(resolved.status, 'ready');
  assert.deepEqual(resolved.activations[0].result?.artifact, { contract: 'build', value: build });
  const restarted = new GraphCheckpoints(store.directory);
  assert.deepEqual(await restarted.get(state.id, 'owner'), resolved);
  assert.deepEqual(await restarted.resolveArtifact(state.id, 'owner', 2, op, JSON.stringify(build)), resolved);
  await assert.rejects(
    restarted.resolveArtifact(state.id, 'owner', 3, op, JSON.stringify({ ...build, changes: ['Different evidence'] })),
    /different result/,
  );
  await assert.rejects(
    restarted.resolve(state.id, 'owner', 3, op, { outcome: 'success', summary: 'Built' }),
    /different result/,
  );
  const reviewOp = randomUUID();
  await restarted.reserve(state.id, 'owner', 3, reviewOp);
  const failed = await restarted.resolveArtifact(
    state.id,
    'owner',
    4,
    reviewOp,
    JSON.stringify({ verdict: 'fail', summary: 'Fix bug', issues: ['Missing validation'] }),
  );
  assert.equal(failed.status, 'exhausted');
  assert.equal(failed.activations[1].result?.outcome, 'failure');
  const corrupt = structuredClone(failed);
  corrupt.activations[1].result!.outcome = 'success';
  assert.equal(graphCheckpointSchema.safeParse(corrupt).success, false);
});

test('invalid, foreign and clarification artifacts leave the reserved operation unchanged', async (t) => {
  const { store, state } = await setup(t);
  const op = randomUUID();
  const pending = await store.reserve(state.id, 'owner', 1, op);
  for (const text of [
    'not JSON',
    '{}',
    JSON.stringify({ verdict: 'pass', summary: 'Wrong contract', issues: [] }),
    JSON.stringify({ kind: 'clarification', summary: 'Wait', questions: [] }),
    '```json\n{}\n```\n```json\n{}\n```',
  ]) {
    await assert.rejects(store.resolveArtifact(state.id, 'owner', 2, op, text));
    assert.deepEqual(await store.get(state.id, 'owner'), pending);
  }
  await assert.rejects(store.resolveArtifact(state.id, 'stranger', 2, op, '{}'), /access denied/);
  const failed = await store.resolveArtifact(
    state.id,
    'owner',
    2,
    op,
    JSON.stringify({ summary: 'Incomplete', changes: [], remaining: ['Need implementation'] }),
  );
  assert.equal(failed.status, 'failed');
});

test('model artifacts cannot decide a human checkpoint', async (t) => {
  const { store, state } = await setup(t, true);
  const op = randomUUID(),
    humanOp = randomUUID();
  await store.reserve(state.id, 'owner', 1, op);
  await store.resolveArtifact(state.id, 'owner', 2, op, '```json\n{"summary":"Done","changes":[],"remaining":[]}\n```');
  const waiting = await store.reserve(state.id, 'owner', 3, humanOp);
  await assert.rejects(
    store.resolveArtifact(state.id, 'owner', 4, humanOp, '{"outcome":"approve","summary":"Approved"}'),
    /human decision/,
  );
  assert.deepEqual(await new GraphCheckpoints(store.directory).get(state.id, 'owner'), waiting);
});

test('plan contract retains commands and rejects forged provenance on replay', async (t) => {
  const { store, state } = await setup(t);
  const source = structuredClone(state.source);
  source.definition.steps[0].contract = 'plan';
  source.definition.steps[0].access = 'read-only';
  const planState = await store.create({ id: randomUUID(), repo: state.repo, task: state.task, source });
  const op = randomUUID();
  await store.reserve(planState.id, 'owner', 1, op);
  const plan = {
    summary: 'Plan',
    tasks: ['Implement'],
    acceptance: ['Works'],
    tests: [{ command: 'npm test', timeoutMs: 1000 }],
  };
  const resolved = await store.resolveArtifact(planState.id, 'owner', 2, op, JSON.stringify(plan));
  assert.deepEqual(resolved.activations[0].result?.artifact, { contract: 'plan', value: plan });
  const corrupt = structuredClone(resolved);
  corrupt.activations[0].result!.artifact = {
    contract: 'build',
    value: { summary: 'Plan', changes: [], remaining: [] },
  };
  assert.equal(graphCheckpointSchema.safeParse(corrupt).success, false);
  corrupt.activations[0].result!.artifact = { contract: 'plan', value: plan };
  corrupt.activations[0].result!.summary = 'Different summary';
  assert.equal(graphCheckpointSchema.safeParse(corrupt).success, false);
});

test('native dispatch intent survives reload and immutable retries without implying delivery', async (t) => {
  const { store, state } = await setup(t);
  const operationId = randomUUID();
  await store.reserve(state.id, 'owner', 1, operationId);
  const dispatch = { agentId: randomUUID(), prompt: `Implement task\n[agent-teams-operation:${operationId}]` };
  await assert.rejects(
    store.bindDispatch(state.id, 'owner', 2, operationId, { ...dispatch, prompt: 'Missing marker' }),
    /operation marker/,
  );
  const bound = await store.bindDispatch(state.id, 'owner', 2, operationId, dispatch);
  assert.equal(bound.status, 'running');
  assert.equal(bound.revision, 3);
  assert.equal(bound.activations.length, 1);
  assert.equal(bound.activations[0].result, undefined);
  const restarted = new GraphCheckpoints(store.directory);
  assert.deepEqual(await restarted.get(state.id, 'owner'), bound);
  assert.deepEqual(await restarted.bindDispatch(state.id, 'owner', 2, operationId, dispatch), bound);
  for (const replacement of [
    { ...dispatch, agentId: randomUUID() },
    { ...dispatch, prompt: 'Different' },
  ])
    await assert.rejects(restarted.bindDispatch(state.id, 'owner', 3, operationId, replacement), /already bound/);
  await assert.rejects(restarted.bindDispatch(state.id, 'other', 3, operationId, dispatch), /access denied/);
  await assert.rejects(restarted.bindDispatch(state.id, 'owner', 3, randomUUID(), dispatch), /Unknown/);
  assert.deepEqual(await restarted.get(state.id, 'owner'), bound);
  const resolved = await restarted.resolveArtifact(
    state.id,
    'owner',
    3,
    operationId,
    '{"summary":"Done","changes":[],"remaining":[]}',
  );
  assert.equal(resolved.revision, 4);
  assert.deepEqual(resolved.activations[0].dispatch, dispatch);
  assert.deepEqual(await restarted.bindDispatch(state.id, 'owner', 2, operationId, dispatch), resolved);
  const corrupt = structuredClone(resolved);
  corrupt.revision--;
  assert.equal(graphCheckpointSchema.safeParse(corrupt).success, false);
});

test('competing native bindings retain one winner and reject stale writes without deleting evidence', async (t) => {
  const { store, state } = await setup(t);
  const operationId = randomUUID();
  await store.reserve(state.id, 'owner', 1, operationId);
  const rival = new GraphCheckpoints(store.directory);
  const outcomes = await Promise.allSettled([
    store.bindDispatch(state.id, 'owner', 2, operationId, {
      agentId: randomUUID(),
      prompt: `First [agent-teams-operation:${operationId}]`,
    }),
    rival.bindDispatch(state.id, 'owner', 2, operationId, {
      agentId: randomUUID(),
      prompt: `Second [agent-teams-operation:${operationId}]`,
    }),
  ]);
  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((item) => item.status === 'rejected').length, 1);
  const current = await rival.get(state.id, 'owner');
  assert.equal(current.revision, 3);
  assert.equal(current.activations.length, 1);
  assert.ok(current.activations[0].dispatch);
  const revision = await readFile(join(store.directory, state.id, '2.json'), 'utf8');
  assert.equal(JSON.parse(revision).activations[0].dispatch, undefined);
});

test('human decisions and already resolved legacy operations cannot acquire native dispatch intent', async (t) => {
  const { store, state } = await setup(t, true);
  const operationId = randomUUID(),
    humanId = randomUUID();
  await store.reserve(state.id, 'owner', 1, operationId);
  await store.resolve(state.id, 'owner', 2, operationId, { outcome: 'success', summary: 'Legacy build' });
  const waiting = await store.reserve(state.id, 'owner', 3, humanId);
  const dispatch = { agentId: randomUUID(), prompt: 'Must not send' };
  await assert.rejects(store.bindDispatch(state.id, 'owner', 4, operationId, dispatch), /pending model/);
  await assert.rejects(store.bindDispatch(state.id, 'owner', 4, humanId, dispatch), /pending model/);
  assert.deepEqual(await store.get(state.id, 'owner'), waiting);
  const corrupt = structuredClone(waiting);
  corrupt.activations[1].dispatch = dispatch;
  corrupt.revision++;
  assert.equal(graphCheckpointSchema.safeParse(corrupt).success, false);
});

test('explicit human decisions persist atomically, replay identically and cannot replace legacy results', async (t) => {
  const { store, state } = await setup(t, true);
  const build = randomUUID(),
    human = randomUUID();
  await store.reserve(state.id, 'owner', 1, build);
  await store.resolve(state.id, 'owner', 2, build, { outcome: 'success', summary: 'Built' });
  const pending = await store.reserve(state.id, 'owner', 3, human);
  const restarted = new GraphCheckpoints(store.directory);
  assert.deepEqual(await restarted.get(state.id, 'owner'), pending);
  const decision = { id: randomUUID(), outcome: 'approve' as const, summary: 'Reviewed explicitly' };
  await assert.rejects(restarted.decideHuman(state.id, 'other', 4, human, decision), /access denied/);
  await assert.rejects(restarted.decideHuman(state.id, 'owner', 4, build, decision), /Only a human/);
  await assert.rejects(restarted.decideHuman(state.id, 'owner', 3, human, decision), /changed/);
  for (const summary of ['', '   ', 'a'.repeat(4001)])
    await assert.rejects(restarted.decideHuman(state.id, 'owner', 4, human, { ...decision, summary }));
  assert.deepEqual(await restarted.get(state.id, 'owner'), pending);
  const decided = await restarted.decideHuman(state.id, 'owner', 4, human, decision);
  assert.equal(decided.revision, 5);
  assert.equal(decided.status, 'succeeded');
  assert.deepEqual(decided.activations[1].humanDecision, decision);
  const recovered = new GraphCheckpoints(store.directory);
  assert.deepEqual(await recovered.decideHuman(state.id, 'owner', 1, human, decision), decided);
  for (const change of [{ outcome: 'reject' as const }, { summary: 'Different' }, { id: randomUUID() }])
    await assert.rejects(recovered.decideHuman(state.id, 'owner', 5, human, { ...decision, ...change }), /differently/);
  for (const mutate of [
    (s: typeof decided) => {
      s.activations[1].humanDecision!.outcome = 'reject';
    },
    (s: typeof decided) => {
      s.activations[1].humanDecision!.summary = 'Forged';
    },
    (s: typeof decided) => {
      delete s.activations[1].result;
    },
    (s: typeof decided) => {
      s.activations[0].humanDecision = decision;
    },
  ]) {
    const corrupt = structuredClone(decided);
    mutate(corrupt);
    assert.equal(graphCheckpointSchema.safeParse(corrupt).success, false);
  }
  // Already persisted legacy approvals stay readable, without invented provenance.
  const legacy = structuredClone(decided);
  delete legacy.activations[1].humanDecision;
  assert.equal(graphCheckpointSchema.safeParse(legacy).success, true);
});

test('competing explicit human decisions retain one winner and leave the next activation unreserved', async (t) => {
  const { store, state } = await setup(t, true);
  // Allow a correction after rejection so its pending state can be inspected.
  const source = structuredClone(state.source);
  source.definition.maxTransitions = 4;
  const start = await store.create({ id: randomUUID(), repo: state.repo, task: state.task, source });
  const build = randomUUID(),
    human = randomUUID();
  await store.reserve(start.id, 'owner', 1, build);
  await store.resolve(start.id, 'owner', 2, build, { outcome: 'success', summary: 'Built' });
  await store.reserve(start.id, 'owner', 3, human);
  const rival = new GraphCheckpoints(store.directory);
  const decisions = [
    { id: randomUUID(), outcome: 'reject' as const, summary: 'Fix validation' },
    { id: randomUUID(), outcome: 'approve' as const, summary: 'Accepted' },
  ];
  const outcomes = await Promise.allSettled(
    decisions.map((d, i) => (i ? rival : store).decideHuman(start.id, 'owner', 4, human, d)),
  );
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((o) => o.status === 'rejected').length, 1);
  const saved = await rival.get(start.id, 'owner');
  assert.equal(saved.activations.length, 2);
  assert.equal(saved.revision, 5);
  assert.ok(saved.activations[1].humanDecision);
  assert.equal(saved.status, saved.activations[1].result!.outcome === 'reject' ? 'ready' : 'succeeded');
  assert.equal(saved.activations[1].dispatch, undefined);
  assert.equal(JSON.parse(await readFile(join(store.directory, start.id, '4.json'), 'utf8')).status, 'waiting_human');
});

test('rejection preserves its reason across correction and decision IDs cannot be reused', async (t) => {
  const { store, state } = await setup(t, true);
  const source = structuredClone(state.source);
  source.definition.maxTransitions = 4;
  const graph = await store.create({ id: randomUUID(), repo: state.repo, task: state.task, source });
  const build = randomUUID(),
    human = randomUUID(),
    correction = randomUUID(),
    final = randomUUID();
  await store.reserve(graph.id, 'owner', 1, build);
  await store.resolve(graph.id, 'owner', 2, build, { outcome: 'success', summary: 'Built' });
  await store.reserve(graph.id, 'owner', 3, human);
  const decision = { id: randomUUID(), outcome: 'reject' as const, summary: 'Missing input validation' };
  const rejected = await store.decideHuman(graph.id, 'owner', 4, human, decision);
  assert.equal(rejected.status, 'ready');
  assert.equal(rejected.nextStepId, 'code');
  await store.reserve(graph.id, 'owner', 5, correction);
  await store.resolve(graph.id, 'owner', 6, correction, { outcome: 'success', summary: 'Fixed' });
  const waiting = await store.reserve(graph.id, 'owner', 7, final);
  const restarted = new GraphCheckpoints(store.directory);
  assert.deepEqual(await restarted.decideHuman(graph.id, 'owner', 4, human, decision), waiting);
  await assert.rejects(restarted.decideHuman(graph.id, 'owner', 8, final, decision), /already used/);
  assert.deepEqual(await restarted.get(graph.id, 'owner'), waiting);
  // Compatibility path: a legacy explicit resolution cannot be relabelled later.
  const approved = await restarted.resolve(graph.id, 'owner', 8, final, { outcome: 'approve', summary: 'Legacy' });
  await assert.rejects(
    restarted.decideHuman(graph.id, 'owner', 9, final, { ...decision, id: randomUUID() }),
    /pending human/,
  );
  assert.equal(approved.activations[3].humanDecision, undefined);
});

test('durable graph notifications report committed state only and cannot change or undo it', async (t) => {
  const { store, state } = await setup(t);
  const revisions: number[] = [];
  const stop = store.onChange((next) => {
    revisions.push(next.revision);
    next.task = 'Changed by observer';
    throw new Error('Observer failed');
  });
  const reserved = await store.reserve(state.id, 'owner', state.revision, randomUUID());
  assert.deepEqual(revisions, [2]);
  assert.equal(reserved.task, state.task);
  assert.deepEqual(await store.get(state.id, 'owner'), reserved);
  await assert.rejects(store.reserve(state.id, 'owner', state.revision, randomUUID()));
  assert.deepEqual(revisions, [2]);
  stop();
  await store.bindDispatch(state.id, 'owner', reserved.revision, reserved.activations[0].operationId, {
    agentId: randomUUID(),
    prompt: graphDispatchPrompt(reserved, reserved.activations[0].operationId),
  });
  assert.deepEqual(revisions, [2]);
});
