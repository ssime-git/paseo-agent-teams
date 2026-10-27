import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderEventSchema } from '@getpaseo/plugin/server/provider';
import { stateNarrations, teamThread, type TeamTimelineContext, type TranscriptEntry } from '../server/team-timeline';
import type { Workflow } from '../shared/contracts';
import { workflowFixture } from './fixtures';
import { translator } from '../shared/i18n';

const ctx: TeamTimelineContext = {
  t: translator('fr'),
  label: (role) => (role === 'builder' ? 'Codex · GPT-6.1' : 'Claude Code · Opus 5.5'),
  activity: (id) =>
    id === 'b1' ? [{ toolName: 'Edit', summary: 'src/palette.ts' }, { toolName: 'Shell' }] : undefined,
};
const plan = {
  summary: 'Palette',
  tasks: ['Index', 'Fuzzy search', 'Shortcuts'],
  acceptance: ['Opens'],
  tests: [{ command: 'npm test', timeoutMs: 600_000 }],
};
const build = { summary: 'Palette built', changes: ['src/palette.ts'], remaining: [] };
let n = 0;
const event = (kind: string, role?: Workflow['events'][number]['role'], operationId?: string, text = '') => ({
  id: `e${++n}`,
  at: 'now',
  kind,
  text,
  ...(role ? { role } : {}),
  ...(operationId ? { operationId } : {}),
});
const valid = (w: Workflow, transcript: TranscriptEntry[] = []) => {
  const items = teamThread(w, ctx, transcript);
  for (const item of items) ProviderEventSchema.parse({ type: 'timeline.item', sessionId: 's', item });
  return items;
};

test('a planned, built, rejected and corrected mission reads as native sub-agents, todo, shell and narration', () => {
  const w = workflowFixture();
  w.events.push(
    event('dispatch', 'planner', 'p1'),
    event('assistant', 'planner', 'p1', JSON.stringify(plan)),
    event('plan_approved', undefined, undefined, 'Plan v1 approuvé (human).'),
    event('dispatch', 'builder', 'b1'),
    event('assistant', 'builder', 'b1', JSON.stringify(build)),
    event('tests', undefined, 't1', 'npm test → 0'),
    event('dispatch', 'reviewer', 'r1'),
    event(
      'assistant',
      'reviewer',
      'r1',
      JSON.stringify({ verdict: 'fail', summary: 'One blocker', issues: ['Shortcut fires inside inputs'] }),
    ),
    event('correction', 'builder', undefined, 'Correction 1/2 : review refusée. Retour au Builder.'),
    event('dispatch', 'builder', 'b2'),
  );
  w.status = 'running';
  w.phase = 'building';
  w.cycle = 1;
  w.operation = { id: 'b2', role: 'builder', phase: 'building', state: 'sent', startedAt: 'now' };
  const items = valid(w);
  const agents = items.filter((i) => i.type === 'tool_call' && i.detail.type === 'sub_agent');
  assert.deepEqual(
    agents.map((i) => i.type === 'tool_call' && [i.callId, i.status]),
    [
      ['team-agent-p1', 'completed'],
      ['team-agent-b1', 'completed'],
      ['team-agent-r1', 'completed'],
      ['team-agent-b2', 'running'],
    ],
  );
  const first = agents[1];
  assert.ok(first.type === 'tool_call' && first.detail.type === 'sub_agent');
  assert.equal(first.detail.subAgentType, 'Code · Codex · GPT-6.1');
  assert.match(first.detail.log, /^\[Edit\] src\/palette\.ts\n\[Shell\]\nPalette built/);
  const correction = agents[3];
  assert.ok(correction.type === 'tool_call' && correction.detail.type === 'sub_agent');
  assert.match(correction.detail.description!, /Correction 1\/2/);
  assert.deepEqual(
    items.filter((i) => i.type === 'todo').map((i) => i.type === 'todo' && i.items.map((t) => t.completed)),
    [[true, true, true]],
  );
  const shell = items.find((i) => i.type === 'tool_call' && i.detail.type === 'shell');
  assert.ok(shell?.type === 'tool_call' && shell.detail.type === 'shell' && shell.detail.exitCode === 0);
  const spoken = items.flatMap((i) => (i.type === 'assistant_message' ? [i.text] : []));
  assert.ok(spoken.some((t) => t.includes('Shortcut fires inside inputs')));
  assert.ok(spoken.some((t) => t.startsWith('Correction 1/2')));
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
});

const said = (w: Workflow) => stateNarrations(w, ctx).map((n) => n.text);

test('a waiting plan asks for go, questions are numbered, and completion summarizes the mission', () => {
  const w = workflowFixture();
  w.plan = plan;
  w.events.push(event('dispatch', 'planner', 'p1'), event('assistant', 'planner', 'p1', JSON.stringify(plan)));
  assert.match(said(w).join('\n'), /3 étapes.*`npm test`.*\*\*go\*\* pour lancer Codex · GPT-6\.1/);
  const options = [
    { id: 'a', label: 'Ctrl+K', tradeoff: 'Common' },
    { id: 'b', label: 'Ctrl+P', tradeoff: 'Editor' },
  ];
  w.clarifications = [
    {
      id: 'batch',
      at: 'now',
      answers: [],
      request: {
        kind: 'clarification',
        summary: 'Two choices',
        questions: [
          { id: 'k', title: 'Shortcut?', options, recommendedOptionId: 'a' },
          { id: 's', title: 'Scope?', options, recommendedOptionId: 'a' },
        ],
      },
    },
  ];
  assert.match(
    said(w)[0],
    /^Two choices\n\n1\. \*\*Shortcut\?\*\* — Ctrl\+K · Ctrl\+P\n2\. \*\*Scope\?\*\* — Ctrl\+K · Ctrl\+P\n\nRépondez ici, une réponse par ligne/,
  );
  delete w.clarifications;
  w.status = 'completed';
  w.phase = 'done';
  w.build = build;
  w.review = { verdict: 'pass', summary: 'Clean', issues: [] };
  w.tests = [
    {
      command: 'npm test',
      timeoutMs: 1000,
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
      truncated: false,
    },
  ];
  assert.match(
    said(w).at(-1)!,
    /### Mission terminée\nPalette built\n\n- src\/palette\.ts\n\nRelecture : Clean\nTests : 1\/1 réussis\./,
  );
});

test('a restart replays recorded messages in their original place among role rows', () => {
  const w = workflowFixture();
  w.events.push(event('dispatch', 'planner', 'p1'), event('assistant', 'planner', 'p1', JSON.stringify(plan)));
  const transcript: TranscriptEntry[] = [
    { id: 'm1', role: 'user', text: 'Ship a palette', at: 0 },
    { id: 'plan:x', role: 'assistant', text: 'Le plan est prêt.', at: 2 },
    { id: 'm2', role: 'user', text: 'go', at: 2 },
  ];
  w.events.push(
    event('plan_approved', undefined, undefined, 'Plan v1 approuvé (human).'),
    event('dispatch', 'builder', 'b1'),
  );
  w.operation = { id: 'b1', role: 'builder', phase: 'building', state: 'sent', startedAt: 'now' };
  w.status = 'running';
  const order = valid(w, transcript).map((i) =>
    i.type === 'tool_call' ? i.callId : i.type === 'todo' ? 'todo' : `${i.type}:${'text' in i ? i.text : ''}`,
  );
  assert.deepEqual(order, [
    'user_message:Ship a palette',
    'team-agent-p1',
    'todo',
    'assistant_message:Le plan est prêt.',
    'user_message:go',
    'assistant_message:Plan validé. Codex · GPT-6.1 implémente.',
    'team-agent-b1',
  ]);
  // Missions recorded before the transcript still show their request first.
  assert.deepEqual(valid(w)[0], {
    id: `team:user:task:${w.id}`,
    type: 'user_message',
    text: w.task,
    clientMessageId: `task:${w.id}`,
  });
});

test('an interrupted or retained turn is reported as failed instead of running forever', () => {
  const w = workflowFixture();
  w.events.push(event('dispatch', 'builder', 'b1'));
  w.operation = { id: 'b1', role: 'builder', phase: 'building', state: 'sent', startedAt: 'now' };
  w.status = 'attention';
  w.error = 'Timeout limit reached';
  const row = valid(w).find((i) => i.type === 'tool_call');
  assert.ok(row?.type === 'tool_call' && row.status === 'failed');
  assert.deepEqual(row.error, { message: 'Timeout limit reached' });
  w.status = 'permission';
  assert.ok(valid(w).some((i) => i.type === 'tool_call' && i.status === 'running'));
  assert.ok(said(w).some((t) => /autorisation/.test(t)));
});

test('missions recorded before operation links still replay their role results', () => {
  const w = workflowFixture();
  w.events.push(event('dispatch', 'builder'), event('assistant', 'builder', undefined, JSON.stringify(build)));
  const rows = valid(w).filter((i) => i.type === 'tool_call');
  assert.equal(rows.length, 1);
  assert.ok(rows[0].type === 'tool_call' && rows[0].status === 'completed');
  assert.match(JSON.stringify(rows[0]), /Palette built/);
});

test('the thread speaks English when the language setting is English', () => {
  const w = workflowFixture();
  w.plan = plan;
  w.events.push(event('dispatch', 'planner', 'p1'), event('assistant', 'planner', 'p1', JSON.stringify(plan)));
  const english = { ...ctx, t: translator('en') };
  const row = teamThread(w, english, []).find((i) => i.type === 'tool_call');
  assert.ok(row?.type === 'tool_call' && row.detail.type === 'sub_agent');
  assert.equal(row.detail.description, 'Plan the mission');
  assert.equal(
    stateNarrations(w, english)[0].text,
    'The plan is ready (3 steps, tests: `npm test`). Reply **go** to start Codex · GPT-6.1, or describe what to change.',
  );
});

test('delivery has its own explicit question and the final summary includes verified receipt links', async () => {
  const { deliveryQuestion } = await import('../shared/delivery');
  const w = workflowFixture();
  w.phase = 'delivering';
  w.status = 'awaiting_final';
  w.build = build;
  w.clarifications = [
    { id: 'delivery-question', purpose: 'delivery', at: 'now', answers: [], request: deliveryQuestion },
  ];
  const narrations = stateNarrations(w, ctx);
  assert.equal(narrations.length, 1);
  assert.equal(narrations[0].id, 'clarify:delivery-question');
  assert.match(narrations[0].text, /PR · main/);
  assert.doesNotMatch(narrations[0].text, /\*\*go\*\*|Mission terminée/);
  w.clarifications[0].resolvedAt = 'later';
  w.phase = 'done';
  w.status = 'completed';
  w.delivery = {
    method: 'pull_request',
    approvedAt: 'later',
    fingerprint: 'validated',
    contentFingerprint: 'files',
    result: {
      status: 'delivered',
      summary: 'PR ready',
      repositories: [{ repository: '/repo', commit: 'a'.repeat(40), url: 'https://github.com/example/project/pull/1' }],
    },
  };
  assert.match(stateNarrations(w, ctx)[0].text, /\[PR\]\(https:\/\/github.com\/example\/project\/pull\/1\)/);
  w.events.push(event('closed'));
  assert.equal(stateNarrations(w, ctx).length, 0);
});
