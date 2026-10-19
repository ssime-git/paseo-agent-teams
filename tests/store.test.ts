import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, migrateWorkflow } from '../server/store';

test('corrupt state is quarantined, orphan temporary files are removed, creation fails closed', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'teams-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'broken.json'), '{');
  await writeFile(join(dir, 'orphan.tmp'), 'partial');
  const store = new Store(dir);
  assert.deepEqual(await store.all(), []);
  const files = await readdir(dir);
  assert.ok(files.some((file) => file.endsWith('.corrupt')));
  assert.ok(!files.includes('orphan.tmp'));
  await assert.rejects(store.assertCanCreate(), /repository lock/);
  await assert.rejects(new Store(dir).assertCanCreate(), /repository lock/);
});

test('store validates IDs and migration rejects unsupported or malformed state', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'teams-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(new Store(dir).get('../outside'), /Invalid workflow ID/);
  assert.throws(() => migrateWorkflow({ version: 2 }));
});

test('healthy workflows remain available beside corruption and returned state is isolated', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'teams-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { workflowFixture } = await import('./fixtures');
  const initial = workflowFixture();
  await new Store(dir).put(initial);
  await writeFile(join(dir, 'broken.json'), '{');
  const store = new Store(dir);
  assert.equal((await store.all()).length, 1);
  const w = await store.get(initial.id);
  w.task = 'Mutated';
  assert.equal((await store.get(initial.id)).task, 'Fixture');
  w.status = 'paused';
  await store.put(w);
  assert.equal((await new Store(dir).get(initial.id)).status, 'paused');
  await assert.rejects(store.authorize(initial.id, 'foreign'), /access denied/);
  await assert.rejects(store.authorize(initial.id, undefined), /access denied/);
  assert.equal((await store.authorize(initial.id, 'owner')).id, initial.id);
});

test('partially readable corrupt state reserves its repository across restarts without locking other repositories', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'teams-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'partial.json'), JSON.stringify({ repo: '/locked/.git', version: 1 }));
  for (const store of [new Store(dir), new Store(dir)]) {
    assert.deepEqual(await store.all(), []);
    await store.assertCanCreate('/other/.git');
    await assert.rejects(store.assertCanCreate('/locked/.git'), /repository lock/);
  }
});
