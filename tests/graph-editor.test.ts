import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { loadResponseUi } from './response-ui-harness';
import { codeReviewPreset } from '../shared/workflow-definition';

test('saved definition editing retains draft on conflicts, validates budgets and preserves revision identity on retries', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { GraphEditor } = await loadResponseUi(t, 'client/graph-editor.tsx', '__editorTest');
  const definition = codeReviewPreset({
    code: { provider: 'codex/detected', modeId: 'auto' },
    review: { provider: 'claude/detected', modeId: 'plan' },
  });
  definition.steps[0].tests = [{ command: 'node --test', timeoutMs: 5000 }];
  const record = { version: 1, id: 'persisted', workspaceId: 'workspace', revision: 7, definition };
  const original = structuredClone(record);
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  let fail = true,
    saved: unknown;
  (globalThis as Record<string, unknown>).__editorTest = {
    rpc: (name: string) => async (input: Record<string, unknown>) => {
      calls.push({ name, input });
      if (fail) throw new Error('Revision conflict');
      return { ...record, revision: 8, definition: input.definition };
    },
  };
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__editorTest;
  });
  let tree!: ReturnType<typeof create>;
  const props = {
    record,
    colors: {},
    onSaved: (v: unknown) => {
      saved = v;
    },
    onCancel: () => {},
  };
  await act(async () => {
    tree = create(React.createElement(GraphEditor, props));
  });
  t.after(() => act(() => tree.unmount()));
  const button = (label: string) =>
    tree.root.findAllByType('Pressable' as never).find((n) => n.props.accessibilityLabel === label)!;
  const field = (label: string) =>
    tree.root.findAllByType('TextInput' as never).find((n) => n.props.accessibilityLabel === label)!;
  const fill = async (label: string, value: string) => act(async () => field(label).props.onChangeText(value));
  assert.equal(calls.length, 0);
  await fill('Nom du workflow', 'Cycle révisé');
  await fill('Budget global d’activations', '0');
  assert.equal(button('Sauvegarder une nouvelle révision').props.disabled, true);
  await fill('Budget global d’activations', '6');
  await fill('Consignes : code', 'Implement only the requested change.');
  await fill('Commande : code / 1', 'npm test -- --literal="$HOME"');
  await fill('Délai en ms : code / 1', '30001');
  assert.equal(button('Sauvegarder une nouvelle révision').props.disabled, true);
  await fill('Délai en ms : code / 1', '1000');
  await act(async () => {
    const press = button('Sauvegarder une nouvelle révision').props.onPress;
    press();
    press();
  });
  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(tree.toJSON()), /Revision conflict/);
  assert.equal(field('Nom du workflow').props.value, 'Cycle révisé');
  assert.equal(saved, undefined);
  fail = false;
  await act(async () => button('Sauvegarder une nouvelle révision').props.onPress());
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[1].name, 'teams.save_definition');
  assert.equal(calls[1].input.expectedRevision, 7);
  assert.equal(calls[1].input.id, record.id);
  const updated = calls[1].input.definition as typeof definition;
  assert.deepEqual(updated.steps[1], original.definition.steps[1]);
  assert.deepEqual(updated.steps[0].transitions, original.definition.steps[0].transitions);
  assert.deepEqual(updated.steps[0].tests, [{ command: 'npm test -- --literal="$HOME"', timeoutMs: 1000 }]);
  assert.deepEqual(record, original);
  assert.ok(saved);
  ((globalThis as Record<string, unknown>).__editorTest as { language: string }).language = 'en';
  await act(async () => tree.update(React.createElement(GraphEditor, props)));
  assert.ok(button('Save a new revision'));
  assert.equal(field('Workflow name').props.value, 'Cycle révisé');
});
