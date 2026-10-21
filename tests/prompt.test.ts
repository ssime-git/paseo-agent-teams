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

test('long plan prose never hides acceptance, verification or the developer testing responsibility', () => {
  const w = workflowFixture();
  w.plan = {
    summary: 'x'.repeat(30000),
    tasks: ['Implement the behavior'],
    acceptance: ['Preserve 4xx regression coverage'],
    tests: [{ command: 'node --test', timeoutMs: 1000 }],
  };
  const prompt = buildPrompt(w, 'builder', '');
  assert.match(prompt, /Preserve 4xx regression coverage/);
  assert.match(prompt, /node --test/);
  assert.match(prompt, /run relevant commands and tests/);
  assert.match(prompt, /not a reason to skip testing/);
  assert.match(prompt, /skills available in your own harness/);
});

test('clarification decisions survive long histories and every role including follow-up', () => {
  const w = workflowFixture();
  w.clarifications = Array.from({ length: 4 }, (_, i) => ({
    id: `batch-${i}`,
    at: '2026-10-21T00:00:00Z',
    resolvedAt: '2026-10-21T00:01:00Z',
    request: {
      kind: 'clarification' as const,
      summary: `Decision ${i}`,
      questions: [
        {
          id: 'scope',
          title: `Scope ${i}`,
          options: [
            { id: 'a', label: 'Focused', tradeoff: 'Less work' },
            { id: 'b', label: 'Full', tradeoff: 'More work' },
          ],
          recommendedOptionId: 'a',
        },
      ],
    },
    answers: [{ questionId: 'scope', text: `Début-${i} ${'é'.repeat(5000)} Fin-${i}`, at: '2026-10-21T00:01:00Z' }],
  }));
  const expected = JSON.stringify(w.clarifications);
  assert.ok(Buffer.byteLength(expected) > 16 * 1024);
  for (const phase of ['planning', 'followup'] as const) {
    w.phase = phase;
    for (const role of ['planner', 'builder', 'reviewer'] as const) {
      const prompt = buildPrompt(w, role, 'repository '.repeat(10000));
      const line = prompt
        .split('\n')
        .find((line) => line.startsWith('Persisted clarification questions and answers: '))!;
      assert.deepEqual(
        JSON.parse(line.slice('Persisted clarification questions and answers: '.length)),
        w.clarifications,
      );
    }
  }
});

test('oversized clarification history explicitly blocks rather than sending partial decisions', async () => {
  const { CLARIFICATION_CONTEXT_BYTES } = await import('../server/prompt');
  const w = workflowFixture();
  w.clarifications = Array.from({ length: 20 }, (_, i) => ({
    id: `batch-${i}`,
    at: '2026-10-21T00:00:00Z',
    resolvedAt: '2026-10-21T00:01:00Z',
    request: {
      kind: 'clarification' as const,
      summary: 'Scope',
      questions: [
        {
          id: 'scope',
          title: 'Which scope?',
          recommendedOptionId: 'a',
          options: [
            { id: 'a', label: 'Focused', tradeoff: 'Less work' },
            { id: 'b', label: 'Full', tradeoff: 'More work' },
          ],
        },
      ],
    },
    answers: [{ questionId: 'scope', text: 'é'.repeat(4000), at: '2026-10-21T00:01:00Z' }],
  }));
  assert.ok(JSON.stringify(w.clarifications).length < CLARIFICATION_CONTEXT_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(w.clarifications)) > CLARIFICATION_CONTEXT_BYTES);
  for (const phase of ['planning', 'followup'] as const) {
    w.phase = phase;
    assert.throws(() => buildPrompt(w, 'planner', ''), { name: 'CLARIFICATION_CONTEXT_LIMIT' });
  }
});
