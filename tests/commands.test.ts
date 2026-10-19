import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCommand, testEnvironment } from '../server/commands';

test('test commands cannot inherit daemon secrets or arbitrary environment variables', async () => {
  const old = process.env.PASEO_AGENT_TEAMS_DAEMON_PASSWORD;
  process.env.PASEO_AGENT_TEAMS_DAEMON_PASSWORD = 'must-not-escape';
  try {
    assert.ok(
      Object.keys(testEnvironment(['PASEO_AGENT_TEAMS_DAEMON_PASSWORD'])).every(
        (key) => !key.startsWith('PASEO_AGENT_TEAMS_'),
      ),
    );
    const result = await runCommand('/tmp', { command: 'env', timeoutMs: 1000 });
    assert.equal(result.exitCode, 0);
    assert.doesNotMatch(result.stdout, /PASEO_AGENT_TEAMS_|must-not-escape/);
  } finally {
    if (old === undefined) delete process.env.PASEO_AGENT_TEAMS_DAEMON_PASSWORD;
    else process.env.PASEO_AGENT_TEAMS_DAEMON_PASSWORD = old;
  }
});

test('command output is bounded and abort terminates the process group', async () => {
  const result = await runCommand('/tmp', { command: 'yes x | head -c 200000', timeoutMs: 1000 });
  assert.equal(result.stdout.length, 128 * 1024);
  assert.equal(result.truncated, true);
  const controller = new AbortController();
  const pending = runCommand('/tmp', { command: 'sleep 30 & wait', timeoutMs: 10000 }, controller.signal);
  controller.abort();
  const aborted = await pending;
  assert.ok(aborted.durationMs < 3000);
  assert.notEqual(aborted.exitCode, 0);
});

test('timeout escalates to SIGKILL when a process group ignores SIGTERM', async () => {
  const result = await runCommand('/tmp', {
    command: "trap '' TERM; while :; do sleep 1; done",
    timeoutMs: 100,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  assert.ok(result.durationMs >= 1000 && result.durationMs < 4000);
});
