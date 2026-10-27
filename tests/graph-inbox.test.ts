import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import React from 'react';
import { create, act } from 'react-test-renderer';

test('thread modal selects by name, keeps silence pending and sends explicit partial answers with exact scope', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await mkdir('node_modules/.cache', { recursive: true });
  const dir = await mkdtemp(join(process.cwd(), 'node_modules/.cache/graph-inbox-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await build({
    entryPoints: ['client/graph-inbox.tsx'],
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
          b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', external: true }));
          b.onResolve({ filter: /^(react-native|@getpaseo\/plugin\/client(\/ui)?|\.\/markdown)$/ }, (args) => ({
            path: args.path,
            namespace: 'host',
          }));
          b.onLoad({ filter: /.*/, namespace: 'host' }, (args) => ({
            contents:
              args.path === 'react-native'
                ? `export const Pressable='Pressable',Text='Text',View='View';`
                : args.path === './markdown'
                  ? `export const Markdown='Markdown';`
                  : args.path.endsWith('/ui')
                    ? `import React from 'react'; export const TextInput='TextInput';
            export function Modal(p){return p.open?React.createElement('Modal',p,p.children):null;} Modal.Content='Content';`
                    : `export function useRpc(c){return globalThis.__graphInboxTest.rpc(c.name);} export function useSettings(){return {status:'ready',values:{language:'fr'}};}`,
          }));
        },
      },
    ],
  });
  const file = join(dir, 'bundle.mjs');
  await writeFile(file, result.outputFiles[0].text);
  const { GraphInbox } = await import(file);
  const requests: { name: string; input: Record<string, unknown> }[] = [];
  const options = [
    { id: 'one', label: 'Option one', tradeoff: 'Simple' },
    { id: 'two', label: 'Option two', tradeoff: 'Flexible' },
  ];
  let state = {
    id: 'graph',
    revision: 7,
    task: 'Choose a design',
    status: 'running',
    nextStepId: 'plan',
    source: { definition: { name: 'My workflow', steps: [{ id: 'plan', instruction: 'Plan' }] } },
    activations: [
      {
        operationId: 'operation',
        stepId: 'plan',
        clarificationAnswers: [] as unknown[],
        assessment: {
          status: 'clarification',
          request: {
            questions: [
              { id: 'first', title: 'First question', options, recommendedOptionId: 'one' },
              { id: 'second', title: 'Second question', options, recommendedOptionId: 'two' },
            ],
          },
        },
      },
    ],
  };
  let reject = true;
  (globalThis as Record<string, unknown>).__graphInboxTest = {
    rpc: (name: string) => async (input: Record<string, unknown>) => {
      requests.push({ name, input });
      if (name === 'teams.graph_list') return [structuredClone(state)];
      if (reject) throw new Error('Stale revision');
      state = structuredClone(state);
      state.revision++;
      state.activations[0].clarificationAnswers.push((input.submission as { answer: unknown }).answer);
      return structuredClone(state);
    },
  };
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__graphInboxTest;
  });
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      React.createElement(GraphInbox, {
        agentId: 'owner',
        item: { data: { workspaceId: 'workspace', text: 'Saved report' } },
        theme: { colors: {} },
      }),
    );
  });
  t.after(() => act(() => tree.unmount()));
  const text = () => JSON.stringify(tree.toJSON());
  const button = (label: string) =>
    tree.root
      .findAllByType('Pressable' as never)
      .find((node) => node.findAllByType('Text' as never).some((n) => n.props.children === label))!;
  await act(async () => button('Ouvrir les actions du workflow').props.onPress());
  await act(async () => button('My workflow · Révision 7').props.onPress());
  assert.match(text(), /First question/);
  assert.match(text(), /Recommandé/);
  assert.equal(button('Envoyer la réponse').props.disabled, true);
  await act(async () => tree.root.findByType('Modal' as never).props.onOpenChange(false));
  assert.equal(requests.length, 1); // Closing never answers or continues.
  await act(async () => button('Ouvrir les actions du workflow').props.onPress());
  await act(async () => tree.root.findByType('TextInput' as never).props.onChangeText('My free answer'));
  await act(async () => button('Envoyer la réponse').props.onPress());
  assert.match(text(), /Stale revision/);
  assert.equal(tree.root.findByType('TextInput' as never).props.value, 'My free answer');
  reject = false;
  await act(async () => button('Envoyer la réponse').props.onPress());
  assert.deepEqual(requests.at(-1), {
    name: 'teams.graph_response',
    input: {
      workspaceId: 'workspace',
      ownerAgentId: 'owner',
      id: 'graph',
      expectedRevision: 7,
      operationId: 'operation',
      submission: { action: 'answer', answer: { questionId: 'first', text: 'My free answer' } },
    },
  });
  assert.match(text(), /Second question/);
  assert.equal(tree.root.findByType('TextInput' as never).props.value, '');
  assert.equal(button('Continuer cette étape').props.disabled, true);
  assert.ok(requests.every((r) => r.name !== 'teams.graph_advance'));
});
