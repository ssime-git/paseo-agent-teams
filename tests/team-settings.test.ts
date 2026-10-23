import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { defaultTeam, teamSettings, type TeamProviderChoice } from '../shared/team-composition';
import { workflowFixture } from './fixtures';

const providers: TeamProviderChoice[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    family: 'claude',
    models: [
      { id: 'claude-opus-5-5', label: 'Opus 5.5', isDefault: true },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', isDefault: false },
    ],
    modes: [{ id: 'plan' }, { id: 'default' }],
  },
  {
    id: 'codex',
    label: 'Codex',
    family: 'codex',
    models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', isDefault: true }],
    modes: [{ id: 'auto' }, { id: 'read-only' }],
  },
];

test('the default team keeps available saved choices and falls back to the automatic pick for the rest', () => {
  const saved = teamSettings.schema.parse({
    roles: { reviewer: { provider: 'claude/claude-sonnet-5-5' }, builder: { provider: 'gone/model' } },
  });
  assert.deepEqual(defaultTeam(providers, saved), {
    planner: { provider: 'claude/claude-opus-5-5', modeId: 'plan' },
    builder: { provider: 'codex/gpt-6.1-sol', modeId: 'auto' },
    reviewer: { provider: 'claude/claude-sonnet-5-5', modeId: 'plan' },
  });
  // A Builder needs write access: a saved read-only-only harness is replaced by a write-capable one.
  const readOnly = { ...providers[1], id: 'ro', modes: [{ id: 'read-only' }] };
  assert.equal(
    defaultTeam(
      [readOnly, providers[1]],
      teamSettings.schema.parse({ roles: { builder: { provider: 'ro/gpt-6.1-sol' } } }),
    ).builder.provider,
    'codex/gpt-6.1-sol',
  );
  assert.deepEqual(saved, { roles: saved.roles, validation: 'plan', maxCorrections: 2, language: 'fr' });
});

async function load(t: { after(fn: () => unknown): void }, entry: string) {
  await mkdir('node_modules/.cache', { recursive: true });
  const dir = await mkdtemp(join(process.cwd(), 'node_modules/.cache/team-settings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    jsx: 'automatic',
    plugins: [
      {
        name: 'host',
        setup(b) {
          b.onResolve({ filter: /^(react-native|@getpaseo\/plugin\/client(\/ui)?)$/ }, (args) => ({
            path: args.path,
            namespace: 'host',
          }));
          b.onLoad({ filter: /.*/, namespace: 'host' }, (args) => ({
            contents:
              args.path === 'react-native'
                ? `export const Pressable='Pressable',ScrollView='ScrollView',Text='Text',TextInput='TextInput',View='View';`
                : args.path.endsWith('/ui')
                  ? `export const SettingsSection='Section',SettingsSelect='Select',SettingsAction='Action';`
                  : `export function useRpc(contract){return globalThis.__teamSettingsTest.rpc(contract.name);}
                     export function useSettings(){return globalThis.__teamSettingsTest.settings;}`,
          }));
        },
      },
    ],
  });
  const path = join(dir, 'bundle.mjs');
  await writeFile(path, result.outputFiles[0].text);
  return import(path);
}

test('settings list eligible models per role and save a complete document against the shown revision', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const saves: { values: unknown; revision: string }[] = [];
  const host = {
    rpc: (name: string) => async () => (name === 'teams.choices' ? providers : []),
    settings: {
      status: 'ready',
      revision: 'r1',
      values: teamSettings.schema.parse({ roles: { builder: { provider: 'gone/model' } } }),
      saving: false,
      saveError: null,
      save: async (values: unknown, revision: string) => {
        saves.push({ values, revision });
        return true;
      },
      reset: async () => true,
    },
  };
  (globalThis as Record<string, unknown>).__teamSettingsTest = host;
  t.after(() => delete (globalThis as Record<string, unknown>).__teamSettingsTest);
  const { TeamSettings } = await load(t, 'client/team-settings.tsx');
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(React.createElement(TeamSettings, { theme: { colors: {} } }));
  });
  t.after(() => act(() => view.unmount()));
  const selects = view.root.findAll((n) => (n.type as unknown) === 'Select');
  assert.deepEqual(
    selects.map((s) => s.props.label),
    ['Langue de l’interface', 'Plan', 'Code', 'Revue', 'Mode par défaut', 'Corrections automatiques'],
  );
  const [language, plan, code] = selects;
  // Read-only roles only offer read-only capable harnesses; the Builder only write-capable ones.
  assert.deepEqual(
    code.props.options.map((o: { value: string }) => o.value),
    ['auto', 'claude/claude-opus-5-5', 'claude/claude-sonnet-5-5', 'codex/gpt-6.1-sol'],
  );
  assert.equal(code.props.options[0].label, 'Automatique (Codex · GPT-6.1-Sol)');
  assert.match(code.props.error, /n’est plus disponible/);
  await act(async () => plan.props.onValueChange('claude/claude-sonnet-5-5'));
  await act(async () => selects[5].props.onValueChange('0'));
  assert.deepEqual(saves[0], {
    revision: 'r1',
    values: {
      roles: { builder: { provider: 'gone/model' }, planner: { provider: 'claude/claude-sonnet-5-5' } },
      validation: 'plan',
      maxCorrections: 2,
      language: 'fr',
    },
  });
  assert.equal((saves[1].values as { maxCorrections: number }).maxCorrections, 0);
  await act(async () => code.props.onValueChange('auto'));
  assert.deepEqual((saves[2].values as { roles: object }).roles, {});
  // The language is saved with the rest of the document and announced to registered titles.
  await act(async () => language.props.onValueChange('en'));
  assert.equal((saves[3].values as { language: string }).language, 'en');
});

test('the Team card shows this thread mission team, or the default team before the first message', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const mission = workflowFixture();
  mission.requests = { 'create:team:agent-1:message': 'receipt' };
  mission.config.roles.builder = { provider: 'codex/gpt-6.1-sol', modeId: 'auto' };
  mission.status = 'running';
  mission.phase = 'building';
  const host = {
    workflows: [] as (typeof mission)[],
    rpc: (name: string) => async () => (name === 'teams.choices' ? providers : host.workflows),
    settings: { status: 'ready', revision: 'r', values: teamSettings.schema.parse({}) },
  };
  (globalThis as Record<string, unknown>).__teamSettingsTest = host;
  t.after(() => delete (globalThis as Record<string, unknown>).__teamSettingsTest);
  const { TeamCard } = await load(t, 'client/team-card.tsx');
  const actions: string[] = [];
  const props = {
    context: 'agent',
    agentId: 'agent-1',
    workspaceId: 'w',
    theme: { colors: {} },
    layout: { compact: false },
    close: () => actions.push('close'),
    openSettings: () => actions.push('settings'),
  };
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(React.createElement(TeamCard, props));
  });
  t.after(() => act(() => view.unmount()));
  let text = JSON.stringify(view.toJSON());
  assert.match(text, /Équipe par défaut/);
  assert.match(text, /Opus 5\.5.*GPT-6\.1-Sol.*Opus 5\.5/);
  host.workflows = [mission];
  await act(async () => {
    view.update(React.createElement(TeamCard, { ...props, workspaceId: 'w2' }));
  });
  text = JSON.stringify(view.toJSON());
  assert.match(text, /Code a la main/);
  assert.doesNotMatch(text, /Équipe par défaut\./);
  const links = view.root.findAll((n) => (n.type as unknown) === 'Pressable' && n.props.onPress && !n.props.disabled);
  for (const link of links) await act(async () => link.props.onPress());
  assert.deepEqual(actions, ['close', 'settings']);
});
