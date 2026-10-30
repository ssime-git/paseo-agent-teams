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
