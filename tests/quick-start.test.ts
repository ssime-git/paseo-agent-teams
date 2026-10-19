import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import React from 'react';
import { create, act } from 'react-test-renderer';

test('team popover discovers role choices, shares scoped drafts, retries idempotently and blocks non-Git launches', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await mkdir('node_modules/.cache', { recursive: true });
  const dir = await mkdtemp(join(process.cwd(), 'node_modules/.cache/team-popover-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const launches: { requestId: string; config: { roles: { builder: { provider: string } } } }[] = [];
  const registry = {
    catalog: {
      providers: [
        {
          id: 'claude',
          label: 'Claude Code',
          family: 'claude',
          models: [{ id: 'opus', label: 'Opus', isDefault: true }],
          modes: [{ id: 'plan', label: 'Plan' }],
        },
        {
          id: 'codex',
          label: 'Codex',
          family: 'codex',
          models: [
            { id: 'sol', label: 'Sol', isDefault: true },
            { id: 'astra', label: 'Astra', isDefault: false },
          ],
          modes: [
            { id: 'auto', label: 'Auto' },
            { id: 'read-only', label: 'Read only' },
          ],
        },
      ],
      launchIssue: '',
    },
    rpc: (name: string) => async (input: (typeof launches)[number]) => {
      if (name === 'teams.catalog') return registry.catalog;
      launches.push(input);
      if (launches.length === 1) throw Error('Lost response');
      return { id: 'workflow' };
    },
  };
  (globalThis as Record<string, unknown>).__quickStartTest = registry;
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__quickStartTest;
  });
  const result = await build({
    entryPoints: ['client/quick-start.tsx'],
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
          b.onResolve({ filter: /^(react-native|@getpaseo\/plugin\/client|\.\/controls)$/ }, (args) => ({
            path: args.path,
            namespace: 'host',
          }));
          b.onLoad({ filter: /.*/, namespace: 'host' }, (args) => ({
            contents:
              args.path === 'react-native'
                ? `export const Pressable='Pressable',ScrollView='ScrollView',Text='Text',TextInput='TextInput',View='View';`
                : args.path === './controls'
                  ? `export const CompactSelect='Select',CompactSwitch='Switch';`
                  : `export function useRpc(contract){return globalThis.__quickStartTest.rpc(contract.name);}`,
          }));
        },
      },
    ],
  });
  const path = join(dir, 'popover.mjs');
  await writeFile(path, result.outputFiles[0].text);
  const { QuickStart } = await import(path);
  let opened = 0,
    closed = 0;
  const props = {
    workspaceId: 'workspace',
    host: { id: 'host' },
    theme: { colors: {} },
    layout: { compact: true },
    close: () => {
      closed++;
    },
    openPanel: () => {
      opened++;
    },
  };
  let first!: ReturnType<typeof create>, second!: ReturnType<typeof create>, other!: ReturnType<typeof create>;
  await act(async () => {
    first = create(React.createElement(QuickStart, props));
  });
  t.after(() =>
    act(() => {
      first.unmount();
      second?.unmount();
      other?.unmount();
    }),
  );
  const models = first.root.findByProps({ label: 'builder · modèle' });
  assert.deepEqual(
    models.props.options.map((o: { value: string }) => o.value),
    ['sol', 'astra'],
  );
  await act(async () => {
    models.props.onValueChange('astra');
    first.root.findByProps({ accessibilityLabel: 'Tâche pour l’équipe' }).props.onChangeText('Shared task');
  });
  await act(async () => {
    second = create(React.createElement(QuickStart, props));
    other = create(React.createElement(QuickStart, { ...props, workspaceId: 'other' }));
  });
  assert.equal(second.root.findByProps({ accessibilityLabel: 'Tâche pour l’équipe' }).props.value, 'Shared task');
  assert.equal(other.root.findByProps({ accessibilityLabel: 'Tâche pour l’équipe' }).props.value, '');
  await act(async () => {
    first.root.findByProps({ accessibilityLabel: 'Lancer l’équipe' }).props.onPress();
  });
  assert.equal(opened, 0);
  assert.match(JSON.stringify(first.toJSON()), /Lost response/);
  await act(async () => {
    first.root.findByProps({ accessibilityLabel: 'Lancer l’équipe' }).props.onPress();
  });
  assert.equal(launches[0].requestId, launches[1].requestId);
  assert.equal(launches[1].config.roles.builder.provider, 'codex/astra');
  assert.equal(opened, 1);
  assert.equal(closed, 1);
  registry.catalog.launchIssue = 'NOT_GIT_REPOSITORY: parent';
  await act(async () => {
    other.update(React.createElement(QuickStart, { ...props, workspaceId: 'parent' }));
  });
  await act(async () => {
    other.root.findByProps({ accessibilityLabel: 'Tâche pour l’équipe' }).props.onChangeText('Blocked task');
  });
  assert.equal(other.root.findByProps({ accessibilityLabel: 'Lancer l’équipe' }).props.disabled, true);
  assert.equal(launches.length, 2);
});
