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

async function setup(
  t: { after: (fn: () => Promise<void>) => void },
  claim = true,
  contract: 'plan' | 'build' | 'review' = 'build',
) {
  const directory = await mkdtemp(join(tmpdir(), 'teams-receipt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const definition = codeReviewPreset({
    code: { provider: 'codex/model', modeId: 'auto' },
    review: { provider: 'codex/model', modeId: 'read-only' },
  });
  definition.steps[0].contract = contract;
  if (contract !== 'build') definition.steps[0].access = 'read-only';
  const source = await new DefinitionCatalog(join(directory, 'definitions')).save({
    workspaceId: 'owner',
    expectedRevision: 0,
    definition,
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

test('saved completed output is assessed durably without transitioning or releasing its reservation', async (t) => {
  const h = await setup(t);
  const build = { summary: 'Inspected', changes: [], remaining: [] };
  await captureGraphReceipt(h.store, {
    ...h.event,
    timeline: [h.event.timeline[0], { type: 'assistant_message', text: JSON.stringify(build) }],
  });
  const saved = await h.store.assessReceipt(h.state.id, 'owner', 5, h.operationId);
  assert.equal(saved.revision, 6);
  assert.deepEqual(saved.activations[0].assessment, {
    status: 'valid',
    result: { outcome: 'success', summary: build.summary, artifact: { contract: 'build', value: build } },
  });
  assert.equal(saved.status, 'running');
  assert.equal(saved.nextStepId, h.state.nextStepId);
  assert.equal(saved.activations[0].result, undefined);
  const restarted = new GraphCheckpoints(h.store.directory);
  assert.deepEqual(await restarted.assessReceipt(h.state.id, 'owner', 4, h.operationId), saved);
  await assert.rejects(
    restarted.resolve(h.state.id, 'owner', 6, h.operationId, { outcome: 'success', summary: 'Invented' }),
    /consume verified evidence/,
  );
  await assert.rejects(restarted.reserve(h.state.id, 'owner', 6, randomUUID()), /cannot activate/);
  await assert.rejects(restarted.assessReceipt(h.state.id, 'foreign', 6, h.operationId), /access denied/);
  const corrupt = structuredClone(saved);
  const assessment = corrupt.activations[0].assessment!;
  assert.equal(assessment.status, 'valid');
  if (assessment.status === 'valid') assessment.result.summary = 'invented summary';
  assert.equal(graphCheckpointSchema.safeParse(corrupt).success, false);
  delete corrupt.activations[0].receipt;
  assert.equal(graphCheckpointSchema.safeParse(corrupt).success, false);
});

test('missing or malformed output is retained without resend or manufactured graph failure', async (t) => {
  const outputs = [
    undefined,
    '',
    'not JSON',
    '{"verdict":"pass","summary":"wrong contract","issues":[]}',
    'Discussion\n```json\n{"summary":"Done","changes":[],"remaining":[]}\n```',
    '{"summary":"Done","changes":[],"remaining":[]}\n{"summary":"Other","changes":[],"remaining":[]}',
    '{"kind":"clarification","summary":"Question","questions":[]}',
  ];
  for (const text of outputs) {
    const h = await setup(t);
    const before = await h.read();
    await assert.rejects(h.store.assessReceipt(h.state.id, 'owner', 4, h.operationId), /receipt required/);
    assert.deepEqual(await h.read(), before);
    await captureGraphReceipt(h.store, {
      ...h.event,
      timeline: [h.event.timeline[0], ...(text === undefined ? [] : [{ type: 'assistant_message' as const, text }])],
    });
    const saved = await h.store.assessReceipt(h.state.id, 'owner', 5, h.operationId);
    assert.equal(saved.activations[0].assessment?.status, 'invalid');
    assert.equal(saved.activations[0].receipt?.text, text);
    assert.equal(saved.activations[0].result, undefined);
    assert.equal(saved.status, 'running');
    assert.equal(saved.activations[0].dispatch?.attemptId, before.activations[0].dispatch?.attemptId);
    await assert.rejects(
      h.store.resolve(h.state.id, 'owner', 6, h.operationId, { outcome: 'success', summary: 'Ignore invalid output' }),
      /consume verified evidence/,
    );
  }
});

test('failed or canceled receipts never validate even when they contain a valid artifact', async (t) => {
  for (const outcome of [
    { kind: 'failed', error: { message: 'provider disconnected' } },
    { kind: 'canceled', reason: 'user canceled' },
  ] as const) {
    const h = await setup(t);
    await captureGraphReceipt(h.store, {
      ...h.event,
      outcome,
      timeline: [
        h.event.timeline[0],
        { type: 'assistant_message', text: '{"summary":"Done","changes":[],"remaining":[]}' },
      ],
    });
    const saved = await h.store.assessReceipt(h.state.id, 'owner', 5, h.operationId);
    assert.deepEqual(saved.activations[0].assessment, {
      status: outcome.kind,
      reason: outcome.kind === 'failed' ? outcome.error.message : outcome.reason,
    });
    assert.equal(saved.status, 'running');
    assert.equal(saved.activations[0].result, undefined);
  }
});

test('valid but incomplete work stays a failure candidate and normalization keeps the native receipt intact', async (t) => {
  const h = await setup(t);
  const text = '---\n```json\n{"summary":"Blocked","changes":[],"remaining":["Needs credentials"]}\n```';
  await captureGraphReceipt(h.store, {
    ...h.event,
    timeline: [h.event.timeline[0], { type: 'assistant_message', text }],
  });
  const saved = await h.store.assessReceipt(h.state.id, 'owner', 5, h.operationId);
  const assessment = saved.activations[0].assessment!;
  assert.equal(assessment.status, 'valid');
  if (assessment.status === 'valid') assert.equal(assessment.result.outcome, 'failure');
  assert.equal(saved.activations[0].receipt?.text, text);
  assert.equal(saved.status, 'running');
});

test('assessment publication arbitrates concurrent writers and refuses stale first writes', async (t) => {
  const h = await setup(t);
  await captureGraphReceipt(h.store, h.event);
  await assert.rejects(h.store.assessReceipt(h.state.id, 'owner', 4, h.operationId), /changed/);
  const results = await Promise.allSettled([
    h.store.assessReceipt(h.state.id, 'owner', 5, h.operationId),
    new GraphCheckpoints(h.store.directory).assessReceipt(h.state.id, 'owner', 5, h.operationId),
  ]);
  assert.ok(results.some((result) => result.status === 'fulfilled'));
  for (const result of results) if (result.status === 'rejected') assert.match(String(result.reason), /changed/);
  assert.equal((await h.read()).revision, 6);
  await assert.rejects(h.store.assessReceipt(h.state.id, 'owner', 6, randomUUID()), /Unknown/);
});

test('plan and review assessments use their own contracts and never count reported tests as verification', async (t) => {
  const cases = [
    {
      contract: 'plan',
      value: { summary: 'Plan', tasks: ['Inspect'], acceptance: ['Reviewed'], tests: [] },
      outcome: 'success',
    },
    { contract: 'review', value: { summary: 'Pass', verdict: 'pass', issues: [] }, outcome: 'success' },
    { contract: 'review', value: { summary: 'Fail', verdict: 'fail', issues: ['Fix issue'] }, outcome: 'failure' },
  ] as const;
  for (const item of cases) {
    const h = await setup(t, true, item.contract);
    await captureGraphReceipt(h.store, {
      ...h.event,
      timeline: [h.event.timeline[0], { type: 'assistant_message', text: JSON.stringify(item.value) }],
    });
    const state = await h.store.assessReceipt(h.state.id, 'owner', 5, h.operationId);
    assert.deepEqual(state.activations[0].assessment, {
      status: 'valid',
      result: {
        summary: item.value.summary,
        outcome: item.outcome,
        artifact: { contract: item.contract, value: item.value },
      },
    });
    assert.equal(state.status, 'running');
    assert.equal(state.activations[0].result, undefined);
  }
});
