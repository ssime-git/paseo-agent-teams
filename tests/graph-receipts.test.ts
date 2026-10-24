import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginLifecycleEvents } from '@getpaseo/plugin/server';
import { DefinitionCatalog } from '../server/definition-catalog';
import { GraphCheckpoints } from '../server/graph-checkpoints';
import { codeReviewPreset } from '../shared/workflow-definition';
import { graphCheckpointSchema } from '../shared/graph-checkpoint';
import { captureGraphReceipt } from '../server/graph-receipts';

async function setup(t: { after: (fn: () => Promise<void>) => void }, claim = true) {
  const directory = await mkdtemp(join(tmpdir(), 'teams-receipt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = await new DefinitionCatalog(join(directory, 'definitions')).save({
    workspaceId: 'owner',
    expectedRevision: 0,
    definition: codeReviewPreset({
      code: { provider: 'codex/model', modeId: 'auto' },
      review: { provider: 'codex/model', modeId: 'read-only' },
    }),
  });
  const store = new GraphCheckpoints(join(directory, 'graphs'));
  const state = await store.create({ id: randomUUID(), repo: directory, task: 'task', source });
  const operationId = randomUUID(),
    agentId = randomUUID();
  await store.reserve(state.id, 'owner', 1, operationId);
  const prompt = `[agent-teams-operation:${operationId}] exact prompt`;
  await store.bindDispatch(state.id, 'owner', 2, operationId, { agentId, prompt });
  if (claim) await store.claimDispatch(state.id, 'owner', 3, operationId, randomUUID());
  const event = {
    agent: { id: agentId, workspaceId: 'owner', parentAgentId: null, provider: 'codex', cwd: directory, title: null },
    turnId: 'native-turn',
    outcome: { kind: 'completed' },
    timeline: [
      { type: 'user_message', text: prompt },
      { type: 'assistant_message', text: 'raw unvalidated result' },
    ],
  } as PluginLifecycleEvents['agent.turn_ended'];
  return { store, state, operationId, event, read: () => store.get(state.id, 'owner') };
}

test('official completion receipt is durable and idempotent without resolving an artifact or releasing the reservation', async (t) => {
  const h = await setup(t);
  await captureGraphReceipt(h.store, h.event);
  const saved = await h.read();
  assert.equal(saved.revision, 5);
  assert.equal(saved.status, 'running');
  assert.equal(saved.activations[0].result, undefined);
  assert.equal(saved.activations[0].receipt?.turnId, 'native-turn');
  assert.equal(saved.activations[0].receipt?.text, 'raw unvalidated result');
  const restarted = new GraphCheckpoints(h.store.directory);
  await captureGraphReceipt(restarted, h.event);
  assert.deepEqual(await restarted.get(h.state.id, 'owner'), saved);
  const receipt = saved.activations[0].receipt!;
  // Even stale duplicate acknowledgments do not allocate another revision.
  assert.deepEqual(await restarted.receipt(h.state.id, 'owner', 4, h.operationId, receipt), saved);
  await assert.rejects(restarted.receipt(h.state.id, 'foreign', 5, h.operationId, receipt), /access denied/);
  await assert.rejects(
    restarted.receipt(h.state.id, 'owner', 5, h.operationId, { ...receipt, turnId: 'different' }),
    /differently/,
  );
  await assert.rejects(
    restarted.receipt(h.state.id, 'owner', 5, h.operationId, { ...receipt, attemptId: randomUUID() }),
    /match/,
  );
  const corrupt = structuredClone(saved);
  corrupt.activations[0].receipt!.agentId = randomUUID();
  assert.equal(graphCheckpointSchema.safeParse(corrupt).success, false);
});

test('missing identity, mismatched prompts, followups and oversized outputs never fabricate completion', async (t) => {
  const h = await setup(t),
    before = await h.read();
  const cases = [
    { turnId: null },
    { agent: { ...h.event.agent, id: randomUUID() } },
    { agent: { ...h.event.agent, workspaceId: 'foreign' } },
    { timeline: [{ type: 'assistant_message', text: 'idle is not completion' }] },
    { timeline: [{ type: 'user_message', text: 'wrong prompt' }] },
    { timeline: [...h.event.timeline, h.event.timeline[0]] },
    { timeline: [...h.event.timeline, { type: 'user_message', text: 'followup' }] },
    { timeline: [h.event.timeline[0], { type: 'assistant_message', text: 'x'.repeat(256 * 1024 + 1) }] },
  ];
  for (const change of cases) {
    await captureGraphReceipt(h.store, { ...h.event, ...change } as typeof h.event);
    assert.deepEqual(await h.read(), before);
  }
});

test('failed and canceled native turns retain their technical outcome and never become graph success', async (t) => {
  for (const outcome of [
    { kind: 'failed', error: { message: 'provider unavailable' } },
    { kind: 'canceled', reason: 'human canceled' },
  ] as const) {
    const h = await setup(t);
    await captureGraphReceipt(h.store, { ...h.event, outcome });
    const saved = await h.read();
    assert.equal(saved.status, 'running');
    assert.equal(saved.activations[0].receipt?.outcome, outcome.kind);
    assert.equal(
      saved.activations[0].receipt?.error,
      outcome.kind === 'failed' ? outcome.error.message : outcome.reason,
    );
    assert.equal(saved.activations[0].result, undefined);
  }
});

test('two receipt writers preserve a single immutable revision and can replay after a conflict', async (t) => {
  const h = await setup(t);
  const results = await Promise.allSettled([
    captureGraphReceipt(h.store, h.event),
    captureGraphReceipt(new GraphCheckpoints(h.store.directory), h.event),
  ]);
  assert.ok(results.some((r) => r.status === 'fulfilled'));
  for (const r of results) if (r.status === 'rejected') assert.match(String(r.reason), /changed/);
  await captureGraphReceipt(h.store, h.event);
  assert.equal((await h.read()).revision, 5);
});

test('a terminal hook without a saved send attempt cannot produce a receipt', async (t) => {
  const h = await setup(t, false);
  const before = await h.read();
  await captureGraphReceipt(h.store, h.event);
  assert.deepEqual(await h.read(), before);
});

test('assistant content preceding the saved prompt is never captured as its reply', async (t) => {
  const h = await setup(t);
  await captureGraphReceipt(h.store, { ...h.event, timeline: [h.event.timeline[1], h.event.timeline[0]] });
  assert.equal((await h.read()).activations[0].receipt?.text, undefined);
});
