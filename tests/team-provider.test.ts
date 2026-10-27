import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderEventSchema,
  type ProviderEvent,
  type ProviderInput,
  type ProviderPersistence,
} from '@getpaseo/plugin/server/provider';
import { createTeamProvider, type TeamProviderBackend } from '../server/team-provider';
import { workflowFixture } from './fixtures';
import { automaticTeam } from '../shared/team-composition';

const choices = [
  {
    id: 'codex',
    family: 'codex',
    label: 'Codex',
    models: [{ id: 'detected/model', label: 'Detected', isDefault: true }],
    modes: [{ id: 'auto' }, { id: 'read-only' }],
  },
  { id: 'agent-teams', family: 'agent-teams', models: [{ id: 'auto', isDefault: true }], modes: [{ id: 'plan' }] },
];
async function setup(
  t: { after(fn: () => Promise<void>): void },
  language: 'fr' | 'en' | (() => 'fr' | 'en') = 'fr',
  pluginTimeline = true,
) {
  let w = workflowFixture();
  w.config.roles = automaticTeam(choices);
  w.config.builderAutoAccept = false;
  w.status = 'awaiting_plan';
  const calls: { kind: string; value: unknown }[] = [];
  let created = false;
  const backend: TeamProviderBackend = {
    language: async () => (typeof language === 'function' ? language() : language),
    open: async () => ({
      workspaceId: w.workspaceId,
      choices: choices.filter((p) => p.id !== 'agent-teams'),
      config: structuredClone(w.config),
    }),
    ownerWorkspace: async () => w.workspaceId,
    list: async () => (created ? [w] : []),
    get: async (id, workspaceId) => {
      assert.equal(id, w.id);
      assert.equal(workspaceId, w.workspaceId);
      return structuredClone(w);
    },
    create: async (workspaceId, task, config, requestId, ownerAgentId) => {
      calls.push({ kind: 'create', value: { workspaceId, task, config, requestId, ownerAgentId } });
      created = true;
      w = { ...w, config, task, requests: { [`create:${requestId}`]: 'receipt' } };
      return structuredClone(w);
    },
    action: async (action) => {
      calls.push({ kind: 'action', value: action });
      w.revision++;
      w.requests[action.requestId] = 'receipt';
      if (action.action === 'pause') w.status = 'paused';
      return structuredClone(w);
    },
  };
  const provider = createTeamProvider(backend);
  const connection = await provider.connect({
    versions: [1],
    capabilities: [
      'prompt.message',
      'prompt.command',
      'session.persistence',
      'session.configure',
      ...(pluginTimeline ? ['timeline.plugin' as const] : []),
    ],
  });
  t.after(() => connection.close());
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => {
    ProviderEventSchema.parse(event);
    events.push(event);
  });
  const open = (persistence?: ProviderPersistence, extra = {}) =>
    connection.send({
      type: 'session.open',
      requestId: 'open',
      sessionId: 'session',
      history: 'replay',
      persistence,
      config: {
        cwd: '/isolated',
        env: {
          PASEO_AGENT_TEAMS_WORKSPACE_ID: w.workspaceId,
          PASEO_AGENT_TEAMS_AGENT_ID: '00000000-0000-4000-8000-000000000001',
        },
        mcpServers: {},
        settings: {},
        persist: true,
        model: 'auto',
        mode: 'plan',
        ...extra,
      },
    });
  const prompt = (id: string, input: Extract<ProviderInput, { type: 'session.prompt' }>['prompt']['input']) =>
    connection.send({
      type: 'session.prompt',
      sessionId: 'session',
      prompt: { clientMessageId: id, delivery: 'auto', input },
    });
  return { connection, events, calls, open, prompt, workflow: () => w, provider, backend };
}

test('native Team catalog, detected role settings, explicit approval and idempotent prompt delivery', async (t) => {
  const s = await setup(t);
  await s.connection.send({ type: 'catalog', requestId: 'catalog' });
  assert.equal(s.events[0].type, 'catalog');
  await s.open();
  const config = s.events.find((e) => e.type === 'session.config');
  assert.equal(config?.type === 'session.config' && config.config.settings.length, 3);
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Implement a feature' }] });
  assert.equal(s.calls.length, 1);
  assert.match(JSON.stringify(s.events), /team-approve/);
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Implement a feature' }] });
  assert.equal(s.calls.length, 1);
  assert.equal(s.events.filter((e) => e.type === 'session.prompt_result' && e.clientMessageId === 'mission').length, 1);
  assert.equal(s.events.filter((e) => e.type === 'session.turn' && e.state === 'completed').length, 1);
  assert.equal(s.calls.filter((c) => c.kind === 'action').length, 0); // Waiting never approves.
  await s.prompt('approval', { type: 'command', name: 'team-approve-no-tests', arguments: '' });
  assert.deepEqual(s.calls.at(-1)?.value, {
    id: s.workflow().id,
    workspaceId: s.workflow().workspaceId,
    expectedRevision: s.workflow().revision - 1,
    requestId: (s.calls.at(-1)?.value as { requestId: string }).requestId,
    action: 'approve',
    allowNoTests: true,
  });
  await s.connection.send({
    type: 'session.configure',
    requestId: 'late-config',
    sessionId: 'session',
    changes: { mode: 'autonomous' },
  });
  assert.ok(s.events.some((e) => e.type === 'request.failed' && e.requestId === 'late-config'));
});

test('native Team restores the durable create receipt even when workflow persistence update was lost', async (t) => {
  const s = await setup(t);
  await s.open();
  const opened = s.events.find((e) => e.type === 'session.opened');
  assert.ok(opened?.type === 'session.opened' && opened.persistence);
  const old = opened.persistence;
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Keep context' }] });
  await s.connection.send({ type: 'session.close', sessionId: 'session', requestId: 'close' });
  await s.open(old);
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Keep context' }] });
  assert.equal(s.calls.filter((c) => c.kind === 'create').length, 1);
  assert.equal(s.calls.filter((c) => c.kind === 'action').length, 1); // Only explicit session close paused it.
  assert.equal(s.workflow().task, 'Keep context');
});

test('native Team rejects unsupported context and attachments instead of silently losing it', async (t) => {
  const s = await setup(t);
  await s.open(undefined, { systemPrompt: 'Important custom restriction' });
  assert.ok(s.events.some((e) => e.type === 'request.failed'));
  assert.equal(
    s.events.some((e) => e.type === 'session.ready'),
    false,
  );
  await s.open();
  await s.prompt('image', { type: 'message', content: [{ type: 'image', data: 'not-used', mimeType: 'image/png' }] });
  assert.equal(s.calls.length, 0);
  assert.ok(s.events.some((e) => e.type === 'session.prompt_result' && e.result.type === 'failed'));
  await s.connection.send({
    type: 'session.configure',
    sessionId: 'session',
    requestId: 'self',
    changes: { settings: { planner: 'agent-teams/auto' } },
  });
  assert.ok(s.events.some((e) => e.type === 'request.failed' && e.requestId === 'self'));
});

test('native Team keeps multi-question clarification pending and accepts an explicit free answer to one remaining question', async (t) => {
  const s = await setup(t);
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Ambiguous task' }] });
  const question = {
    id: 'scope',
    title: 'Scope?',
    options: [
      { id: 'small', label: 'Small', tradeoff: 'Less' },
      { id: 'all', label: 'All', tradeoff: 'More' },
    ],
    recommendedOptionId: 'small',
  };
  s.workflow().clarifications = [
    {
      id: 'batch',
      at: 'now',
      answers: [],
      request: { kind: 'clarification', summary: 'Clarify', questions: [question, { ...question, id: 'other' }] },
    },
  ];
  await s.prompt('ambiguous', { type: 'message', content: [{ type: 'text', text: 'Something' }] });
  assert.equal(s.calls.length, 1);
  s.workflow().clarifications![0].request.questions.pop();
  await s.prompt('answer', { type: 'message', content: [{ type: 'text', text: 'Only docs, no code' }] });
  const action = s.calls.at(-1)?.value as { action: string; answers: unknown[] };
  assert.equal(action.action, 'answer_clarification');
  assert.deepEqual(action.answers, [{ questionId: 'scope', text: 'Only docs, no code' }]);
});

test('native Team resolves late agent placement before creating the first workflow', async (t) => {
  const s = await setup(t);
  await s.open();
  s.workflow().workspaceId = 'final-native-owner';
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Use the actual native workspace' }] });
  assert.equal((s.calls[0].value as { workspaceId: string }).workspaceId, 'final-native-owner');
  const saved = s.events.filter((e) => e.type === 'session.persistence').at(-1);
  assert.equal(
    saved?.type === 'session.persistence' && (saved.persistence.data as { workspaceId: string }).workspaceId,
    'final-native-owner',
  );
});

test('native Team projects role turns as native sub-agents in one conversation without dispatching another request', async (t) => {
  const s = await setup(t);
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Follow the team' }] });
  const w = s.workflow();
  const plan = { summary: 'Plan', tasks: ['Index', 'Search'], acceptance: ['Works'], tests: [{ command: 'npm test' }] };
  w.events.push(
    { id: 'e1', at: 'now', kind: 'dispatch', role: 'planner', text: 'Starting planner', operationId: 'op-plan' },
    { id: 'e2', at: 'now', kind: 'assistant', role: 'planner', text: JSON.stringify(plan), operationId: 'op-plan' },
    { id: 'e3', at: 'now', kind: 'dispatch', role: 'builder', text: 'Starting builder', operationId: 'op-build' },
  );
  w.status = 'running';
  w.phase = 'building';
  w.operation = { id: 'op-build', role: 'builder', phase: 'building', state: 'sent', startedAt: 'now' };
  w.revision++;
  await s.prompt('status', { type: 'command', name: 'team-status', arguments: '' });
  const items = () => s.events.flatMap((e) => (e.type === 'timeline.item' ? [e.item] : []));
  const build = items().filter((i) => i.type === 'tool_call' && i.callId === 'team-agent-op-build');
  assert.equal(build.length, 1);
  assert.ok(build[0].type === 'tool_call' && build[0].status === 'running' && build[0].detail.type === 'sub_agent');
  assert.match(JSON.stringify(build[0]), /Code · Codex · Detected/);
  assert.ok(items().some((i) => i.type === 'todo' && i.items.length === 2));
  assert.equal(
    items().some((i) => i.type === 'plugin'),
    false,
  );
  // The orchestrator turn stays open while a role works, so the row completes in the same native turn.
  assert.equal(
    s.events.some((e) => e.type === 'session.turn' && e.turnId === 'team:turn:status' && e.state === 'completed'),
    false,
  );
  w.events.push({
    id: 'e4',
    at: 'now',
    kind: 'assistant',
    role: 'builder',
    text: JSON.stringify({ summary: 'Built', changes: ['src/a.ts'], remaining: [] }),
    operationId: 'op-build',
  });
  delete w.operation;
  w.status = 'awaiting_final';
  w.revision++;
  await new Promise((resolve) => setTimeout(resolve, 1700)); // Next provider poll.
  const updates = items().filter((i) => i.type === 'tool_call' && i.callId === 'team-agent-op-build');
  const last = updates.at(-1);
  assert.equal(last?.type === 'tool_call' && last.status, 'completed');
  assert.match(JSON.stringify(updates.at(-1)), /src\/a\.ts/);
  assert.equal(s.calls.filter((c) => c.kind === 'create').length, 1);
  assert.equal((s.calls[0].value as { ownerAgentId?: string }).ownerAgentId, '00000000-0000-4000-8000-000000000001');
  assert.ok(
    s.events.some((e) => e.type === 'session.turn' && e.turnId === 'team:turn:status' && e.state === 'completed'),
  );
});

test('native Team approves on an explicit short reply and maps numbered answers to several questions', async (t) => {
  const s = await setup(t);
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Prepare a plan' }] });
  await s.prompt('go', { type: 'message', content: [{ type: 'text', text: 'Go !' }] });
  assert.equal((s.calls.at(-1)?.value as { action: string }).action, 'approve');
  await s.prompt('change', { type: 'message', content: [{ type: 'text', text: 'go further, add docs' }] });
  assert.equal((s.calls.at(-1)?.value as { action: string }).action, 'followup');
  const question = {
    id: 'a',
    title: 'A?',
    options: [
      { id: 'x', label: 'X', tradeoff: 'x' },
      { id: 'y', label: 'Y', tradeoff: 'y' },
    ],
    recommendedOptionId: 'x',
  };
  s.workflow().clarifications = [
    {
      id: 'batch',
      at: 'now',
      answers: [],
      request: { kind: 'clarification', summary: 'Clarify', questions: [question, { ...question, id: 'b' }] },
    },
  ];
  const before = s.calls.length;
  await s.prompt('partial', { type: 'message', content: [{ type: 'text', text: 'only one answer' }] });
  assert.equal(s.calls.length, before);
  await s.prompt('answers', { type: 'message', content: [{ type: 'text', text: '1. Ctrl+K\n2. All screens' }] });
  assert.deepEqual((s.calls.at(-1)?.value as { answers: unknown }).answers, [
    { questionId: 'a', text: 'Ctrl+K' },
    { questionId: 'b', text: 'All screens' },
  ]);
});

test('literal native slash commands stay explicit actions and are never forwarded to a model', async (t) => {
  const s = await setup(t);
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Prepare a plan' }] });
  await s.prompt('pause', { type: 'message', content: [{ type: 'text', text: '/team-pause' }] });
  assert.equal((s.calls.at(-1)?.value as { action: string }).action, 'pause');
  assert.equal(s.workflow().status, 'paused');
  const count = s.calls.length;
  await s.prompt('invalid', { type: 'message', content: [{ type: 'text', text: '/team-unknown' }] });
  assert.equal(s.calls.length, count);
});

test('native Team catalog, modes and commands follow the language setting', async (t) => {
  const s = await setup(t, 'en');
  await s.connection.send({ type: 'catalog', requestId: 'catalog' });
  const catalog = s.events.find((e) => e.type === 'catalog');
  assert.ok(catalog?.type === 'catalog');
  assert.deepEqual(
    catalog.catalog.modes.map((m) => m.label),
    ['Approve the plan', 'Approve the result', 'Autonomous validation'],
  );
  await s.open();
  const commands = s.events.find((e) => e.type === 'session.commands');
  assert.ok(commands?.type === 'session.commands' && commands.commands[0].description === 'Show the team status');
  const config = s.events.find((e) => e.type === 'session.config');
  assert.ok(config?.type === 'session.config');
  assert.deepEqual(
    config.config.settings.map((setting) => setting.label),
    ['Plan', 'Code', 'Review'],
  );
  assert.equal(config.config.modes.find((m) => m.id === 'plan')?.label, 'Approve the plan');
});

test('a language change never re-emits finished rows, which Paseo would show twice', async (t) => {
  let language: 'fr' | 'en' = 'fr';
  const s = await setup(t, () => language);
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Ship it' }] });
  const w = s.workflow();
  const plan = { summary: 'Plan', tasks: ['One'], acceptance: ['Works'], tests: [{ command: 'npm test' }] };
  w.events.push(
    { id: 'e1', at: 'now', kind: 'dispatch', role: 'planner', text: 'Starting planner', operationId: 'op-plan' },
    { id: 'e2', at: 'now', kind: 'assistant', role: 'planner', text: JSON.stringify(plan), operationId: 'op-plan' },
  );
  w.revision++;
  await new Promise((resolve) => setTimeout(resolve, 1700));
  const rows = () =>
    s.events.filter(
      (e) => e.type === 'timeline.item' && e.item.type === 'tool_call' && e.item.callId === 'team-agent-op-plan',
    );
  assert.equal(rows().length, 1);
  language = 'en';
  await new Promise((resolve) => setTimeout(resolve, 1700));
  assert.equal(rows().length, 1);
});

test('/team-status answers in the thread with who has control and the team', async (t) => {
  const s = await setup(t, 'en');
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Ship it' }] });
  const w = s.workflow();
  w.status = 'running';
  w.phase = 'building';
  w.operation = { id: 'op-build', role: 'builder', phase: 'building', state: 'sent', startedAt: 'now' };
  w.events.push({
    id: 'd',
    at: 'now',
    kind: 'dispatch',
    role: 'builder',
    text: 'Starting builder',
    operationId: 'op-build',
  });
  w.revision++;
  await s.connection.send({ type: 'session.interrupt', sessionId: 'session', requestId: 'stop' });
  w.status = 'running';
  await s.prompt('status', { type: 'command', name: 'team-status', arguments: '' });
  const said = s.events.flatMap((e) =>
    e.type === 'timeline.item' && e.item.type === 'assistant_message' ? [e.item.text] : [],
  );
  assert.match(
    said.at(-1)!,
    /^\*\*Code is working\.\*\*\n\nPlan · Codex · Detected — Code · Codex · Detected — Review · Codex · Detected\n\nCorrection 0\/2\.$/,
  );
});

test('native graph discovery works before a V1 mission, persists and replays without execution', async (t) => {
  const s = await setup(t, 'en');
  const scopes: unknown[] = [];
  s.backend.graphs = async (workspaceId, ownerAgentId) => {
    scopes.push({ workspaceId, ownerAgentId });
    return [];
  };
  await s.open();
  await s.prompt('graphs', { type: 'message', content: [{ type: 'text', text: '/team-graphs' }] });
  assert.deepEqual(scopes, [
    { workspaceId: s.workflow().workspaceId, ownerAgentId: '00000000-0000-4000-8000-000000000001' },
  ]);
  assert.equal(s.calls.length, 0);
  assert.match(JSON.stringify(s.events), /No admitted graphs/);
  assert.ok(s.events.some((e) => e.type === 'session.turn' && e.state === 'completed'));
  const persisted = s.events.filter((e) => e.type === 'session.persistence').at(-1);
  assert.ok(persisted?.type === 'session.persistence');
  await s.connection.send({ type: 'session.close', sessionId: 'session', requestId: 'close' });
  s.events.length = 0;
  await s.open(persisted.persistence);
  assert.match(JSON.stringify(s.events), /No admitted graphs/);
  await s.prompt('graphs', { type: 'command', name: 'team-graphs', arguments: '' });
  assert.equal(scopes.length, 1); // Lost prompt acknowledgement replays the saved report.
  assert.equal(s.calls.length, 0);
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Implement now' }] });
  assert.equal(s.calls.length, 1); // Discovery never binds or replaces the V1 receipt.
});

test('native graph discovery errors and arguments never create a mission or invent a report', async (t) => {
  const s = await setup(t);
  s.backend.graphs = async () => {
    throw new Error('Native Team owner unavailable');
  };
  await s.open();
  await s.prompt('extra', { type: 'command', name: 'team-graphs', arguments: 'approve' });
  await s.prompt('denied', { type: 'command', name: 'team-graphs', arguments: '' });
  assert.equal(s.calls.length, 0);
  const results = s.events.filter((e) => e.type === 'session.prompt_result');
  assert.equal(results.length, 2);
  assert.ok(results.every((e) => e.type === 'session.prompt_result' && e.result.type === 'failed'));
  assert.ok(!JSON.stringify(s.events).includes('Aucun graphe admis'));
});

test('native graph report coexists with a V1 mission without approving or resuming it', async (t) => {
  const s = await setup(t);
  s.backend.graphs = async () => [];
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Wait for approval' }] });
  await s.prompt('graphs', { type: 'command', name: 'team-graphs', arguments: '' });
  assert.equal(s.calls.length, 1);
  assert.equal(s.workflow().status, 'awaiting_plan');
  assert.match(JSON.stringify(s.events), /Aucun graphe admis/);
});

test('graph report projection failure finishes the accepted native turn with an error', async (t) => {
  const s = await setup(t);
  s.backend.graphs = async () => [];
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Wait for approval' }] });
  const get = s.backend.get;
  let reads = 0;
  s.backend.get = async (...args) => {
    if (++reads > 1) throw new Error('Workflow read failed');
    return get(...args);
  };
  await s.prompt('graphs', { type: 'command', name: 'team-graphs', arguments: '' });
  assert.ok(s.events.some((e) => e.type === 'session.turn' && e.turnId === 'team:turn:graphs' && e.state === 'failed'));
  assert.equal(s.calls.length, 1);
});

test('native graph continuation is scoped, bounded, persisted and replayed after reconnect', async (t) => {
  const s = await setup(t, 'en');
  const requests: unknown[] = [];
  const id = '00000000-0000-4000-8000-000000000002';
  s.backend.advanceGraph = async (input) => {
    requests.push(input);
    // Presentation fixture: checkpoint validity and advancement are tested by graph-launch.test.ts.
    return {
      status: 'waiting',
      reason: 'human',
      state: {
        id,
        revision: 3,
        status: 'waiting_human',
        activations: [],
        nextStepId: 'approval',
        source: { revision: 1, definition: { name: 'Custom flow', maxTransitions: 2 } },
      } as unknown as Awaited<ReturnType<NonNullable<TeamProviderBackend['advanceGraph']>>>['state'],
    };
  };
  await s.open();
  await s.prompt('advance', { type: 'message', content: [{ type: 'text', text: `/team-advance ${id} 2` }] });
  assert.deepEqual(requests, [
    {
      id,
      expectedRevision: 2,
      workspaceId: s.workflow().workspaceId,
      ownerAgentId: '00000000-0000-4000-8000-000000000001',
    },
  ]);
  assert.equal(s.calls.length, 0);
  assert.match(JSON.stringify(s.events), /Waiting for a human decision/);
  assert.match(JSON.stringify(s.events), /No implicit human decision or approval/);
  const saved = s.events.filter((e) => e.type === 'session.persistence').at(-1);
  assert.ok(saved?.type === 'session.persistence');
  await s.connection.send({ type: 'session.close', sessionId: 'session', requestId: 'close' });
  await s.open(saved.persistence);
  await s.prompt('advance', { type: 'command', name: 'team-advance', arguments: `${id} 2` });
  assert.equal(requests.length, 1);
  assert.equal(s.calls.length, 0);
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Wait for my plan approval' }] });
  await s.prompt('advance-again', { type: 'command', name: 'team-advance', arguments: `${id} 2` });
  assert.equal(requests.length, 2);
  assert.equal(s.calls.length, 1);
  assert.equal(s.workflow().status, 'awaiting_plan');
});

test('native continuation rejects missing revisions, malformed arguments and ownership failures', async (t) => {
  const s = await setup(t);
  let calls = 0;
  s.backend.advanceGraph = async () => {
    calls++;
    throw new Error('Native Team owner unavailable');
  };
  await s.open();
  const id = '00000000-0000-4000-8000-000000000002';
  for (const [i, args] of [
    '',
    id,
    `${id} 0`,
    `${id} -1`,
    `${id} 1.5`,
    `${id} 1e2`,
    `${id} 9007199254740992`,
    `${id} 1 approve`,
    'bad 1',
  ].entries()) {
    await s.prompt(`invalid-${i}`, { type: 'command', name: 'team-advance', arguments: args });
  }
  assert.equal(calls, 0);
  await s.prompt('denied', { type: 'command', name: 'team-advance', arguments: `${id} 1` });
  assert.equal(calls, 1);
  assert.equal(s.calls.length, 0);
  assert.ok(
    s.events
      .filter((e) => e.type === 'session.prompt_result')
      .every((e) => e.type === 'session.prompt_result' && e.result.type === 'failed'),
  );
});

test('graph action cards survive native persistence and replay as text on hosts without plugin timelines', async (t) => {
  const s = await setup(t);
  s.backend.graphs = async () => [];
  await s.open();
  await s.prompt('graphs', { type: 'command', name: 'team-graphs', arguments: '' });
  const card = s.events.find((e) => e.type === 'timeline.item' && e.item.type === 'plugin');
  assert.ok(card?.type === 'timeline.item' && card.item.type === 'plugin');
  assert.equal(card.item.kind, 'agent-teams-graphs');
  const persisted = s.events.filter((e) => e.type === 'session.persistence').at(-1);
  assert.ok(persisted?.type === 'session.persistence');
  const fallback = await setup(t, 'fr', false);
  await fallback.open(persisted.persistence);
  assert.ok(!fallback.events.some((e) => e.type === 'timeline.item' && e.item.type === 'plugin'));
  assert.ok(
    fallback.events.some(
      (e) =>
        e.type === 'timeline.item' && e.item.type === 'assistant_message' && /Aucun graphe admis/.test(e.item.text),
    ),
  );
  assert.equal(fallback.calls.length, 0);
});
