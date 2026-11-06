import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { engineTestFailure } from './engine-test-failure.mjs';

test('model self-checks cannot consume the engine failure; retries of one operation cannot pass', async (t) => {
  const root = await mkdtemp('/tmp/teams-engine-fixture-');
  const marker = root + '-engine-failure.json';
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(marker, { force: true });
  });
  const record = {
    id: 'workflow',
    revision: 1,
    cwd: root,
    status: 'running',
    operation: { id: 'builder', role: 'builder', phase: 'building', state: 'sent' },
  };
  await assert.rejects(engineTestFailure({ ...record, revision: undefined }, root, marker));
  await assert.rejects(engineTestFailure({ ...record, operation: undefined }, root, marker));
  assert.equal((await engineTestFailure(record, root, marker)).code, 0);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  record.operation = { id: 'test-1', role: 'builder', phase: 'testing', state: 'prepared' };
  assert.deepEqual(
    (await Promise.all([engineTestFailure(record, root, marker), engineTestFailure(record, root, marker)])).map(
      (r) => r.code,
    ),
    [17, 17],
  );
  const first = await readFile(marker, 'utf8');
  assert.equal((await engineTestFailure(record, root, marker)).code, 17);
  record.operation.id = 'test-2';
  assert.equal((await engineTestFailure(record, root, marker)).code, 0);
  assert.equal(await readFile(marker, 'utf8'), first);
  await assert.rejects(engineTestFailure({ ...record, id: 'other' }, root, marker));
  await assert.rejects(engineTestFailure(record, root + '-other', marker));
  await writeFile(marker, 'corrupt');
  await assert.rejects(engineTestFailure(record, root, marker));
});
