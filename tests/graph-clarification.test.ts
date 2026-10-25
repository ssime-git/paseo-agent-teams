import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphCheckpoints } from '../server/graph-checkpoints';
import { DefinitionCatalog } from '../server/definition-catalog';
import { graphDispatchPrompt } from '../server/graph-preparation';
import { codeReviewPreset } from '../shared/workflow-definition';
import { graphCheckpointSchema } from '../shared/graph-checkpoint';

const request = {
  kind: 'clarification' as const,
  summary: 'Choose delivery and scope',
  questions: ['delivery', 'scope'].map((id) => ({
    id,
    title: `Choose ${id}`,
    recommendedOptionId: 'small',
    options: [
      { id: 'small', label: 'Small', tradeoff: 'Quick, limited scope' },
      { id: 'large', label: 'Large', tradeoff: 'Slower, broader scope' },
    ],
  })),
};
async function pending(t: { after: (fn: () => Promise<void>) => void }, maxTransitions = 4) {
  const directory = await mkdtemp(join(tmpdir(), 'teams-clarification-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const definition = codeReviewPreset({
    code: { provider: 'fixture/model', modeId: 'read-only' },
    review: { provider: 'fixture/model', modeId: 'read-only' },
  });
  definition.steps[0].contract = 'plan';
  definition.steps[0].access = 'read-only';
  definition.maxTransitions = maxTransitions;
  const source = await new DefinitionCatalog(join(directory, 'definitions')).save({
    workspaceId: 'owner',
    expectedRevision: 0,
    definition,
  });
  const store = new GraphCheckpoints(join(directory, 'graphs'));
  let state = await store.create({ id: randomUUID(), repo: '/isolated/.git', task: 'Clarify first', source });
  const op = randomUUID(),
    agentId = randomUUID(),
    attemptId = randomUUID();
  state = await store.reserve(state.id, 'owner', state.revision, op);
  state = await store.bindDispatch(state.id, 'owner', state.revision, op, {
    agentId,
    prompt: graphDispatchPrompt(state, op),
  });
  state = await store.claimDispatch(state.id, 'owner', state.revision, op, attemptId, 'a'.repeat(64));
  state = await store.receipt(state.id, 'owner', state.revision, op, {
    agentId,
    attemptId,
    turnId: 'native-turn',
    outcome: 'completed',
    text: JSON.stringify(request),
  });
  await assert.rejects(store.assessReceipt(state.id, 'owner', state.revision, op), /unchanged read-only/);
  state = await store.recordIntegrity(state.id, 'owner', state.revision, op, 'a'.repeat(64));
  state = await store.assessReceipt(state.id, 'owner', state.revision, op);
  return { store, state, op };
}

test('clarification waits durably, accepts partial explicit answers and resumes the same step with context', async (t) => {
  const { store, state, op } = await pending(t);
  assert.equal(state.status, 'waiting_human');
  const restarted = new GraphCheckpoints(store.directory);
  assert.deepEqual(await restarted.get(state.id, 'owner'), state);
  assert.deepEqual(await restarted.assessReceipt(state.id, 'owner', 1, op), state);
  await assert.rejects(restarted.reserve(state.id, 'owner', state.revision, randomUUID()), /cannot activate/);
  await assert.rejects(
    restarted.resolve(state.id, 'owner', state.revision, op, { outcome: 'success', summary: 'Silence' }),
    /cannot produce/,
  );
  const answer = { questionId: 'delivery', optionId: 'small' };
  const partial = await restarted.answerClarification(state.id, 'owner', state.revision, op, answer);
  assert.equal(partial.status, 'waiting_human');
  assert.deepEqual(await store.answerClarification(state.id, 'owner', 1, op, answer), partial);
  const ready = await store.answerClarification(state.id, 'owner', partial.revision, op, {
    questionId: 'scope',
    text: 'Custom scope; skip the optional export',
  });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.nextStepId, 'code');
  assert.equal(ready.activations[0].result, undefined);
  const nextOp = randomUUID();
  const next = await store.reserve(state.id, 'owner', ready.revision, nextOp);
  const prompt = graphDispatchPrompt(next, nextOp);
  assert.match(prompt, /Custom scope/);
  assert.match(prompt, /Quick, limited scope/);
  assert.match(prompt, /"questionId":"delivery","optionId":"small"/);
  assert.deepEqual(await restarted.answerClarification(state.id, 'owner', 1, op, answer), next);
  assert.equal(next.activations.length, 2);
});

test('clarification answers reject unknown input, stale clients, contradictions and corrupt persistence', async (t) => {
  const { store, state, op } = await pending(t);
  const answer = { questionId: 'delivery', optionId: 'large' };
  await assert.rejects(store.answerClarification(state.id, 'foreign', state.revision, op, answer), /access denied/);
  await assert.rejects(store.answerClarification(state.id, 'owner', 1, op, answer), /changed/);
  for (const invalid of [
    { questionId: 'other', text: 'Unknown' },
    { questionId: 'delivery', optionId: 'other' },
    { questionId: 'delivery', text: '  ' },
  ])
    await assert.rejects(store.answerClarification(state.id, 'owner', state.revision, op, invalid));
  const partial = await store.answerClarification(state.id, 'owner', state.revision, op, answer);
  await assert.rejects(
    store.answerClarification(state.id, 'owner', partial.revision, op, { ...answer, optionId: 'small' }),
    /differently/,
  );
  for (const change of [
    (s: typeof partial) => {
      s.activations[0].clarificationAnswers!.push(answer);
      s.revision++;
    },
    (s: typeof partial) => {
      s.activations[0].clarificationAnswers![0].optionId = 'forged';
    },
    (s: typeof partial) => {
      s.status = 'ready';
    },
    (s: typeof partial) => {
      s.activations[0].integrity!.unchanged = false;
    },
    (s: typeof partial) => {
      s.activations[0].result = { outcome: 'success', summary: 'Forged' };
      s.revision++;
    },
  ]) {
    const corrupt = structuredClone(partial);
    change(corrupt);
    assert.equal(graphCheckpointSchema.safeParse(corrupt).success, false);
  }
});

test('concurrent clarification answers publish once and resumption respects the finite budget', async (t) => {
  const { store, state, op } = await pending(t, 1);
  const rival = new GraphCheckpoints(store.directory);
  const results = await Promise.allSettled(
    [store, rival].map((s, i) =>
      s.answerClarification(state.id, 'owner', state.revision, op, {
        questionId: 'delivery',
        optionId: i ? 'large' : 'small',
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const partial = await store.get(state.id, 'owner');
  const exhausted = await store.answerClarification(state.id, 'owner', partial.revision, op, {
    questionId: 'scope',
    text: 'Explicit scope',
  });
  assert.equal(exhausted.status, 'exhausted');
  assert.equal(exhausted.activations.length, 1);
  await assert.rejects(store.reserve(state.id, 'owner', exhausted.revision, randomUUID()), /cannot activate/);
  assert.deepEqual(await rival.get(state.id, 'owner'), exhausted);
});

test('historical invalid clarification assessments remain readable without reinterpretation', async (t) => {
  const { state } = await pending(t);
  state.activations[0].assessment = {
    status: 'invalid',
    reason: 'Native output does not match the step result contract',
  };
  state.status = 'running';
  assert.deepEqual(graphCheckpointSchema.parse(state), state);
});
