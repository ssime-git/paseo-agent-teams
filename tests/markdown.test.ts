import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks } from '../client/blocks';
import { renderEvent } from '../client/events';

test('markdown blocks cover headings, lists, code fences and paragraphs', () => {
  const blocks = parseBlocks('# Titre\n\nTexte **gras**\nsuite\n\n- a\n- b\n\n```ts\nconst x = 1;\n```');
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['heading', 'paragraph', 'list', 'code'],
  );
  assert.deepEqual(blocks[2], { kind: 'list', items: ['a', 'b'], ordered: false });
});

test('agent JSON artifacts render as structured cards and anything else as markdown', () => {
  const plan = { summary: 'S', tasks: ['t'], acceptance: ['a'], tests: [] };
  assert.equal(renderEvent('planner', '```json\n' + JSON.stringify(plan) + '\n```').kind, 'plan');
  assert.equal(renderEvent('reviewer', JSON.stringify({ verdict: 'pass', summary: 'ok', issues: [] })).kind, 'review');
  assert.equal(renderEvent('builder', 'Texte libre').kind, 'markdown');
  assert.equal(renderEvent('planner', JSON.stringify({ nope: true })).kind, 'markdown');
});

test('provider separators and schema variants render readable stage fields without raw JSON', () => {
  const r = renderEvent(
    'planner',
    '\n---\n\n' +
      JSON.stringify({
        summary: 'Une architecture **simple**',
        tasks: [{ title: 'OAuth', description: 'Use **PKCE**' }],
        acceptance: ['Protected route'],
        tests: [{ command: 'npm test' }],
        nextSteps: ['Review changes'],
      }),
  );
  assert.equal(r.kind, 'markdown');
  if (r.kind !== 'markdown') return;
  assert.match(r.text, /## Tâches/);
  assert.match(r.text, /OAuth/);
  assert.match(r.text, /PKCE/);
  assert.match(r.text, /Prochaines étapes/);
  assert.doesNotMatch(r.text, /"summary":/);
});

test('Reviewer plan discussions and proposals render without raw JSON', () => {
  assert.deepEqual(renderEvent('reviewer', '{"kind":"discussion","summary":"Une question ?"}'), {
    kind: 'markdown',
    text: 'Une question ?',
  });
  const result = renderEvent(
    'reviewer',
    JSON.stringify({
      kind: 'proposal',
      summary: 'Décision',
      plan: { summary: 'Nouveau plan', tasks: ['Une tâche'], acceptance: ['Vérifiable'], tests: [] },
    }),
  );
  assert.equal(result.kind, 'markdown');
  if (result.kind !== 'markdown') return;
  assert.match(result.text, /Proposition de plan/);
  assert.match(result.text, /Critères d’acceptation/);
  assert.doesNotMatch(result.text, /"kind"/);
});

test('a completed report surrounded by prose uses the same structured presentation as plain JSON', () => {
  const text =
    'Les corrections sont prêtes.\n\n```json\n{"summary":"Corrigé","changes":["régression"],"remaining":[]}\n```';
  const result = renderEvent('builder', text);
  assert.equal(result.kind, 'build');
});

test('Markdown tables become structured rows instead of visible pipe-delimited text', () => {
  const blocks = parseBlocks('| Étape | Résultat |\n| --- | --- |\n| Build | **Validé** |\n| Review | À corriger |');
  assert.deepEqual(blocks, [
    {
      kind: 'table',
      headers: ['Étape', 'Résultat'],
      rows: [
        ['Build', '**Validé**'],
        ['Review', 'À corriger'],
      ],
    },
  ]);
});

test('native Reviewer context is rendered as a proposal without raw transport metadata', () => {
  const rendered = renderEvent(
    'reviewer',
    JSON.stringify({
      workflowId: 'native-workflow',
      baseVersion: 7,
      kind: 'proposal',
      summary: 'Révision native',
      plan: { summary: 'Plan complet', tasks: ['Lire'], acceptance: ['Vérifié'], tests: [] },
    }),
  );
  assert.equal(rendered.kind, 'markdown');
  if (rendered.kind === 'markdown') {
    assert.match(rendered.text, /Proposition de plan/);
    assert.match(rendered.text, /Révision native/);
    assert.doesNotMatch(rendered.text, /workflowId|baseVersion|native-workflow/);
  }
});
