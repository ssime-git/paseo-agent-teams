import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResult } from '../server/result-parser';
const build = {
  summary: 'Fixed both regressions',
  changes: ['behavior fixes'],
  remaining: ['Real Docker verification pending'],
};
test('real-world prose with a fenced report and harmless key whitespace preserves unresolved work', () => {
  assert.deepEqual(
    parseResult('builder', 'Les deux faux positifs sont corrigés.\n\n```json\n' + JSON.stringify(build) + '\n```'),
    build,
  );
  assert.deepEqual(
    parseResult(
      'builder',
      JSON.stringify({ summary: build.summary, changes: build.changes, ' remaining': build.remaining }),
    ),
    build,
  );
});
test('ambiguous keys, conflicting reports and incomplete results are not silently accepted', () => {
  assert.throws(() => parseResult('builder', JSON.stringify({ ...build, ' remaining': [] })));
  assert.throws(() =>
    parseResult(
      'builder',
      '```json\n' + JSON.stringify(build) + '\n```\n```json\n' + JSON.stringify({ ...build, remaining: [] }) + '\n```',
    ),
  );
  assert.throws(() => parseResult('builder', '{"summary":"Done"}'));
});
test('Planner clarification requires concrete unique choices and a valid recommendation', () => {
  const q = {
    id: 'scope',
    title: 'Quelle portée ?',
    options: [
      { id: 'a', label: 'Ciblée', tradeoff: 'Moins de changements' },
      { id: 'b', label: 'Complète', tradeoff: 'Plus de travail' },
    ],
    recommendedOptionId: 'a',
  };
  const value = { kind: 'clarification', summary: 'Décision nécessaire', questions: [q] };
  assert.deepEqual(parseResult('planner', JSON.stringify(value)), value);
  for (const questions of [
    [q, q],
    [{ ...q, recommendedOptionId: 'unknown' }],
    [{ ...q, options: [q.options[0], q.options[0]] }],
    [{ ...q, options: [q.options[0]] }],
  ])
    assert.throws(() => parseResult('planner', JSON.stringify({ ...value, questions })));
});
