import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { URL } from 'node:url';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'teams hook '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const hooks = join(root, '.githooks');
  await mkdir(bin);
  await mkdir(hooks);
  const log = join(root, '.git', 'paseo-test.log');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOOK_TEST_LOG: log, HOOK_TEST_FAIL: '0' };
  await writeFile(
    join(bin, 'paseo'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$HOOK_TEST_LOG"\n[ "$HOOK_TEST_FAIL" != 1 ]\n',
    { mode: 0o755 },
  );
  await writeFile(join(hooks, 'post-merge'), await readFile(new URL('../.githooks/post-merge', import.meta.url)), {
    mode: 0o755,
  });
  const git = async (...args: string[]) =>
    (await promisify(execFile)('git', args, { cwd: root, env, encoding: 'utf8' })).stdout;
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.name', 'Hook test');
  await git('config', 'user.email', 'test@example.invalid');
  await git('config', 'core.hooksPath', '.githooks');
  await git('add', '.githooks');
  await git('commit', '-qm', 'Initial');
  await git('switch', '-qc', 'topic');
  await writeFile(join(root, 'change'), 'merged work\n');
  await git('add', 'change');
  await git('commit', '-qm', 'Change');
  const topic = (await git('rev-parse', 'HEAD')).trim();
  await git('switch', '-q', 'main');
  const calls = async () => (await readFile(log, 'utf8').catch(() => '')).trim();
  return { root, git, calls, topic, env };
}

test('fast-forward and merge commits on main install the repository and reload Paseo', async (t) => {
  for (const mode of ['--ff-only', '--no-ff']) {
    const h = await setup(t);
    await h.git('merge', mode, '--no-edit', 'topic');
    assert.equal(await h.calls(), `plugin install ${h.root}\nplugin reload paseo-agent-teams`);
  }
});

test('merges on other branches and uncommitted squash merges do not install', async (t) => {
  const h = await setup(t);
  await h.git('switch', '-qc', 'other');
  await h.git('merge', '--ff-only', 'topic');
  assert.equal(await h.calls(), '');
  await h.git('switch', '-q', 'main');
  await h.git('merge', '--squash', 'topic');
  assert.equal(await h.calls(), '');
});

test('a failed installation preserves the merge and does not attempt reload', async (t) => {
  const h = await setup(t);
  h.env.HOOK_TEST_FAIL = '1';
  await h.git('merge', '--ff-only', 'topic');
  assert.equal((await h.git('rev-parse', 'HEAD')).trim(), h.topic);
  assert.equal(await h.calls(), `plugin install ${h.root}`);
});
