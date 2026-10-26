import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphStatusReport } from '../server/graph-status';
import { translator } from '../shared/i18n';
import type { GraphCheckpoint } from '../shared/graph-checkpoint';

// Presentation-only fixtures; durable ledger validation is covered by graph-checkpoint.test.ts.
const state = {
  id: 'graph-uuid',
  revision: 4,
  status: 'waiting_human',
  nextStepId: 'custom-step',
  source: { revision: 2, definition: { name: 'Custom graph', maxTransitions: 7 } },
  activations: [{ stepId: 'custom-step' }],
} as GraphCheckpoint;

test('graph report renders exact revisions, step, budget, terminal states and bounded history', () => {
  const text = graphStatusReport([state], translator('en'));
  assert.match(text, /Custom graph · graph-uuid/);
  assert.match(text, /Saved version 2 · revision 4/);
  assert.match(text, /Waiting for a human decision/);
  assert.match(text, /custom-step · activations: 1\/7/);
  for (const [status, label] of Object.entries({
    ready: 'Ready to continue',
    running: 'Step in progress',
    succeeded: 'Completed successfully',
    failed: 'Failed',
    exhausted: 'Limit reached',
  })) {
    assert.ok(graphStatusReport([{ ...state, status } as GraphCheckpoint], translator('en')).includes(label));
  }
  const bounded = graphStatusReport(
    Array.from({ length: 15 }, () => state),
    translator('fr'),
  );
  assert.match(bounded, /15/);
  assert.match(bounded, /limité à 10/);
  assert.equal(bounded.split('graph-uuid').length, 11);
  assert.ok(bounded.length < 8000);
});

test('partial clarification answers remain visibly waiting instead of showing approval status', () => {
  const pending = structuredClone(state);
  pending.activations[0].assessment = {
    status: 'clarification',
    request: { questions: [{ id: 'a' }, { id: 'b' }] },
  } as NonNullable<GraphCheckpoint['activations'][number]['assessment']>;
  pending.activations[0].clarificationAnswers = [{ questionId: 'a', text: 'Free reply' }];
  assert.match(graphStatusReport([pending], translator('fr')), /En attente de réponse/);
  assert.match(graphStatusReport([pending], translator('en')), /Waiting for an answer/);
});
