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
