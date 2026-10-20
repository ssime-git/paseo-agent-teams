import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relevantSkills } from '../server/skills';
test('native skill metadata prioritizes explicitly named relevant skills without transferring unrelated catalogs', () => {
  const commands = [
    { name: 'team-live-verification', kind: 'skill', description: 'NormalizeLabel behavior tests' },
    { name: 'exam', kind: 'skill', description: 'BentoML examination correction' },
    { name: 'reset', kind: 'command', description: 'NormalizeLabel' },
  ];
  assert.deepEqual(
    relevantSkills('Apply team-live-verification for normalizeLabel', commands).map((s) => s.name),
    ['team-live-verification'],
  );
  assert.deepEqual(
    relevantSkills('Corriger BentoML', commands).map((s) => s.name),
    ['exam'],
  );
  assert.deepEqual(relevantSkills('Unrelated content', commands), []);
  assert.ok(
    JSON.stringify(
      relevantSkills(
        'behavior',
        Array.from({ length: 1000 }, (_, i) => ({
          name: String(i),
          kind: 'skill',
          description: 'behavior '.repeat(1000),
        })),
      ),
    ).length < 4000,
  );
});
