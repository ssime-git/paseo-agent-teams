import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { loadResponseUi } from './response-ui-harness';
import { codeReviewPreset } from '../shared/workflow-definition';

test('preview explains branches, budgets, human decisions and exact commands in French and English', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { GraphDefinition } = await loadResponseUi(t, 'client/graph-definition.tsx', '__graphDefinitionTest');
  const definition = codeReviewPreset(
    { code: { provider: 'codex', modeId: 'detected-code' }, review: { provider: 'claude', modeId: 'detected-review' } },
    2,
  );
  definition.steps[0].tests = [{ command: 'npm test -- --filter="long label"', timeoutMs: 1000 }];
  definition.steps[1].transitions[0].target = 'decision';
  definition.steps.push({
    id: 'decision',
    instruction: 'Décider plus tard',
    access: 'read-only',
    contract: 'human',
    selection: { provider: 'codex', modeId: 'default' },
    transitions: [
      { outcome: 'approve', target: null },
      { outcome: 'reject', target: 'code' },
    ],
  });
  const before = structuredClone(definition);
  const host = { language: 'fr' };
  (globalThis as Record<string, unknown>).__graphDefinitionTest = host;
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__graphDefinitionTest;
  });
  let tree!: ReturnType<typeof create>;
  const render = () => React.createElement(GraphDefinition, { definition, colors: {} });
  await act(async () => {
    tree = create(render());
  });
  t.after(() => act(() => tree.unmount()));
  const content = () =>
    tree.root
      .findAllByType('Text' as never)
      .map((n) => n.children.join(''))
      .join('\n');
  assert.match(content(), /Budget global : 6 activations/);
  assert.match(content(), /Échec → code/);
  assert.match(content(), /Réussite → decision/);
  assert.match(content(), /Refus → code/);
  assert.match(content(), /Approbation → Fin du parcours/);
  assert.match(content(), /Décision humaine/);
  assert.match(content(), /Lecture seule/);
  host.language = 'en';
  await act(async () => {
    tree.update(render());
  });
  assert.match(content(), /Global budget: 6 activations/);
  assert.match(content(), /Approval → End of path/);
  assert.match(content(), /Human decision/);
  assert.match(content(), /codex · detected-code/);
  assert.ok(content().includes(definition.steps[0].tests[0].command));
  assert.match(content(), /Décider plus tard/);
  assert.deepEqual(definition, before);
});
