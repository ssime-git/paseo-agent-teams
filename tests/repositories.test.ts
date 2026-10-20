import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PaseoApi } from '@getpaseo/client';
import { git, repositoryPreflight } from '../server/git';
import { PaseoRuntime } from '../server/runtime';
import { resolveRepositories, scopesOverlap } from '../server/scopes';
import { workflowFixture } from './fixtures';
import { Store } from '../server/store';

test('a non-Git coordination directory discovers nested repositories without following links or dependencies', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'teams-discovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['first', 'services/nested', 'node_modules/ignored', '.hidden/ignored']) {
    await mkdir(join(root, path), { recursive: true });
    await git(join(root, path), ['init', '-q']);
  }
  const found = await repositoryPreflight(root);
  assert.equal(found.gitRoot, null);
  assert.equal(found.launchIssue, undefined);
  assert.deepEqual(found.repositories.sort(), [join(root, 'first'), join(root, 'services/nested')].sort());
  await assert.rejects(access(join(root, '.git')), { code: 'ENOENT' });
});

test('multi-repository launch snapshots, context and fingerprints preserve each index and detect changes outside the first repository', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'teams-multirepo-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parent = join(root, 'workspace'),
    data = join(root, 'state');
  await mkdir(parent);
  await mkdir(data);
  const a = join(parent, 'a'),
    b = join(parent, 'services', 'b'),
    external = join(root, 'external');
  for (const dir of [a, b, external]) {
    await mkdir(dir, { recursive: true });
    await git(dir, ['init', '-q']);
    await writeFile(join(dir, 'file.txt'), 'initial');
    await git(dir, ['add', 'file.txt']);
    await writeFile(join(dir, 'file.txt'), 'existing unstaged');
    await writeFile(join(dir, 'user-notes.txt'), 'preserve');
  }
  const indices = await Promise.all([a, b, external].map((dir) => readFile(join(dir, '.git/index'))));
  const w = workflowFixture();
  const config = { ...w.config, repositoryPaths: ['a', 'services/b', external] };
  const api = {
    config: { get: async () => ({ config: { providers: {} } }) },
    providers: {
      waitForReady: async () => ({ entries: [{ provider: 'harness', status: 'ready', models: [{ id: 'model' }] }] }),
      listModes: async () => ({ modes: [{ id: 'read-only' }] }),
    },
    workspaces: { ref: () => ({ refresh: async () => ({ workspaceDirectory: parent }) }) },
  } as unknown as PaseoApi;
  const runtime = new PaseoRuntime(api, data),
    prepared = await runtime.prepare('workspace', config);
  const saved = JSON.parse(await readFile(prepared.baseline, 'utf8'));
  assert.equal(saved.version, 2);
  assert.equal(saved.repositories.length, 3);
  Object.assign(w, prepared, { config });
  assert.equal(w.cwd, parent);
  assert.equal(w.repositoryTargets?.length, 3);
  const before = await runtime.fingerprint(w);
  await writeFile(join(b, 'file.txt'), 'workflow changed B');
  await writeFile(join(b, 'created.txt'), 'new');
  assert.notEqual(await runtime.fingerprint(w), before);
  const context = JSON.parse(await runtime.context(w));
  assert.equal(context.workspaceRoot, parent);
  assert.equal(context.repositories.length, 3);
  const changed = context.repositories.find((r: { root: string }) => r.root === b);
  assert.ok(changed.changedFiles.some((f: { path: string }) => f.path === 'created.txt'));
  assert.match(changed.initialStatus, /file.txt/);
  assert.ok(saved.repositories.find((r: { root: string }) => r.root === external).snapshot.files['user-notes.txt']);
  for (let i = 0; i < indices.length; i++)
    assert.deepEqual(await readFile(join([a, b, external][i], '.git/index')), indices[i]);
  await assert.rejects(access(join(parent, '.git')), { code: 'ENOENT' });
  const savedFiles = await readdir(data);
  await assert.rejects(
    runtime.prepare('workspace', config, async (scope) => {
      assert.equal(scope.repositoryTargets?.length, 3);
      throw Error('repository locked');
    }),
    /repository locked/,
  );
  assert.deepEqual(await readdir(data), savedFiles);
  const automatic = await resolveRepositories(parent);
  assert.deepEqual(automatic.map((r) => r.root).sort(), [a, b].sort());
  await assert.rejects(resolveRepositories(parent, []), /Choose at least one/);
  await assert.rejects(resolveRepositories(parent, ['missing']), /not an accessible Git repository/);
});

test('overlap includes secondary repositories and common worktree locks', () => {
  const a = {
    repo: '/a/.git',
    repositoryTargets: [
      { root: '/a', lock: '/a/.git' },
      { root: '/b', lock: '/b/.git' },
    ],
  };
  assert.equal(scopesOverlap(a, { repo: '/b/.git' }), true);
  assert.equal(scopesOverlap(a, { repo: '/other/.git' }), false);
  assert.equal(
    scopesOverlap(a, { repo: '/c/.git', repositoryTargets: [{ root: '/b-worktree', lock: '/b/.git' }] }),
    true,
  );
});

test('quarantined multi-repository records reserve all their locks across restart', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'teams-multi-corrupt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, 'broken.json'),
    JSON.stringify({
      repo: '/a/.git',
      repositoryTargets: [
        { root: '/a', lock: '/a/.git' },
        { root: '/b', lock: '/b/.git' },
      ],
    }),
  );
  for (let pass = 0; pass < 2; pass++) {
    const store = new Store(root);
    await store.all();
    await assert.rejects(store.assertCanCreate('/b/.git'), /Corrupt workflow state/);
    await store.assertCanCreate('/unrelated/.git');
  }
});

test('linked worktrees are discovered as repositories and share the same workflow lock', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'teams-worktrees-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const main = join(root, 'main'),
    linked = join(root, 'linked');
  await mkdir(main);
  await git(main, ['init', '-q']);
  await git(main, ['config', 'user.name', 'Test']);
  await git(main, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(main, 'file'), 'base');
  await git(main, ['add', 'file']);
  await git(main, ['commit', '-qm', 'base']);
  await git(main, ['worktree', 'add', '-qb', 'linked-test', linked]);
  const targets = await resolveRepositories(root);
  assert.equal(targets.length, 2);
  assert.equal(targets[0].lock, targets[1].lock);
  assert.equal(
    scopesOverlap(
      { repo: targets[0].lock, repositoryTargets: [targets[0]] },
      { repo: targets[1].lock, repositoryTargets: [targets[1]] },
    ),
    true,
  );
});
