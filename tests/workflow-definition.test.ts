import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeReviewPreset, workflowDefinitionSchema } from '../shared/workflow-definition';
const selection = { provider: 'codex/detected-model', modeId: 'read-only' };
const preset = () => codeReviewPreset({ code: selection, review: selection });
test('versioned Code Review definition roundtrips with an explicit correction budget', () => {
  const graph = preset();
  assert.deepEqual(workflowDefinitionSchema.parse(JSON.parse(JSON.stringify(graph))), graph);
  assert.equal(graph.maxTransitions, 8);
  assert.equal(codeReviewPreset({ code: selection, review: selection }, 0).maxTransitions, 2);
  for (const limit of [-1, 1.5, 101, NaN])
    assert.throws(() => codeReviewPreset({ code: selection, review: selection }, limit));
});
test('graph validation rejects unsafe, ambiguous and disconnected definitions', () => {
  const mutations = [
    (g: ReturnType<typeof preset>) => {
      g.entry = 'missing';
    },
    (g: ReturnType<typeof preset>) => {
      g.steps[1].id = 'code';
    },
    (g: ReturnType<typeof preset>) => {
      g.steps[0].transitions[0].target = 'missing';
    },
    (g: ReturnType<typeof preset>) => {
      g.steps[0].transitions[0].target = null;
    },
    (g: ReturnType<typeof preset>) => {
      g.steps[1].transitions[1].outcome = 'success';
    },
    (g: ReturnType<typeof preset>) => {
      g.steps[1].access = 'write';
    },
    (g: ReturnType<typeof preset>) => {
      g.maxTransitions = 0;
    },
    (g: ReturnType<typeof preset>) => {
      g.steps[1].transitions.pop();
    },
    (g: ReturnType<typeof preset>) => {
      for (const s of g.steps) for (const e of s.transitions) e.target = 'code';
    },
  ];
  for (const mutate of mutations) {
    const graph = preset();
    mutate(graph);
    assert.equal(workflowDefinitionSchema.safeParse(graph).success, false);
  }
  assert.equal(workflowDefinitionSchema.safeParse({ ...preset(), version: 2 }).success, false);
});
test('arbitrary named steps and a human approval branch are supported', () => {
  const graph = preset();
  graph.steps[1].transitions[0].target = 'decision';
  graph.steps.push({
    id: 'decision',
    instruction: 'Approve delivery',
    selection,
    access: 'read-only',
    contract: 'human',
    transitions: [
      { outcome: 'approve', target: null },
      { outcome: 'reject', target: 'code' },
    ],
  });
  assert.deepEqual(workflowDefinitionSchema.parse(graph), graph);
});
