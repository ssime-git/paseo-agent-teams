import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { loadResponseUi } from './response-ui-harness';

test('launcher binds explicit confirmation to the displayed revision and retains identity after transport failure', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { GraphLauncher } = await loadResponseUi(t, 'client/graph-launcher.tsx', '__launchTest');
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const record = {
    id: 'definition',
    revision: 3,
    definition: { name: 'Custom workflow', maxTransitions: 4, steps: [] },
  };
  let reject = true;
  let admissions = 0;
  (globalThis as Record<string, unknown>).__launchTest = {
    rpc: (name: string) => async (input: Record<string, unknown>) => {
      calls.push({ name, input });
      if (name === 'teams.list_definitions') return [record];
      if (name === 'teams.graph_preview')
        return {
          source: record,
          task: input.task,
          language: input.language,
          repository: { root: '/isolated/repo' },
          confirmation: 'a'.repeat(64),
        };
      if (reject) throw new Error('Transport disconnected');
      return { id: input.id };
    },
  };
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__launchTest;
  });
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      React.createElement(GraphLauncher, {
        workspaceId: 'workspace',
        ownerAgentId: 'owner',
        colors: {},
        onAdmitted: () => admissions++,
      }),
    );
  });
  t.after(() => act(() => tree.unmount()));
  const button = (label: string) =>
    tree.root.findAllByType('Pressable' as never).find((n) => n.props.accessibilityLabel === label)!;
  const click = async (label: string) => {
    await act(async () => button(label).props.onPress());
  };
  const preview = 'Prévisualiser ce workflow';
  const confirm = 'Confirmer cette définition et réserver le dépôt';
  assert.equal(calls.length, 0);
  await click('Lancer un workflow sauvegardé');
  await click('Custom workflow · Révision 3');
  assert.equal(button(preview).props.disabled, true);
  await act(async () => tree.root.findByType('TextInput' as never).props.onChangeText('Build it'));
  await click(preview);
  assert.equal(calls.at(-1)!.input.language, 'fr');
  assert.match(JSON.stringify(tree.toJSON()), /maxTransitions/);
  assert.match(JSON.stringify(tree.toJSON()), /isolated\/repo/);
  assert.equal(calls.filter((c) => c.name === 'teams.graph_confirm').length, 0);
  await act(async () => tree.root.findByType('TextInput' as never).props.onChangeText('Changed task'));
  assert.equal(button(confirm), undefined);
  await click(preview);
  await click(confirm);
  assert.match(JSON.stringify(tree.toJSON()), /Transport disconnected/);
  const failed = calls.at(-1)!;
  assert.equal(failed.input.language, 'fr');
  // Changing this client's language after preview must not reinterpret its confirmation.
  ((globalThis as Record<string, unknown>).__launchTest as { language?: string }).language = 'en';
  reject = false;
  await act(async () => {
    tree.update(
      React.createElement(GraphLauncher, {
        workspaceId: 'workspace',
        ownerAgentId: 'owner',
        colors: {},
        onAdmitted: () => admissions++,
      }),
    );
  });
  assert.equal(button(confirm), undefined);
  assert.match(JSON.stringify(tree.toJSON()), /Response language: FR/);
  await click('Confirm this definition and reserve the repository');
  assert.deepEqual(calls.at(-1), failed);
  assert.equal(failed.input.task, 'Changed task');
  assert.equal(failed.input.definitionRevision, 3);
  assert.equal(failed.input.confirmation, 'a'.repeat(64));
  assert.equal(failed.input.approveDefinition, true);
  assert.equal(admissions, 1);
  assert.equal(button(confirm), undefined);
  assert.ok(calls.every((c) => c.name !== 'teams.graph_advance'));
});

test('editing invalidates the launch confirmation and previews only the newly saved revision', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { codeReviewPreset } = await import('../shared/workflow-definition');
  const { GraphLauncher } = await loadResponseUi(t, 'client/graph-launcher.tsx', '__editLaunchTest');
  const record = {
    id: 'saved',
    workspaceId: 'workspace',
    revision: 3,
    definition: codeReviewPreset({
      code: { provider: 'codex/detected', modeId: 'auto' },
      review: { provider: 'claude/detected', modeId: 'plan' },
    }),
  };
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  (globalThis as Record<string, unknown>).__editLaunchTest = {
    rpc: (name: string) => async (input: Record<string, unknown>) => {
      calls.push({ name, input });
      if (name === 'teams.list_definitions') return [record];
      if (name === 'teams.save_definition') return { ...record, revision: 4, definition: input.definition };
      assert.equal(name, 'teams.graph_preview');
      return {
        source: { ...record, revision: input.definitionRevision },
        task: input.task,
        repository: { root: '/repo' },
        confirmation: 'a'.repeat(64),
      };
    },
  };
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__editLaunchTest;
  });
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      React.createElement(GraphLauncher, {
        workspaceId: 'workspace',
        ownerAgentId: 'owner',
        colors: {},
        onAdmitted: () => assert.fail('must not admit'),
      }),
    );
  });
  t.after(() => act(() => tree.unmount()));
  const button = (label: string) =>
    tree.root.findAllByType('Pressable' as never).find((n) => n.props.accessibilityLabel === label)!;
  const click = async (label: string) => act(async () => button(label).props.onPress());
  await click('Lancer un workflow sauvegardé');
  await click('Code ↔ Review · Révision 3');
  await act(async () => tree.root.findByType('TextInput' as never).props.onChangeText('Keep the objective'));
  await click('Prévisualiser ce workflow');
  const confirm = 'Confirmer cette définition et réserver le dépôt';
  assert.ok(button(confirm));
  await click('Modifier cette définition');
  assert.equal(button(confirm), undefined);
  assert.equal(button('Prévisualiser ce workflow').props.disabled, true);
  assert.equal(button('Lancer un workflow sauvegardé'), undefined);
  await click('Annuler les modifications');
  assert.equal(button(confirm), undefined);
  await click('Modifier cette définition');
  await click('Sauvegarder une nouvelle révision');
  assert.ok(button('Code ↔ Review · Révision 4'));
  assert.equal(button(confirm), undefined);
  await click('Prévisualiser ce workflow');
  assert.equal(calls.at(-1)!.input.definitionRevision, 4);
  assert.equal(calls.at(-1)!.input.task, 'Keep the objective');
  assert.ok(calls.every((c) => c.name !== 'teams.graph_confirm'));
});

for (const duringPreview of [false, true]) {
  test(`open launcher follows app locale ${duringPreview ? 'during a pending preview' : 'before preview'} while preserving the preview language`, async (t) => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const key = `__localeLaunch${duringPreview}`;
    const { GraphLauncher } = await loadResponseUi(t, 'client/graph-launcher.tsx', key, { appLocale: true });
    const record = {
      id: 'definition',
      revision: 3,
      definition: { name: 'Custom workflow', maxTransitions: 4, steps: [] },
    };
    const calls: { name: string; input: Record<string, unknown> }[] = [];
    let resolvePreview!: (value: unknown) => void;
    let admitted: unknown;
    const host = {
      appLocale: 'fr-FR',
      language: 'fr',
      rpc: (name: string) => async (input: Record<string, unknown>) => {
        calls.push({ name, input });
        if (name === 'teams.list_definitions') return [record];
        if (name === 'teams.graph_preview') return new Promise((resolve) => (resolvePreview = resolve));
        assert.equal(name, 'teams.graph_confirm');
        return { id: input.id, language: input.language };
      },
    };
    (globalThis as Record<string, unknown>)[key] = host;
    t.after(() => {
      Reflect.deleteProperty(globalThis, key);
    });
    const render = () =>
      React.createElement(GraphLauncher, {
        workspaceId: 'workspace',
        ownerAgentId: 'owner',
        colors: {},
        onAdmitted: (state: unknown) => {
          admitted = state;
        },
      });
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(render());
    });
    t.after(() => act(() => tree.unmount()));
    const button = (label: string) =>
      tree.root.findAllByType('Pressable' as never).find((node) => node.props.accessibilityLabel === label)!;
    const click = async (label: string) => act(async () => button(label).props.onPress());
    await click('Lancer un workflow sauvegardé');
    await click('Custom workflow · Révision 3');
    await act(async () => tree.root.findByType('TextInput' as never).props.onChangeText('Keep README.md and npm test'));
    if (duringPreview) await click('Prévisualiser ce workflow');
    host.appLocale = 'en-GB';
    await act(async () => tree.update(render()));
    assert.equal(tree.root.findByType('TextInput' as never).props.accessibilityLabel, 'Workflow objective');
    assert.equal(tree.root.findByType('TextInput' as never).props.value, 'Keep README.md and npm test');
    assert.equal(button('Preview this workflow').props.disabled, duringPreview);
    assert.equal(calls.filter((call) => call.name === 'teams.graph_confirm').length, 0);
    if (!duringPreview) await click('Preview this workflow');
    const request = calls.at(-1)!;
    assert.equal(request.name, 'teams.graph_preview');
    assert.equal(request.input.language, duringPreview ? 'fr' : 'en');
    assert.equal(request.input.definitionRevision, 3);
    assert.equal(request.input.task, 'Keep README.md and npm test');
    await act(async () => {
      resolvePreview({
        source: record,
        task: request.input.task,
        language: request.input.language,
        repository: { root: '/isolated/repo' },
        confirmation: 'b'.repeat(64),
      });
    });
    assert.match(JSON.stringify(tree.toJSON()), duringPreview ? /Response language: FR/ : /Response language: EN/);
    // Re-rendering and resolving a request never imply approval or dispatch.
    assert.equal(calls.filter((call) => call.name === 'teams.graph_confirm').length, 0);
    await click('Confirm this definition and reserve the repository');
    const confirmed = calls.at(-1)!;
    assert.equal(confirmed.input.language, request.input.language);
    assert.equal(confirmed.input.confirmation, 'b'.repeat(64));
    assert.equal(confirmed.input.task, request.input.task);
    assert.equal(confirmed.input.definitionRevision, request.input.definitionRevision);
    assert.equal(confirmed.input.approveDefinition, true);
    assert.deepEqual(admitted, { id: confirmed.input.id, language: request.input.language });
    assert.ok(calls.every((call) => call.name !== 'teams.graph_advance'));
    assert.equal(calls.length, 3);
  });
}
