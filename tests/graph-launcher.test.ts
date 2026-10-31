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
  assert.match(JSON.stringify(tree.toJSON()), /maxTransitions/);
  assert.match(JSON.stringify(tree.toJSON()), /isolated\/repo/);
  assert.equal(calls.filter((c) => c.name === 'teams.graph_confirm').length, 0);
  await act(async () => tree.root.findByType('TextInput' as never).props.onChangeText('Changed task'));
  assert.equal(button(confirm), undefined);
  await click(preview);
  await click(confirm);
  assert.match(JSON.stringify(tree.toJSON()), /Transport disconnected/);
  const failed = calls.at(-1)!;
  reject = false;
  await click(confirm);
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
