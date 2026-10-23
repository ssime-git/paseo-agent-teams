import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { workflowFixture } from './fixtures';
import { renderEvent } from '../client/events';

test('clarification UI never selects the recommendation and permits explicit free responses', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await mkdir('node_modules/.cache', { recursive: true });
  const dir = await mkdtemp(join(process.cwd(), 'node_modules/.cache/teams-clarification-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bundle = await build({
    entryPoints: ['client/clarifications.tsx'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    jsx: 'automatic',
    plugins: [
      {
        name: 'native',
        setup(b) {
          b.onResolve({ filter: /^react-native$/ }, () => ({ path: 'native', namespace: 'mock' }));
          b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
            contents: "export const Pressable='Pressable',Text='Text',TextInput='TextInput',View='View';",
          }));
        },
      },
    ],
  });
  const path = join(dir, 'component.mjs');
  await writeFile(path, bundle.outputFiles[0].text);
  const { Clarifications } = await import(path);
  const w = workflowFixture();
  w.status = 'attention';
  w.clarifications = [
    {
      id: 'batch',
      at: 'now',
      answers: [],
      request: {
        kind: 'clarification',
        summary: 'Une décision',
        questions: [
          {
            id: 'scope',
            title: 'Quelle portée ?',
            options: [
              { id: 'a', label: 'Ciblée', tradeoff: 'Moins de travail' },
              { id: 'b', label: 'Large', tradeoff: 'Davantage de couverture' },
            ],
            recommendedOptionId: 'a',
          },
        ],
      },
    },
  ];
  w.agents.planner = 'native-planner';
  let imports = 0;
  let opens = 0;
  const answers: unknown[] = [];
  const props = {
    workflow: w,
    colors: {},
    busy: false,
    onAnswer: (value: unknown) => answers.push(value),
    onImport: () => imports++,
    onOpenPlanner: () => opens++,
  };
  let renderer!: ReturnType<typeof create>;
  await act(() => {
    renderer = create(React.createElement(Clarifications, props));
  });
  t.after(() => act(() => renderer.unmount()));
  assert.equal(answers.length, 0);
  assert.match(JSON.stringify(renderer.toJSON()), /recommandé/);
  assert.equal(imports, 0);
  await act(() => renderer.root.findByProps({ accessibilityLabel: 'Préparer une réponse native' }).props.onPress());
  const template = renderer.root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) => node.props.children)
    .find((value) => typeof value === 'string' && value.startsWith('{'));
  assert.deepEqual(JSON.parse(template), {
    workflowId: w.id,
    clarificationId: 'batch',
    answers: [{ questionId: 'scope', text: '' }],
  });
  assert.equal(answers.length, 0);
  await act(() => renderer.root.findByProps({ accessibilityLabel: 'Ouvrir la session du Plan' }).props.onPress());
  assert.equal(opens, 1);
  const importButton = () => renderer.root.findByProps({ accessibilityLabel: 'Importer les réponses natives du Plan' });
  await act(() => importButton().props.onPress());
  assert.equal(imports, 1);
  await act(() => renderer.update(React.createElement(Clarifications, { ...props, busy: true })));
  assert.equal(importButton().props.disabled, true);
  await act(() => renderer.update(React.createElement(Clarifications, props)));
  const send = () => renderer.root.findByProps({ accessibilityLabel: 'Envoyer la réponse : Quelle portée ?' });
  assert.equal(send().props.disabled, true);
  await act(() =>
    renderer.root
      .findByProps({ accessibilityLabel: 'Réponse libre : Quelle portée ?' })
      .props.onChangeText('Documentation seulement'),
  );
  await act(() => send().props.onPress());
  assert.deepEqual(answers, [
    { clarificationId: 'batch', answers: [{ questionId: 'scope', text: 'Documentation seulement' }] },
  ]);
  const rendered = renderEvent('planner', JSON.stringify(w.clarifications[0].request));
  assert.equal(rendered.kind, 'markdown');
  assert.match(JSON.stringify(rendered), /En attente de réponse/);
  assert.doesNotMatch(JSON.stringify(rendered), /recommendedOptionId/);
  w.clarifications[0].answers.push({ questionId: 'scope', text: 'Documentation seulement', at: 'later' });
  await act(() => renderer.update(React.createElement(Clarifications, { ...props, workflow: structuredClone(w) })));
  assert.equal(renderer.root.findAll((node) => String(node.type) === 'TextInput').length, 0);
  assert.match(JSON.stringify(renderer.toJSON()), /Réponse enregistrée/);
  const remainingTemplate = renderer.root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) => node.props.children)
    .find((value) => typeof value === 'string' && value.startsWith('{'));
  assert.deepEqual(JSON.parse(remainingTemplate).answers, []);
  const withoutPlanner = structuredClone(w);
  delete withoutPlanner.agents.planner;
  await act(() => renderer.update(React.createElement(Clarifications, { ...props, workflow: withoutPlanner })));
  assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'Préparer une réponse native' }).length, 0);
  w.clarifications[0].resolvedAt = 'later';
  await act(() => renderer.update(React.createElement(Clarifications, { ...props, workflow: structuredClone(w) })));
  assert.equal(renderer.toJSON(), null);
});
