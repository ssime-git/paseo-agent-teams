import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../server/prompt';
import { workflowFixture } from './fixtures';
import { parseProvider } from '../shared/provider-selection';
import { configSchema } from '../shared/contracts';

test('provider parsing and server configuration reject malformed selections', () => {
  for (const provider of ['missing-slash', '/model', 'harness/']) {
    assert.throws(() => parseProvider(provider), /harness\/model/);
    const config = workflowFixture().config;
    config.roles.builder.provider = provider;
    assert.equal(configSchema.safeParse(config).success, false);
  }
  assert.deepEqual(parseProvider('harness/vendor/model'), { harness: 'harness', model: 'vendor/model' });
});

test('the prompt bounds large inputs, recent conversation and repository context and retains the output schema', () => {
  const w = workflowFixture();
  w.task = 'é'.repeat(500000);
  w.events = Array.from({ length: 100 }, (_, i) => ({ id: String(i), at: '', kind: 'user', text: `message-${i}` }));
  const prompt = buildPrompt(w, 'planner', 'x'.repeat(500000));
  assert.ok(Buffer.byteLength(prompt) < 512 * 1024);
  assert.match(prompt, /Truncated/);
  assert.doesNotMatch(prompt, /message-0"/);
  assert.match(prompt, /message-99/);
  assert.match(prompt, /Return ONLY a JSON object matching this schema/);
});

test('hand-offs are role-specific and stay within the role budget', async () => {
  const { HANDOFF_BUDGET, estimateTokens } = await import('../server/prompt');
  const w = workflowFixture();
  w.config.mode = 'auto';
  w.plan = { summary: 'Plan', tasks: ['t'], acceptance: ['a'], tests: [] };
  w.review = { verdict: 'fail', summary: 'Nope', issues: ['fix-me'] };
  w.tests = [
    {
      command: 'npm test',
      timeoutMs: 1,
      stdout: 'ok\n'.repeat(50000),
      stderr: 'boom',
      exitCode: 1,
      durationMs: 1,
      timedOut: false,
      truncated: false,
    },
  ];
  const huge = 'x'.repeat(500000);
  for (const role of ['planner', 'builder', 'reviewer'] as const) {
    assert.ok(estimateTokens(buildPrompt(w, role, huge)) <= HANDOFF_BUDGET[role] + 2000, role);
  }
  assert.match(buildPrompt(w, 'builder', ''), /fix-me/);
  assert.doesNotMatch(buildPrompt(w, 'reviewer', ''), /fix-me/);
  assert.doesNotMatch(buildPrompt(w, 'builder', ''), /(ok\n){100}/);
});
