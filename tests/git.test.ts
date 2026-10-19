import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { git, snapshot, changes, repository, repositoryPreflight } from '../server/git';
import { runCommand } from '../server/commands';
test('snapshots distinguish pre-existing staged, unstaged, untracked and subsequent edits without changing the index', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'teams-git-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await git(dir, ['init']);
  await git(dir, ['config', 'user.name', 'Test']);
  await git(dir, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(dir, 'tracked.txt'), 'base');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'baseline']);
  await writeFile(join(dir, 'tracked.txt'), 'staged');
  await git(dir, ['add', '.']);
  await writeFile(join(dir, 'tracked.txt'), 'existing unstaged');
  await writeFile(join(dir, 'untracked.txt'), 'existing untracked');
  await symlink('tracked.txt', join(dir, 'link'));
  const index = await readFile(join(dir, '.git/index'));
  const before = await snapshot(dir);
  assert.match(before.staged, /staged/);
  assert.match(before.unstaged, /existing unstaged/);
  assert.equal(before.files.link.kind, 'symlink');
  await writeFile(join(dir, 'tracked.txt'), 'workflow modification');
  await writeFile(join(dir, 'new.txt'), 'new');
  const delta = changes(before, await snapshot(dir));
  assert.deepEqual(delta.map((c) => c.path).sort(), ['new.txt', 'tracked.txt']);
  assert.equal(
    delta.find((c) => c.path === 'tracked.txt')!.before!.content,
    createHash('sha256').update('existing unstaged').digest('hex'),
  );
  assert.deepEqual(await readFile(join(dir, '.git/index')), index);
  assert.equal((await repository(dir)).root, dir);
});
test('command runner records streams, exit code and timeout', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'teams-command-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await runCommand(dir, { command: 'echo ok; echo error >&2; exit 3', timeoutMs: 1000 });
  assert.equal(result.exitCode, 3);
  assert.match(result.stdout, /ok/);
  assert.match(result.stderr, /error/);
  const timeout = await runCommand(dir, { command: 'sleep 5', timeoutMs: 100 });
  assert.equal(timeout.timedOut, true);
  assert.ok(timeout.durationMs < 3000);
});
test('a non-Git parent explains the launch requirement and suggests its actual child repositories without initializing it', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'teams-parent-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const child = join(dir, 'project');
  await mkdir(child);
  await git(child, ['init']);
  const parentBefore = await readdir(dir);
  const result = await repositoryPreflight(dir);
  assert.equal(result.gitRoot, null);
  assert.match(result.launchIssue!, /NOT_GIT_REPOSITORY/);
  assert.deepEqual(result.repositories, [child]);
  assert.deepEqual(await readdir(dir), parentBefore);
  assert.equal((await repositoryPreflight(child)).gitRoot, child);
  await assert.rejects(repository(dir), /Open the repository workspace/);
});

test('unborn snapshots detect content, executable mode and symlink target changes and enforce the size limit', async (t) => {
  const { chmod } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'teams-snapshot-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await git(dir, ['init']);
  await writeFile(join(dir, 'file'), 'first');
  await symlink('file', join(dir, 'link'));
  const before = await snapshot(dir);
  assert.equal(before.head, 'unborn');
  await chmod(join(dir, 'file'), 0o755);
  assert.deepEqual(
    changes(before, await snapshot(dir)).map((c) => c.path),
    ['file'],
  );
  await rm(join(dir, 'link'));
  await symlink('other', join(dir, 'link'));
  assert.ok(changes(before, await snapshot(dir)).some((c) => c.path === 'link'));
  await writeFile(join(dir, 'large'), Buffer.alloc(21 * 1024 * 1024));
  await assert.rejects(snapshot(dir), /exceeds 20 MiB/);
});

test('runtime context projects changed paths and a bounded diff, including legacy baselines', async (t) => {
  const { PaseoRuntime } = await import('../server/runtime');
  const { workflowFixture } = await import('./fixtures');
  const root = await mkdtemp(join(tmpdir(), 'teams-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, 'repo');
  await mkdir(dir);
  await git(dir, ['init']);
  await writeFile(join(dir, 'file'), 'initial bytes');
  const before = await snapshot(dir);
  before.files.file.content = Buffer.from('initial bytes').toString('base64');
  const baseline = join(root, 'baseline.snapshot');
  await writeFile(baseline, JSON.stringify(before));
  await writeFile(join(dir, 'file'), 'changed bytes');
  const w = { ...workflowFixture(), cwd: dir, baseline };
  const runtime = new PaseoRuntime({} as ConstructorParameters<typeof PaseoRuntime>[0], root);
  const context = await runtime.context(w);
  assert.doesNotMatch(context, /aW5pdGlhbCBieXRlcw==/);
  const projected = JSON.parse(context);
  assert.deepEqual(projected.changedFiles, [{ path: 'file', change: 'modified' }]);
  await git(dir, ['add', 'file']);
  await writeFile(join(dir, 'file'), 'large changed line\n'.repeat(30000));
  const large = await runtime.context(w);
  assert.ok(large.length < 64 * 1024);
  assert.match(large, /truncated/);
});

test('post-completion questions retain usable repository context when the cleaned launch baseline is missing', async (t) => {
  const { PaseoRuntime } = await import('../server/runtime');
  const { workflowFixture } = await import('./fixtures');
  const root = await mkdtemp(join(tmpdir(), 'teams-followup-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ['init']);
  await writeFile(join(root, 'user-file'), 'preserve');
  const w = { ...workflowFixture(), cwd: root, phase: 'followup' as const, baseline: join(root, 'removed.snapshot') };
  const runtime = new PaseoRuntime({} as ConstructorParameters<typeof PaseoRuntime>[0], root);
  const context = JSON.parse(await runtime.context(w));
  assert.match(context.warning, /Ownership of uncommitted changes cannot be proved/);
  assert.match(context.currentStatus, /user-file/);
  await assert.rejects(runtime.context({ ...w, phase: 'planning' }), { code: 'ENOENT' });
});
