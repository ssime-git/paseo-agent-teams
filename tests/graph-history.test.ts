import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { loadResponseUi } from './response-ui-harness';
import type { GraphCheckpoint } from '../shared/graph-checkpoint';

test('graph history exposes prior refusals, answers, tests and final report with independent interface language', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const host = {
    language: 'fr',
    rpc: () => {
      throw Error('History is read-only');
    },
  };
  (globalThis as Record<string, unknown>).__graphHistory = host;
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__graphHistory;
  });
  const { GraphHistory } = await loadResponseUi(t, 'client/graph-history.tsx', '__graphHistory');
  const state = {
    source: {
      definition: {
        steps: [
          { id: 'plan', selection: { provider: 'claude/planner' } },
          { id: 'inspect', selection: { provider: 'codex/reviewer' } },
          { id: 'human', selection: { provider: 'human/decision' } },
        ],
      },
    },
    activations: [
      {
        operationId: 'q',
        stepId: 'plan',
        assessment: {
          status: 'clarification',
          request: {
            summary: 'Choisir',
            questions: [{ id: 'greeting', title: 'Salutation ?', options: [{ id: 'bonjour', label: 'Bonjour' }] }],
          },
        },
        clarificationAnswers: [{ questionId: 'greeting', optionId: 'bonjour', text: 'Préserver les documents' }],
      },
      {
        operationId: 'fail',
        stepId: 'inspect',
        result: {
          artifact: {
            contract: 'review',
            value: { verdict: 'fail', summary: 'Premier refus', issues: ['RESULT.txt:1 — valeur draft incorrecte'] },
          },
        },
        testRun: {
          completion: { results: [{ command: 'node check.cjs', exitCode: 1, stdout: '', stderr: '8 !== 15' }] },
        },
      },
      {
        operationId: 'pass',
        stepId: 'inspect',
        result: {
          artifact: { contract: 'review', value: { verdict: 'pass', summary: 'Rapport final vérifié', issues: [] } },
        },
      },
      { operationId: 'decision', stepId: 'human', humanDecision: { outcome: 'approve', summary: 'Accord explicite' } },
    ],
  } as unknown as GraphCheckpoint;
  let tree!: ReturnType<typeof create>;
  await act(() => {
    tree = create(React.createElement(GraphHistory, { state, colors: {} }));
  });
  t.after(() => act(() => tree.unmount()));
  const text = () => JSON.stringify(tree.toJSON());
  assert.match(text(), /Rapport final vérifié/);
  assert.doesNotMatch(text(), /Premier refus/);
  const press = (label: string) =>
    tree.root.findAllByType('Pressable' as never).find((n) => n.props.accessibilityLabel === label)!;
  await act(() => press('Historique des étapes').props.onPress());
  assert.match(text(), /Premier refus/);
  assert.match(text(), /Préserver les documents/);
  assert.match(text(), /claude\/planner/);
  assert.match(text(), /node check.cjs/);
  assert.match(text(), /Accord explicite/);
  await act(() => press('Sortie des tests').props.onPress());
  assert.match(text(), /8 !== 15/);
  host.language = 'en';
  await act(() => tree.update(React.createElement(GraphHistory, { state: { ...state }, colors: {} })));
  assert.match(text(), /Step history/);
  assert.match(text(), /Human decision: Approved/);
  assert.match(text(), /Exit code: 1/);
  assert.match(text(), /Rapport final vérifié/);
});
