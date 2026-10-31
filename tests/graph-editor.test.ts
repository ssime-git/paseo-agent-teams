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

test('test editing supports removal, explicit empty commands and bounded lists without mutating saved definitions', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { GraphEditor } = await loadResponseUi(t, 'client/graph-editor.tsx', '__testsEditor');
  const definition = codeReviewPreset({
    code: { provider: 'codex/model', modeId: 'auto' },
    review: { provider: 'claude/model', modeId: 'plan' },
  });
  definition.steps[0].tests = [{ command: 'original', timeoutMs: 1000 }];
  const original = structuredClone(definition);
  let saved: typeof definition | undefined;
  (globalThis as Record<string, unknown>).__testsEditor = {
    rpc: () => async (input: { definition: typeof definition }) => {
      saved = input.definition;
      return input;
    },
  };
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__testsEditor;
  });
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      React.createElement(GraphEditor, {
        record: { id: 'saved', workspaceId: 'owner', revision: 1, definition },
        colors: {},
        onSaved: () => {},
        onCancel: () => {},
      }),
    );
  });
  t.after(() => act(() => tree.unmount()));
  const button = (label: string) =>
    tree.root.findAllByType('Pressable' as never).find((n) => n.props.accessibilityLabel === label)!;
  const click = async (label: string) => act(async () => button(label).props.onPress());
  await click('Supprimer le test : code / 1');
  assert.match(JSON.stringify(tree.toJSON()), /décision humaine explicite/);
  await click('Sauvegarder une nouvelle révision');
  assert.equal(Object.hasOwn(saved!.steps[0], 'tests'), false);
  await click('Ajouter un test : code');
  assert.equal(button('Sauvegarder une nouvelle révision').props.disabled, true);
  const field = () =>
    tree.root.findAllByType('TextInput' as never).find((n) => n.props.accessibilityLabel === 'Commande : code / 1')!;
  await act(async () => field().props.onChangeText('node --test'));
  assert.equal(button('Sauvegarder une nouvelle révision').props.disabled, false);
  for (let i = 1; i < 10; i++) await click('Ajouter un test : code');
  assert.equal(button('Ajouter un test : code').props.disabled, true);
  for (let i = 10; i > 1; i--) await click(`Supprimer le test : code / ${i}`);
  await click('Sauvegarder une nouvelle révision');
  assert.deepEqual(saved!.steps[0].tests, [{ command: 'node --test', timeoutMs: 1000 }]);
  assert.deepEqual(definition, original);
});

test('explicit reload keeps failed drafts and rebases only after reading the latest saved revision', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { GraphEditor } = await loadResponseUi(t, 'client/graph-editor.tsx', '__reloadEditor');
  const definition = codeReviewPreset({
    code: { provider: 'codex/model', modeId: 'auto' },
    review: { provider: 'claude/model', modeId: 'plan' },
  });
  const record = { id: 'saved', workspaceId: 'owner', revision: 1, definition };
  const latest = structuredClone({ ...record, revision: 2 });
  latest.definition.name = 'Concurrent revision';
  latest.definition.maxTransitions = 8;
  latest.definition.steps[0].instruction = 'New instructions';
  let readable = false,
    writable = false;
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  (globalThis as Record<string, unknown>).__reloadEditor = {
    rpc: (name: string) => async (input: Record<string, unknown>) => {
      calls.push({ name, input });
      if (name === 'teams.list_definitions') return readable ? [latest] : [];
      if (!writable) throw new Error('Workflow definition changed; reload before saving');
      return { ...latest, revision: 3, definition: input.definition };
    },
  };
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__reloadEditor;
  });
  let tree!: ReturnType<typeof create>;
  const props = { record, colors: {}, onSaved: () => {}, onCancel: () => {} };
  await act(async () => {
    tree = create(React.createElement(GraphEditor, props));
  });
  t.after(() => act(() => tree.unmount()));
  const button = (label: string) =>
    tree.root.findAllByType('Pressable' as never).find((n) => n.props.accessibilityLabel === label)!;
  const field = (label: string) =>
    tree.root.findAllByType('TextInput' as never).find((n) => n.props.accessibilityLabel === label)!;
  const click = async (label: string) => act(async () => button(label).props.onPress());
  const reload = 'Abandonner le brouillon et recharger la dernière révision';
  assert.equal(button(reload), undefined);
  await act(async () => field('Nom du workflow').props.onChangeText('My draft'));
  await click('Sauvegarder une nouvelle révision');
  assert.equal(calls.length, 1); // No automatic read or discard on conflict.
  await click(reload);
  assert.equal(field('Nom du workflow').props.value, 'My draft');
  assert.match(JSON.stringify(tree.toJSON()), /brouillon est conservé/);
  readable = true;
  await act(async () => {
    const press = button(reload).props.onPress;
    press();
    press();
  });
  assert.equal(calls.filter((c) => c.name === 'teams.list_definitions').length, 2);
  assert.equal(field('Nom du workflow').props.value, latest.definition.name);
  assert.equal(field('Budget global d’activations').props.value, '8');
  assert.equal(field('Consignes : code').props.value, 'New instructions');
  assert.equal(button(reload), undefined);
  writable = true;
  await click('Sauvegarder une nouvelle révision');
  assert.equal(calls.at(-1)!.input.expectedRevision, 2);
  assert.deepEqual(calls.at(-1)!.input.definition, latest.definition);
  assert.equal(record.revision, 1);
});
