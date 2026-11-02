import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { loadResponseUi } from './response-ui-harness';
import { codeReviewPreset } from '../shared/workflow-definition';

test('import validates, invalidates preview on edits and explicitly saves a new identity without admission', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { GraphImport } = await loadResponseUi(t, 'client/graph-import.tsx', '__importTest');
  const definition = codeReviewPreset(
    {
      code: { provider: 'codex/model', modeId: 'workspace-write' },
      review: { provider: 'claude/model', modeId: 'plan' },
    },
    2,
  );
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  let fail = true,
    saved: unknown;
  (globalThis as Record<string, unknown>).__importTest = {
    rpc: (name: string) => async (input: Record<string, unknown>) => {
      calls.push({ name, input });
      if (fail) throw new Error('offline');
      return { id: 'new', definition: input.definition };
    },
  };
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__importTest;
  });
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      React.createElement(GraphImport, {
        workspaceId: 'workspace',
        colors: {},
        onSaved: (v: unknown) => {
          saved = v;
        },
      }),
    );
  });
  t.after(() => act(() => tree.unmount()));
  const buttons = () => tree.root.findAllByType('Pressable' as never);
  const button = (label: string) => buttons().find((n) => n.props.accessibilityLabel === label)!;
  const fill = (value: string) => act(async () => tree.root.findByType('TextInput' as never).props.onChangeText(value));
  const press = (label: string) => act(async () => button(label).props.onPress());
  await press('Importer un workflow (JSON)');
  for (const value of [
    '{',
    JSON.stringify({ ...definition, entry: 'missing' }),
    JSON.stringify({ id: 'foreign', definition }),
  ]) {
    await fill(value);
    await press('Valider et prévisualiser l’import');
    assert.ok(!button('Confirmer l’import comme nouveau workflow'));
    assert.equal(calls.length, 0);
  }
  await fill(JSON.stringify(definition));
  await press('Valider et prévisualiser l’import');
  assert.ok(button('Confirmer l’import comme nouveau workflow'));
  await fill('{}');
  assert.ok(!button('Confirmer l’import comme nouveau workflow'));
  await fill(JSON.stringify(definition));
  await press('Valider et prévisualiser l’import');
  await act(async () => {
    const send = button('Confirmer l’import comme nouveau workflow').props.onPress;
    send();
    send();
  });
  assert.equal(calls.length, 1);
  assert.ok(JSON.stringify(tree.toJSON()).includes('offline'));
  assert.deepEqual(JSON.parse(tree.root.findByType('TextInput' as never).props.value), definition);
  fail = false;
  await press('Confirmer l’import comme nouveau workflow');
  assert.ok(saved);
  assert.equal(typeof calls[0].input.creationKey, 'string');
  assert.deepEqual(calls[1], {
    name: 'teams.save_definition',
    input: { workspaceId: 'workspace', creationKey: calls[0].input.creationKey, expectedRevision: 0, definition },
  });
  assert.equal(tree.root.findAllByType('TextInput' as never).length, 0);
  ((globalThis as Record<string, unknown>).__importTest as { language: string }).language = 'en';
  await act(async () =>
    tree.update(React.createElement(GraphImport, { workspaceId: 'workspace', colors: {}, onSaved: () => {} })),
  );
  await press('Import a workflow (JSON)');
  await press('Cancel import');
  assert.equal(calls.length, 2);
});
