import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import React from 'react';
import { create, act } from 'react-test-renderer';

test('compact panel discovers models, launches a workflow, renders approvals and opens native sessions', async t => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await mkdir('node_modules/.cache', { recursive: true });
  const dir = await mkdtemp(join(process.cwd(), 'node_modules/.cache/teams-ui-')); t.after(() => rm(dir, { recursive: true, force: true }));
  let launched: unknown;
  const providers = [
    { id: 'claude', family: 'claude', label: 'Claude Code', models: [{ id: 'model-from-daemon', label: 'Discovered Claude', isDefault: true }], modes: [{ id: 'plan', label: 'Plan' }, { id: 'default', label: 'Default' }] },
    { id: 'codex', family: 'codex', label: 'Codex', models: [{ id: 'org/codex-from-daemon', label: 'Discovered Codex', isDefault: true }], modes: [{ id: 'read-only', label: 'Read only' }, { id: 'auto', label: 'Default' }] },
    { id: 'credit-account', family: 'claude', label: 'Claude — credits', models: [{ id: 'fable', label: 'Fable', isDefault: true }], modes: [{ id: 'plan', label: 'Plan' }, { id: 'default', label: 'Default' }] },
  ];
  const registry = {
    catalog: { cwd: '/repo', providers }, workflows: [] as unknown[],
    rpc: (name: string) => async (value: unknown) => { if (name === 'teams.create') { launched = value; return { id: 'workflow' }; } return undefined; },
  };
  (globalThis as Record<string, unknown>).__teamsTest = registry;
  t.after(() => { delete (globalThis as Record<string, unknown>).__teamsTest; });
  const bundle = await build({ entryPoints: ['client/panel.tsx'], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', plugins: [{ name: 'host-mocks', setup(b) {
    b.onResolve({ filter: /^(react-native|@getpaseo\/plugin\/client(?:\/ui)?|@tanstack\/react-query)$/ }, args => ({ path: args.path, namespace: 'host-mock' }));
    b.onLoad({ filter: /.*/, namespace: 'host-mock' }, args => ({ contents:
      args.path === 'react-native' ? `export const Platform={OS:'ios'}; export const Pressable='Pressable',ScrollView='ScrollView',Text='Text',TextInput='TextInput',View='View';` :
      args.path.endsWith('/ui') ? `export const SettingsSelect='SettingsSelect', SettingsSwitch='SettingsSwitch';` :
      args.path === '@tanstack/react-query' ? `export function useQuery({queryKey}) { const r=globalThis.__teamsTest; return {data:queryKey[0].includes('catalog')?r.catalog:r.workflows,refetch:async()=>{}}; }` :
      `export function useRpc(contract){return globalThis.__teamsTest.rpc(contract.name);}`
    }));
  } }] });
  const path = join(dir, 'panel.mjs'); await writeFile(path, bundle.outputFiles[0].text);
  const { TeamsPanel, ProgressCard } = await import(path);
  const colors = Object.fromEntries(['foreground', 'foregroundMuted', 'surface0', 'surface1', 'surface2', 'border', 'accent', 'accentForeground', 'statusDanger'].map(key => [key, key]));
  let opened = '';
  const props = { workspaceId: 'workspace', context: 'workspace', theme: { colors }, layout: { compact: true, platform: 'ios' }, host: { id: 'host', label: 'Local' }, navigation: { openAgent: ({ agentId }: { agentId: string }) => { opened = agentId; } } };
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(React.createElement(TeamsPanel, props)); });
  t.after(() => act(() => renderer.unmount()));
  assert.equal(renderer.root.find(node => String(node.type) === 'ScrollView').props.contentContainerStyle.padding, 12);
  assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Démarrer le workflow' }).props.disabled, true);
  assert.match(JSON.stringify(renderer.toJSON()), /Décrivez la tâche pour démarrer/);
  const modelSelects = renderer.root.findAll(node => String(node.type) === 'SettingsSelect').filter(x => x.props.label.includes('modèle'));
  assert.equal(modelSelects[0].props.options[0].value, 'model-from-daemon');
  assert.equal(modelSelects[1].props.value, 'org/codex-from-daemon');
  const reviewerMode = renderer.root.findAll(node => String(node.type) === 'SettingsSelect').find(x => x.props.label === 'reviewer · permissions')!;
  assert.deepEqual(reviewerMode.props.options.map((o: { value: string }) => o.value), ['plan']);
  const reviewerHarness = renderer.root.findAll(node => String(node.type) === 'SettingsSelect').find(x => x.props.label === 'reviewer · harnais')!;
  assert.ok(reviewerHarness.props.options.some((o: { label: string; value: string }) => o.label === 'Claude — credits' && o.value === 'credit-account'));
  await act(async () => { reviewerHarness.props.onValueChange('credit-account'); });
  assert.deepEqual(reviewerMode.props.options.map((o: { value: string }) => o.value), ['plan']);
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Tâche' }).props.onChangeText('OAuth2'); });
  assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Démarrer le workflow' }).props.disabled, false);
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Démarrer le workflow' }).props.onPress(); });
  assert.equal((launched as { task: string }).task, 'OAuth2');
  assert.deepEqual((launched as { config: { roles: { reviewer: unknown } } }).config.roles.reviewer, { provider: 'credit-account/fable', modeId: 'plan' });
  registry.workflows = [{ id: 'workflow', revision: 2, task: 'OAuth2', phase: 'building', status: 'awaiting_plan', cycle: 0, config: { maxCorrections: 2, mode: 'auto' }, agents: { planner: 'native-planner' }, plan: { summary: 'Plan', tests: [] }, tests: [], events: [] }];
  await act(async () => { renderer.update(React.createElement(TeamsPanel, props)); });
  assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Approuver le plan et les tests' }));
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Ouvrir planner' }).props.onPress(); });
  assert.equal(opened, 'native-planner');
  let card!: ReturnType<typeof create>;
  await act(async () => { card = create(React.createElement(ProgressCard, { ...props, agentId: 'planner', timestamp: new Date(), item: { data: { workflowId: 'workflow', status: 'completed', detail: 'Reviewed', cycle: 2 } } })); });
  assert.match(JSON.stringify(card.toJSON()), /Reviewed/); await act(async () => { card.unmount(); });
});
