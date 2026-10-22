import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DefinitionCatalog } from '../server/definition-catalog';
import { codeReviewPreset } from '../shared/workflow-definition';
import { Store } from '../server/store';
import { workflowFixture } from './fixtures';

const definition = () =>
  codeReviewPreset({
    code: { provider: 'codex/detected-model', modeId: 'workspace-write' },
    review: { provider: 'codex/detected-model', modeId: 'read-only' },
  });
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), 'teams-definition-catalog-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('catalog preserves revisions, portable imports and V1 executions across restart', async (t) => {
  const directory = await setup(t);
  const state = new Store(directory);
  const workflow = workflowFixture();
  await state.put(workflow);
  const original = await readFile(join(directory, `${workflow.id}.json`), 'utf8');
  const catalog = new DefinitionCatalog(join(directory, 'definitions'));
  const first = await catalog.save({ workspaceId: 'owner', expectedRevision: 0, definition: definition() });
  first.definition.name = 'Caller mutation';
  const history = await catalog.history(first.id, 'owner');
  assert.equal(history[0].definition.name, 'Code ↔ Review');
  const edited = { ...history[0].definition, name: 'My review loop', maxTransitions: 4 };
  const second = await catalog.save({ workspaceId: 'owner', id: first.id, expectedRevision: 1, definition: edited });
  const restarted = new DefinitionCatalog(catalog.directory);
  assert.deepEqual(await restarted.history(first.id, 'owner'), [history[0], second]);
  const imported = await restarted.save({
    workspaceId: 'other',
    expectedRevision: 0,
    definition: JSON.parse(JSON.stringify(second.definition)),
  });
  assert.notEqual(imported.id, first.id);
  assert.deepEqual(imported.definition, edited);
  assert.equal(imported.revision, 1);
  assert.deepEqual(await restarted.list('owner'), [second]);
  assert.deepEqual(await restarted.list('other'), [imported]);
  assert.deepEqual(await restarted.list('missing'), []);
  await assert.rejects(restarted.history(first.id, 'other'), /access denied/);
  await assert.rejects(
    restarted.save({ workspaceId: 'other', id: first.id, expectedRevision: 2, definition: edited }),
    /access denied/,
  );
  assert.equal((await stat(join(catalog.directory, first.id, '1.json'))).mode & 0o777, 0o600);
  assert.equal(await readFile(join(directory, `${workflow.id}.json`), 'utf8'), original);
  assert.equal((await new Store(directory).all()).length, 1);
});

test('independent catalog writers arbitrate a stale revision without losing history', async (t) => {
  const directory = await setup(t);
  const a = new DefinitionCatalog(directory),
    b = new DefinitionCatalog(directory);
  const first = await a.save({ workspaceId: 'owner', expectedRevision: 0, definition: definition() });
  const input = { workspaceId: 'owner', id: first.id, expectedRevision: 1, definition: definition() };
  const outcomes = await Promise.allSettled([
    a.save(input),
    b.save({ ...input, definition: { ...definition(), name: 'Competitor' } }),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  const rejection = outcomes.find((outcome) => outcome.status === 'rejected');
  assert.equal(rejection?.status === 'rejected' && rejection.reason.code, 'DEFINITION_CONFLICT');
  assert.equal((await b.history(first.id, 'owner')).length, 2);
  await assert.rejects(a.save(input), /changed/);
  await assert.rejects(a.save({ ...input, id: undefined }), /revision zero/);
});

test('invalid imports and corrupt histories fail closed without deleting evidence or pending writes', async (t) => {
  const directory = await setup(t);
  const catalog = new DefinitionCatalog(directory);
  const first = await catalog.save({ workspaceId: 'owner', expectedRevision: 0, definition: definition() });
  const input = { workspaceId: 'owner', id: first.id, expectedRevision: 1, definition: definition() };
  await assert.rejects(catalog.save({ ...input, definition: { ...definition(), version: 2 } }));
  await assert.rejects(catalog.history('../escape', 'owner'));
  const temporary = join(directory, first.id, 'pending.tmp');
  await writeFile(temporary, 'incomplete');
  assert.equal((await catalog.list('owner')).length, 1);
  assert.equal(await readFile(temporary, 'utf8'), 'incomplete');
  const revisionFile = join(directory, first.id, '1.json');
  const raw = JSON.parse(await readFile(revisionFile, 'utf8'));
  for (const invalid of ['{', JSON.stringify({ ...raw, revision: 2 }), JSON.stringify({ ...raw, version: 2 })]) {
    await writeFile(revisionFile, invalid);
    await assert.rejects(catalog.history(first.id, 'owner'), /corrupt/);
    await assert.rejects(catalog.save(input), /corrupt/);
    assert.equal(await readFile(revisionFile, 'utf8'), invalid);
  }
});
