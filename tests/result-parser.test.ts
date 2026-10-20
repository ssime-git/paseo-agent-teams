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
