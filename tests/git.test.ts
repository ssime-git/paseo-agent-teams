import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { git, snapshot, changes, repository } from '../server/git';
import { runCommand } from '../server/commands';
test('snapshots distinguish pre-existing staged, unstaged, untracked and subsequent edits without changing the index', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'teams-git-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await git(dir, ['init']); await git(dir, ['config', 'user.name', 'Test']); await git(dir, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(dir, 'tracked.txt'), 'base'); await git(dir, ['add', '.']); await git(dir, ['commit', '-m', 'baseline']);
  await writeFile(join(dir, 'tracked.txt'), 'staged'); await git(dir, ['add', '.']); await writeFile(join(dir, 'tracked.txt'), 'existing unstaged');
  await writeFile(join(dir, 'untracked.txt'), 'existing untracked'); await symlink('tracked.txt', join(dir, 'link'));
  const index = await readFile(join(dir, '.git/index')); const before = await snapshot(dir);
  assert.match(before.staged, /staged/); assert.match(before.unstaged, /existing unstaged/); assert.equal(before.files.link.kind, 'symlink');
  await writeFile(join(dir, 'tracked.txt'), 'workflow modification'); await writeFile(join(dir, 'new.txt'), 'new');
  const delta = changes(before, await snapshot(dir)); assert.deepEqual(delta.map(c => c.path).sort(), ['new.txt', 'tracked.txt']);
  assert.equal(Buffer.from(delta.find(c => c.path === 'tracked.txt')!.before!.content, 'base64').toString(), 'existing unstaged');
  assert.deepEqual(await readFile(join(dir, '.git/index')), index); assert.equal((await repository(dir)).root, dir);
});
test('command runner records streams, exit code and timeout', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'teams-command-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await runCommand(dir, { command: 'echo ok; echo error >&2; exit 3', timeoutMs: 1000 });
  assert.equal(result.exitCode, 3); assert.match(result.stdout, /ok/); assert.match(result.stderr, /error/);
  const timeout = await runCommand(dir, { command: 'sleep 5', timeoutMs: 100 }); assert.equal(timeout.timedOut, true); assert.ok(timeout.durationMs < 3000);
});
