import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { loadResponseUi } from './response-ui-harness';
import { workflowDefinitionSchema } from '../shared/workflow-definition';

test('preset saves detected selections, native read-only review, explicit tests and correction budget without admission', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { GraphPreset } = await loadResponseUi(t, 'client/graph-preset.tsx', '__presetTest');
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const providers = [
    {
      id: 'codex',
      family: 'codex',
      models: [{ id: 'detected/model', isDefault: true }],
      modes: [{ id: 'read-only' }, { id: 'workspace-write' }],
    },
    { id: 'claude', family: 'claude', models: [{ id: 'detected-review', isDefault: true }], modes: [{ id: 'plan' }] },
    {
      id: 'other',
      family: 'other',
      models: [{ id: 'unsafe', isDefault: true }],
      modes: [{ id: '__agent_teams_readonly__' }],
    },
    { id: 'agent-teams', family: 'agent-teams', models: [{ id: 'auto', isDefault: true }], modes: [{ id: 'default' }] },
  ];
  let saved: unknown;
  (globalThis as Record<string, unknown>).__presetTest = {
    rpc: (name: string) => async (input: Record<string, unknown>) => {
      calls.push({ name, input });
      if (name === 'teams.catalog') return { providers };
      assert.equal(name, 'teams.save_definition');
      return { id: 'saved', revision: 1, definition: input.definition };
    },
  };
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__presetTest;
  });
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      React.createElement(GraphPreset, {
        workspaceId: 'workspace',
        colors: {},
        onSaved: (v: unknown) => {
          saved = v;
        },
      }),
    );
  });
  t.after(() => act(() => tree.unmount()));
  const button = (label: string) =>
    tree.root.findAllByType('Pressable' as never).find((n) => n.props.accessibilityLabel === label)!;
  const select = (label: string) =>
    tree.root.findAllByType('SettingsSelect' as never).find((n) => n.props.label === label)!;
  const fill = async (label: string, text: string) =>
    act(async () =>
      tree.root
        .findAllByType('TextInput' as never)
        .find((n) => n.props.accessibilityLabel === label)!
        .props.onChangeText(text),
    );
  assert.equal(calls.length, 0);
  await act(async () => button('Créer Code ↔ Review').props.onPress());
  assert.equal(button('Sauvegarder ce preset').props.disabled, true);
  assert.equal(select('Code').props.options.length, 1);
  assert.equal(select('Revue').props.options.length, 2);
  assert.ok(!JSON.stringify(select('Revue').props.options).includes('unsafe'));
  await act(async () => {
    select('Code').props.onValueChange(select('Code').props.options[0].value);
    select('Revue').props.onValueChange(select('Revue').props.options[1].value);
    select('Corrections automatiques').props.onValueChange('0');
    select('Délai de test').props.onValueChange('1000');
  });
  assert.equal(button('Sauvegarder ce preset').props.disabled, true);
  await fill('Nom du workflow', 'Mon cycle');
  await fill('Commande de test explicite', ' npm test -- --filter="literal" ');
  assert.equal(button('Sauvegarder ce preset').props.disabled, false);
  await act(async () => {
    const press = button('Sauvegarder ce preset').props.onPress;
    press();
    press();
  });
  const saves = calls.filter((c) => c.name === 'teams.save_definition');
  assert.equal(saves.length, 1);
  assert.equal(saves[0].input.expectedRevision, 0);
  assert.equal(saves[0].input.workspaceId, 'workspace');
  const definition = workflowDefinitionSchema.parse(saves[0].input.definition);
  assert.equal(definition.name, 'Mon cycle');
  assert.equal(definition.maxTransitions, 2);
  assert.deepEqual(definition.steps[0].selection, { provider: 'codex/detected/model', modeId: 'workspace-write' });
  assert.deepEqual(definition.steps[1].selection, { provider: 'claude/detected-review', modeId: 'plan' });
  assert.deepEqual(definition.steps[0].tests, [{ command: 'npm test -- --filter="literal"', timeoutMs: 1000 }]);
  assert.equal(definition.steps[1].access, 'read-only');
  assert.ok(saved);
  assert.ok(calls.every((c) => !c.name.startsWith('teams.graph_')));
  ((globalThis as Record<string, unknown>).__presetTest as { language: string }).language = 'en';
  await act(async () => {
    tree.update(React.createElement(GraphPreset, { workspaceId: 'workspace', colors: {}, onSaved: () => {} }));
  });
  await act(async () => button('Create Code ↔ Review').props.onPress());
  assert.ok(button('Save this preset'));
  assert.match(JSON.stringify(tree.toJSON()), /Global budget: 2 activations/);
  assert.equal(calls.filter((c) => c.name === 'teams.save_definition').length, 1);
});
