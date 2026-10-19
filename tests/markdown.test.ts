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
