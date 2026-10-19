import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import React from 'react';
import { create, act } from 'react-test-renderer';

test('global team entry works without agents and opens repository configuration once, with retry after error', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await mkdir('node_modules/.cache', { recursive: true });
  const dir = await mkdtemp(join(process.cwd(), 'node_modules/.cache/new-team-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const paths: string[] = [],
    opened: string[] = [],
    prepared: string[] = [];
  let fail = true;
  const registry = {
    paseo: {
      projects: {
        list: async () => ({ projects: [{ projectId: 'demo', projectDisplayName: 'Demo', projectRootPath: '/demo' }] }),
      },
      workspaces: {
        open: async (path: string) => {
          paths.push(path);
          if (fail) throw Error('Unavailable');
          return { id: 'workspace' };
        },
      },
      // No agents API: the creation entry must work before any agent exists.
    },
    prepare: (key: string) => prepared.push(key),
  };
  (globalThis as Record<string, unknown>).__newTeamTest = registry;
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__newTeamTest;
  });
  const result = await build({
    entryPoints: ['client/new-workspace.tsx'],
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
          b.onResolve({ filter: /^(react-native|@getpaseo\/plugin\/client(?:\/ui)?|\.\/drafts)$/ }, (args) => ({
            path: args.path,
            namespace: 'host',
          }));
          b.onLoad({ filter: /.*/, namespace: 'host' }, (args) => ({
            contents:
              args.path === 'react-native'
                ? `export const Pressable='Pressable',ScrollView='ScrollView',Text='Text',TextInput='TextInput',View='View';`
                : args.path === './drafts'
                  ? `export const prepareNewTeam=key=>globalThis.__newTeamTest.prepare(key);`
                  : args.path.endsWith('/ui')
                    ? `export const SidebarRow='SidebarRow';`
                    : `export const usePaseo=()=>globalThis.__newTeamTest.paseo;`,
          }));
        },
      },
    ],
  });
  const path = join(dir, 'entry.mjs');
  await writeFile(path, result.outputFiles[0].text);
  const { NewTeamWorkspace, NewTeamSidebar, NEW_TEAM_SCREEN } = await import(path);
  let screen!: ReturnType<typeof create>, sidebar!: ReturnType<typeof create>;
  await act(async () => {
    screen = create(
      React.createElement(NewTeamWorkspace, {
        host: { id: 'host', label: 'Demo host' },
        theme: { colors: {} },
        onOpen: (id: string) => opened.push(id),
      }),
    );
    sidebar = create(
      React.createElement(NewTeamSidebar, {
        currentScreen: null,
        openScreen: (input: unknown) => opened.push(JSON.stringify(input)),
      }),
    );
  });
  t.after(() =>
    act(() => {
      screen.unmount();
      sidebar.unmount();
    }),
  );
  await act(async () => sidebar.root.findByProps({ icon: 'Workflow' }).props.onPress());
  assert.equal(opened.pop(), JSON.stringify({ screenId: NEW_TEAM_SCREEN }));
  await act(async () => screen.root.findByProps({ accessibilityLabel: 'Mode agent : Demo' }).props.onPress());
  assert.match(JSON.stringify(screen.toJSON()), /Unavailable/);
  assert.deepEqual(opened, []);
  fail = false;
  await act(async () => {
    const button = screen.root.findByProps({ accessibilityLabel: 'Mode agent : Demo' });
    button.props.onPress();
    button.props.onPress();
  });
  assert.deepEqual(paths, ['/demo', '/demo']);
  assert.deepEqual(opened, ['workspace']);
  assert.deepEqual(prepared, ['host:workspace']);
});
