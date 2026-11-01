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
  const portable = field('Définition portable enregistrée (JSON)');
  assert.equal(portable.props.editable, false);
  assert.deepEqual(JSON.parse(portable.props.value), original.definition);
  assert.equal(calls.length, 0);
  await fill('Nom du workflow', 'Cycle révisé');
  assert.deepEqual(JSON.parse(field('Définition portable enregistrée (JSON)').props.value), original.definition);
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
  assert.deepEqual(JSON.parse(field('Saved portable definition (JSON)').props.value), original.definition);
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

test('routing edits validate reachability and terminal paths while preserving outcomes and saved snapshots', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { GraphEditor } = await loadResponseUi(t, 'client/graph-editor.tsx', '__routingEditor');
  const definition = codeReviewPreset({
    code: { provider: 'codex/model', modeId: 'auto' },
    review: { provider: 'claude/model', modeId: 'plan' },
  });
  const original = structuredClone(definition);
  let saved: typeof definition | undefined;
  (globalThis as Record<string, unknown>).__routingEditor = {
    rpc: () => async (input: { definition: typeof definition }) => {
      saved = input.definition;
      return input;
    },
  };
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__routingEditor;
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
  const select = (label: string) =>
    tree.root.findAllByType('SettingsSelect' as never).find((n) => n.props.label === label)!;
  const save = () =>
    tree.root
      .findAllByType('Pressable' as never)
      .find((n) => n.props.accessibilityLabel === 'Sauvegarder une nouvelle révision')!;
  const choose = async (label: string, value: string) => act(async () => select(label).props.onValueChange(value));
  assert.deepEqual(
    select('Destination : code / success').props.options.map((o: { value: string }) => o.value),
    ['end', 'step:code', 'step:review'],
  );
  await choose('Destination : code / success', 'end');
  assert.equal(save().props.disabled, true); // review is unreachable.
  await choose('Destination : code / success', 'step:review');
  await choose('Destination : code / failure', 'step:review');
  await choose('Destination : review / success', 'step:code');
  assert.equal(save().props.disabled, true); // no terminal path.
  await choose('Destination : review / success', 'end');
  await choose('Étape de départ', 'review');
  assert.equal(save().props.disabled, false);
  await act(async () => save().props.onPress());
  assert.equal(saved!.entry, 'review');
  assert.deepEqual(saved!.steps[0].transitions, [
    { outcome: 'success', target: 'review' },
    { outcome: 'failure', target: 'review' },
  ]);
  assert.deepEqual(definition, original);
  assert.equal(saved!.maxTransitions, original.maxTransitions);
});

test('step copies require explicit routing and removal preserves references, contracts and source snapshots', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { GraphEditor } = await loadResponseUi(t, 'client/graph-editor.tsx', '__stepEditor');
  const definition = codeReviewPreset({
    code: { provider: 'codex/model', modeId: 'auto' },
    review: { provider: 'claude/model', modeId: 'plan' },
  });
  definition.steps[1].tests = [{ command: 'node --test', timeoutMs: 1000 }];
  const original = structuredClone(definition);
  let saved: typeof definition | undefined;
  (globalThis as Record<string, unknown>).__stepEditor = {
    rpc: () => async (input: { definition: typeof definition }) => {
      saved = input.definition;
      return input;
    },
  };
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__stepEditor;
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
  const choose = async (label: string, value: string) =>
    act(async () =>
      tree.root
        .findAllByType('SettingsSelect' as never)
        .find((n) => n.props.label === label)!
        .props.onValueChange(value),
    );
  await choose('Contrat : code', 'review');
  const access = () =>
    tree.root.findAllByType('SettingsSelect' as never).find((n) => n.props.label === 'Accès au dépôt : code')!;
  assert.equal(access().props.value, 'read-only');
  assert.equal(access().props.disabled, true);
  await act(async () => access().props.onValueChange('write'));
  assert.equal(access().props.value, 'read-only');
  await choose('Contrat : code', 'build');
  assert.equal(access().props.value, 'read-only');
  assert.equal(access().props.disabled, false);
  await choose('Accès au dépôt : code', 'write');
  assert.equal(access().props.value, 'write');
  assert.equal(button('Supprimer l’étape : code').props.disabled, true);
  assert.equal(button('Supprimer l’étape : review').props.disabled, true);
  await click('Dupliquer l’étape : review');
  assert.equal(button('Sauvegarder une nouvelle révision').props.disabled, true);
  assert.equal(button('Supprimer l’étape : step-2').props.disabled, false);
  await choose('Destination : review / success', 'step:step-2');
  assert.equal(button('Supprimer l’étape : step-2').props.disabled, true);
  assert.equal(button('Sauvegarder une nouvelle révision').props.disabled, false);
  await click('Dupliquer l’étape : review');
  assert.ok(button('Supprimer l’étape : step-3'));
  await click('Supprimer l’étape : step-3');
  const field = tree.root
    .findAllByType('TextInput' as never)
    .find((n) => n.props.accessibilityLabel === 'Commande : step-2 / 1')!;
  await act(async () => field.props.onChangeText('npm test'));
  await click('Sauvegarder une nouvelle révision');
  assert.equal(saved!.steps.length, 3);
  assert.deepEqual(saved!.steps[2], {
    ...original.steps[1],
    id: 'step-2',
    tests: [{ command: 'npm test', timeoutMs: 1000 }],
  });
  assert.deepEqual(saved!.steps[1].tests, original.steps[1].tests);
  assert.deepEqual(definition, original);
  assert.equal(saved!.maxTransitions, original.maxTransitions);
  await choose('Destination : review / success', 'end');
  await click('Supprimer l’étape : step-2');
  assert.equal(button('Sauvegarder une nouvelle révision').props.disabled, false);
  await click('Sauvegarder une nouvelle révision');
  assert.deepEqual(saved, original);
  (globalThis as unknown as Record<string, { language?: string }>).__stepEditor.language = 'en';
  await act(async () =>
    tree.update(
      React.createElement(GraphEditor, {
        record: { id: 'saved', workspaceId: 'owner', revision: 1, definition },
        colors: {},
        onSaved: () => {},
        onCancel: () => {},
      }),
    ),
  );
  assert.ok(button('Duplicate step: review'));
  assert.equal(button('Remove step: code').props.disabled, true);
});

test('human step creation requires instructions and explicit routing, retains manual contracts and saved snapshots', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { GraphEditor } = await loadResponseUi(t, 'client/graph-editor.tsx', '__humanEditor');
  const definition = codeReviewPreset({
    code: { provider: 'codex/model', modeId: 'auto' },
    review: { provider: 'claude/model', modeId: 'plan' },
  });
  const original = structuredClone(definition);
  let saved: typeof definition | undefined;
  (globalThis as Record<string, unknown>).__humanEditor = {
    rpc: () => async (input: { definition: typeof definition }) => {
      saved = input.definition;
      return input;
    },
  };
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__humanEditor;
  });
  let tree!: ReturnType<typeof create>;
  const props = {
    record: { id: 'saved', workspaceId: 'owner', revision: 1, definition },
    colors: {},
    onSaved: () => {},
    onCancel: () => {},
  };
  await act(async () => {
    tree = create(React.createElement(GraphEditor, props));
  });
  t.after(() => act(() => tree.unmount()));
  const button = (label: string) =>
    tree.root.findAllByType('Pressable' as never).find((n) => n.props.accessibilityLabel === label)!;
  const select = (label: string) =>
    tree.root.findAllByType('SettingsSelect' as never).find((n) => n.props.label === label)!;
  const click = async (label: string) => act(async () => button(label).props.onPress());
  const choose = async (label: string, value: string) => act(async () => select(label).props.onValueChange(value));
  await click('Ajouter une étape humaine');
  assert.equal(button('Sauvegarder une nouvelle révision').props.disabled, true);
  assert.equal(button('Ajouter un test : step-2'), undefined);
  assert.equal(select('Contrat : step-2'), undefined);
  assert.equal(select('Accès au dépôt : step-2').props.disabled, true);
  await choose('Accès au dépôt : step-2', 'write');
  assert.equal(select('Accès au dépôt : step-2').props.value, 'read-only');
  await choose('Destination : review / success', 'step:step-2');
  assert.equal(button('Sauvegarder une nouvelle révision').props.disabled, true); // Empty instructions.
  await act(async () =>
    tree.root
      .findAllByType('TextInput' as never)
      .find((n) => n.props.accessibilityLabel === 'Consignes : step-2')!
      .props.onChangeText('Vérifier les preuves avant approbation.'),
  );
  await choose('Destination : step-2 / reject', 'step:code');
  assert.equal(button('Sauvegarder une nouvelle révision').props.disabled, false);
  assert.equal(button('Supprimer l’étape : step-2').props.disabled, true);
  await click('Ajouter une étape humaine');
  assert.ok(button('Supprimer l’étape : step-3'));
  await click('Supprimer l’étape : step-3');
  await click('Sauvegarder une nouvelle révision');
  assert.deepEqual(saved!.steps[2], {
    id: 'step-2',
    contract: 'human',
    instruction: 'Vérifier les preuves avant approbation.',
    selection: { provider: 'human', modeId: 'manual' },
    access: 'read-only',
    transitions: [
      { outcome: 'approve', target: null },
      { outcome: 'reject', target: 'code' },
    ],
  });
  assert.deepEqual(saved!.steps[0], original.steps[0]);
  assert.equal(saved!.maxTransitions, original.maxTransitions);
  assert.deepEqual(definition, original);
  (globalThis as unknown as Record<string, { language?: string }>).__humanEditor.language = 'en';
  await act(async () => tree.update(React.createElement(GraphEditor, props)));
  assert.ok(button('Add a human step'));
  assert.match(JSON.stringify(tree.toJSON()), /waits for an explicit decision/);
});

test('native selection editing uses detected models and verified read-only modes without replacing saved choices', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { GraphEditor } = await loadResponseUi(t, 'client/graph-editor.tsx', '__nativeEditor');
  const definition = codeReviewPreset({
    code: { provider: 'legacy/model', modeId: 'old' },
    review: { provider: 'legacy/review', modeId: 'old' },
  });
  const original = structuredClone(definition);
  const providers = [
    {
      id: 'codex',
      family: 'codex',
      models: [{ id: 'detected/model' }],
      modes: [{ id: 'read-only' }, { id: 'default' }],
    },
    { id: 'claude', family: 'claude', models: [{ id: 'detected' }], modes: [{ id: 'plan' }, { id: 'default' }] },
    { id: 'unknown', family: 'unknown', models: [{ id: 'model' }], modes: [{ id: 'read-only' }] },
    { id: 'agent-teams', family: 'codex', models: [{ id: 'auto' }], modes: [{ id: 'read-only' }] },
  ];
  let saved: typeof definition | undefined;
  let fail = true;
  (globalThis as Record<string, unknown>).__nativeEditor = {
    rpc: (name: string) => async (input: { workspaceId: string; definition: typeof definition }) => {
      assert.equal(input.workspaceId, 'owner');
      if (name === 'teams.catalog') {
        if (fail) throw new Error('Catalogue unavailable');
        return { providers };
      }
      saved = input.definition;
      return input;
    },
  };
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__nativeEditor;
  });
  let tree!: ReturnType<typeof create>;
  const props = {
    record: { id: 'saved', workspaceId: 'owner', revision: 1, definition },
    colors: {},
    onSaved: () => {},
    onCancel: () => {},
  };
  await act(async () => {
    tree = create(React.createElement(GraphEditor, props));
  });
  t.after(() => act(() => tree.unmount()));
  const button = (label: string) =>
    tree.root.findAllByType('Pressable' as never).find((n) => n.props.accessibilityLabel === label)!;
  const select = (label: string) =>
    tree.root.findAllByType('SettingsSelect' as never).find((n) => n.props.label === label)!;
  const click = async (label: string) => act(async () => button(label).props.onPress());
  const choose = async (label: string, value: string) => act(async () => select(label).props.onValueChange(value));
  await click('Rechercher les modèles et permissions disponibles');
  assert.match(JSON.stringify(tree.toJSON()), /Catalogue unavailable/);
  await click('Sauvegarder une nouvelle révision');
  assert.deepEqual(saved, original);
  fail = false;
  await click('Rechercher les modèles et permissions disponibles');
  const review = () => select('Modèle : review');
  assert.equal(review().props.value, original.steps[1].selection.provider);
  assert.deepEqual(
    review().props.options.map((o: { value: string }) => o.value),
    ['legacy/review', 'codex/detected/model', 'claude/detected'],
  );
  await choose('Modèle : review', 'unknown/model');
  assert.equal(review().props.value, original.steps[1].selection.provider);
  const next = { provider: 'claude/detected', modeId: 'plan' };
  await choose('Modèle : review', next.provider);
  assert.equal(select('Permissions natives : review').props.value, 'old');
  await choose('Permissions natives : review', 'default');
  assert.equal(select('Permissions natives : review').props.value, 'old');
  await choose('Permissions natives : review', next.modeId);
  await choose('Modèle : code', 'codex/detected/model');
  await choose('Permissions natives : code', 'default');
  await choose('Accès au dépôt : code', 'read-only');
  assert.equal(select('Permissions natives : code').props.value, 'default');
  await choose('Permissions natives : code', 'read-only');
  await click('Sauvegarder une nouvelle révision');
  assert.deepEqual(saved!.steps[1], { ...original.steps[1], selection: next });
  assert.deepEqual(definition, original);
  await click('Ajouter une étape humaine');
  assert.equal(select('Modèle : step-2'), undefined);
  (globalThis as unknown as Record<string, { language?: string }>).__nativeEditor.language = 'en';
  await act(async () => tree.update(React.createElement(GraphEditor, props)));
  assert.ok(button('Find available models and permissions'));
  assert.ok(select('Model: review'));
});
