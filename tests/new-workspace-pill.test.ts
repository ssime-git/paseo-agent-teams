import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import React from 'react';
import { create, act } from 'react-test-renderer';

test('creation pill feature detection, remote workspace retry and draft task transfer before creating agents', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await mkdir('node_modules/.cache', { recursive: true });
  const dir = await mkdtemp(join(process.cwd(), 'node_modules/.cache/creation-pill-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const paths: string[] = [],
    drafts: unknown[] = [],
    panels: unknown[] = [];
  let fail = true;
  const registry = {
    paseo: {
      workspaces: {
        open: async (path: string) => {
          paths.push(path);
          if (fail) throw Error('Host disconnected');
          return { id: 'workspace-on-vm' };
        },
      },
    },
    prepare: (...args: unknown[]) => drafts.push(args),
  };
  (globalThis as Record<string, unknown>).__creationPill = registry;
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__creationPill;
  });
  const result = await build({
    entryPoints: ['client/new-workspace-pill.tsx'],
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
          b.onResolve({ filter: /^(react-native|@getpaseo\/plugin\/client|\.\/drafts|\.\/quick-start)$/ }, (args) => ({
            path: args.path,
            namespace: 'host',
          }));
          b.onLoad({ filter: /.*/, namespace: 'host' }, (args) => ({
            contents:
              args.path === 'react-native'
                ? `export const Pressable='Pressable',Text='Text',View='View';`
                : args.path === './drafts'
                  ? `export const prepareNewTeam=(...args)=>globalThis.__creationPill.prepare(...args);`
                  : args.path === './quick-start'
                    ? `export const QuickStart='QuickStart';`
                    : `export const usePaseo=()=>globalThis.__creationPill.paseo;`,
          }));
        },
      },
    ],
  });
  const path = join(dir, 'entry.mjs');
  await writeFile(path, result.outputFiles[0].text);
  const { addCreationAccess, CreationTeam } = await import(path);
  assert.doesNotThrow(() => addCreationAccess({})());
  let registration!: { button: { label: string } },
    removed = 0;
  const cleanup = addCreationAccess({
    addNewWorkspaceComposerPill: (input: typeof registration) => {
      registration = input;
      return { remove: () => removed++ };
    },
  });
  assert.equal(registration.button.label, 'Team Auto');
  cleanup();
  assert.equal(removed, 1);
  const props = {
    context: 'new-workspace',
    host: { id: 'remote-vm' },
    theme: { colors: {} },
    layout: { compact: false },
    cwd: null,
    task: 'Task typed in the native composer',
    close() {},
    onOpen: (id: string) => panels.push(id),
  };
  let screen!: ReturnType<typeof create>;
  await act(async () => {
    screen = create(React.createElement(CreationTeam, props));
  });
  t.after(() => act(() => screen.unmount()));
  assert.deepEqual(paths, []);
  await act(async () => screen.update(React.createElement(CreationTeam, { ...props, cwd: '/vm/project' })));
  assert.match(JSON.stringify(screen.toJSON()), /Host disconnected/);
  assert.deepEqual(drafts, []);
  fail = false;
  await act(async () => screen.root.findByProps({ accessibilityLabel: 'Réessayer le mode agent' }).props.onPress());
  assert.deepEqual(paths, ['/vm/project', '/vm/project']);
  assert.deepEqual(drafts, [['remote-vm:workspace-on-vm', props.task]]);
  const quick = screen.root.findByProps({ workspaceId: 'workspace-on-vm' });
  await act(async () => quick.props.openPanel());
  assert.deepEqual(panels, ['workspace-on-vm']);
});
