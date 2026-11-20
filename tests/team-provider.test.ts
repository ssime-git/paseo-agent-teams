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
import { RepositoryBusy } from '../shared/errors';
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
  overrides: Partial<TeamProviderBackend> = {},
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
  Object.assign(backend, overrides);
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
  assert.equal(config?.type === 'session.config' && config.config.settings.length, 4);
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

test('native Team releases its turn while a role works and publishes its finished row once', async (t) => {
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
  assert.equal(build.length, 0);
  assert.ok(items().some((i) => i.type === 'todo' && i.items.length === 2));
  assert.equal(
    items().some((i) => i.type === 'plugin' && i.kind === 'agent-teams-activity'),
    true,
  );
  // The owner is idle while Code works and can receive another message.
  assert.equal(
    s.events.some((e) => e.type === 'session.turn' && e.turnId === 'team:turn:status' && e.state === 'completed'),
    true,
  );
  await s.prompt('during-code', { type: 'message', content: [{ type: 'text', text: 'Explain the current task' }] });
  assert.equal((s.calls.at(-1)?.value as { action: string }).action, 'followup');
  assert.ok(
    s.events.some((e) => e.type === 'session.turn' && e.turnId === 'team:turn:during-code' && e.state === 'completed'),
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
  assert.equal(updates.length, 1);
  assert.match(JSON.stringify(last), /Code · Codex · Detected/);
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
    ['Plan', 'Code', 'Review', 'Response language'],
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

test('graph wait cards appear from committed change notifications without a prompt and replay once', async (t) => {
  let notify!: (state: import('../shared/graph-checkpoint').GraphCheckpoint) => void;
  let removed = 0,
    reads = 0;
  let states: import('../shared/graph-checkpoint').GraphCheckpoint[] = [];
  const s = await setup(t, 'fr', true, {
    watchGraphs(listener) {
      notify = listener;
      return () => {
        removed++;
      };
    },
    async graphs() {
      reads++;
      return states;
    },
  });
  await s.open();
  const state = {
    id: '00000000-0000-4000-8000-000000000002',
    status: 'waiting_human',
    task: 'Await human input',
    source: { definition: { name: 'My graph' } },
    admission: { ownerAgentId: '00000000-0000-4000-8000-000000000001' },
    activations: [{ operationId: '00000000-0000-4000-8000-000000000003' }],
  } as unknown as import('../shared/graph-checkpoint').GraphCheckpoint;
  states = [state];
  notify(state);
  notify(state);
  await new Promise((resolve) => setTimeout(resolve, 1700));
  const cards = () =>
    s.events.filter(
      (e) => e.type === 'timeline.item' && e.item.type === 'plugin' && e.item.kind === 'agent-teams-graphs',
    );
  assert.equal(cards().length, 1);
  assert.match(JSON.stringify(cards()), /En attente de réponse/);
  assert.match(JSON.stringify(cards()), /graphId/);
  assert.equal(s.calls.length, 0);
  assert.equal(reads, 2);
  const saved = s.events.filter((e) => e.type === 'session.persistence').at(-1);
  assert.ok(saved?.type === 'session.persistence');
  await s.connection.send({ type: 'session.close', sessionId: 'session', requestId: 'close' });
  s.events.length = 0;
  await s.open(saved.persistence);
  assert.equal(cards().length, 1);
  await new Promise((resolve) => setTimeout(resolve, 1700));
  assert.equal(cards().length, 1);
  assert.equal(reads, 3); // Idle projection does not poll graph checkpoints.
  await s.connection.close();
  assert.equal(removed, 1);
});

test('Planner clarification cards appear automatically and old pending transcripts recover their response button', async (t) => {
  const s = await setup(t);
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'An ambiguous task' }] });
  s.workflow().clarifications = [
    {
      id: 'pending',
      at: 'now',
      answers: [],
      request: {
        kind: 'clarification',
        summary: 'Pick scope',
        questions: [
          {
            id: 'scope',
            title: 'What scope?',
            recommendedOptionId: 'small',
            options: [
              { id: 'small', label: 'Small', tradeoff: 'Less' },
              { id: 'large', label: 'Large', tradeoff: 'More' },
            ],
          },
        ],
      },
    },
  ];
  await new Promise((resolve) => setTimeout(resolve, 1700));
  const cards = s.events.filter(
    (e) => e.type === 'timeline.item' && e.item.type === 'plugin' && e.item.kind === 'agent-teams-question',
  );
  assert.equal(cards.length, 1);
  assert.equal(s.calls.length, 1);
  const saved = s.events.filter((e) => e.type === 'session.persistence').at(-1);
  assert.ok(saved?.type === 'session.persistence');
  const legacy = structuredClone(saved.persistence);
  for (const entry of (legacy.data as { transcript: { plannerQuestion?: unknown }[] }).transcript)
    delete entry.plannerQuestion;
  await s.connection.send({ type: 'session.close', sessionId: 'session', requestId: 'close' });
  s.events.length = 0;
  const callsBeforeRestore = s.calls.length;
  await s.open(legacy);
  assert.equal(
    s.events.filter(
      (e) => e.type === 'timeline.item' && e.item.type === 'plugin' && e.item.kind === 'agent-teams-question',
    ).length,
    1,
  );
  assert.equal(s.calls.length, callsBeforeRestore);
});

test('workflow discovery sent as steering is rejected without starting or approving a workflow', async (t) => {
  let discoveries = 0;
  const s = await setup(t, 'fr', true, {
    graphs: async () => {
      discoveries++;
      return [];
    },
  });
  await s.open();
  await s.connection.send({
    type: 'session.prompt',
    sessionId: 'session',
    prompt: {
      clientMessageId: 'concurrent-discovery',
      delivery: 'steer',
      input: { type: 'message', content: [{ type: 'text', text: '/team-graphs' }] },
    },
  });
  assert.equal(discoveries, 0);
  assert.deepEqual(s.calls, []);
  assert.match(JSON.stringify(s.events), /Unsupported Team prompt capability/);
  assert.equal(
    s.events.some((e) => e.type === 'session.turn' && e.state === 'started'),
    false,
  );
});

test('native response language is explicit, durable, validated and frozen before mission creation', async (t) => {
  const s = await setup(t, 'fr');
  await s.open();
  const configure = (requestId: string, settings: Record<string, string>) =>
    s.connection.send({
      type: 'session.configure',
      sessionId: 'session',
      requestId,
      changes: { settings },
    });
  await configure('english', { responseLanguage: 'en' });
  const persistence = s.events.findLast((e) => e.type === 'session.persistence');
  assert.ok(persistence?.type === 'session.persistence');
  await s.connection.send({ type: 'session.close', sessionId: 'session', requestId: 'close' });
  await s.open(persistence.persistence);
  const restored = s.events.findLast((e) => e.type === 'session.config');
  assert.ok(restored?.type === 'session.config');
  assert.equal(restored.config.settings.find((x) => x.id === 'responseLanguage')?.value, 'en');
  await configure('invalid', { responseLanguage: 'de' });
  assert.ok(s.events.some((e) => e.type === 'request.failed' && e.requestId === 'invalid'));
  await configure('atomic', { responseLanguage: 'fr', planner: 'unknown/model' });
  assert.ok(s.events.some((e) => e.type === 'request.failed' && e.requestId === 'atomic'));
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Implement a feature' }] });
  assert.equal(s.workflow().config.responseLanguage, 'en');
  await configure('late', { responseLanguage: 'fr' });
  assert.ok(s.events.some((e) => e.type === 'request.failed' && e.requestId === 'late'));
  assert.equal(s.workflow().config.responseLanguage, 'en');
  const fallback = await setup(t, 'en');
  await fallback.open();
  await fallback.connection.send({
    type: 'session.configure',
    sessionId: 'session',
    requestId: 'explicit',
    changes: { settings: { responseLanguage: 'fr' } },
  });
  await fallback.connection.send({
    type: 'session.configure',
    sessionId: 'session',
    requestId: 'host',
    changes: { settings: { responseLanguage: 'host' } },
  });
  await fallback.prompt('fallback', { type: 'message', content: [{ type: 'text', text: 'Use host fallback' }] });
  assert.equal(Object.hasOwn(fallback.workflow().config, 'responseLanguage'), false);
});

test('native restore recovers the core language setting from an older handle but never overrides a mission receipt', async (t) => {
  const s = await setup(t);
  await s.open();
  const opened = s.events.find((e) => e.type === 'session.opened');
  assert.ok(opened?.type === 'session.opened' && opened.persistence);
  await s.connection.send({ type: 'session.close', sessionId: 'session', requestId: 'close' });
  await s.open(opened.persistence, { settings: { responseLanguage: 'en' } });
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Keep this language' }] });
  assert.equal(s.workflow().config.responseLanguage, 'en');
  await s.connection.send({ type: 'session.close', sessionId: 'session', requestId: 'close-again' });
  await s.open(opened.persistence, { settings: { responseLanguage: 'fr' } });
  const config = s.events.findLast((e) => e.type === 'session.config');
  assert.ok(config?.type === 'session.config');
  assert.equal(config.config.settings.find((x) => x.id === 'responseLanguage')?.value, 'en');
  assert.equal(s.calls.filter((c) => c.kind === 'create').length, 1);
});

test('a repository status question answers directly without creating a mission and replays once', async (t) => {
  const s = await setup(t, 'fr', true, { remainingRoadmap: async () => ['Valider le graphe personnalisé'] });
  await s.open();
  const input = {
    type: 'message' as const,
    content: [{ type: 'text' as const, text: "que reste t'il à implémenter" }],
  };
  await s.prompt('question', input);
  await s.prompt('question', input);
  assert.equal(s.calls.length, 0);
  const answers = s.events.filter((e) => e.type === 'timeline.item' && e.item.type === 'assistant_message');
  assert.equal(answers.length, 1);
  assert.match(JSON.stringify(answers[0]), /Valider le graphe personnalisé/);
  assert.equal(s.events.filter((e) => e.type === 'session.turn' && e.state === 'completed').length, 1);
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Implement a feature' }] });
  assert.deepEqual(
    s.calls.map((call) => call.kind),
    ['create'],
  );
  const before = structuredClone(s.workflow());
  await s.prompt('status', { type: 'message', content: [{ type: 'text', text: "What's left to do?" }] });
  assert.deepEqual(s.workflow(), before);
  assert.deepEqual(
    s.calls.map((call) => call.kind),
    ['create'],
  );
  assert.match(JSON.stringify(s.events), /Le plan attend votre accord/);
});

test('Team revision and adoption commands route explicitly, retain the request and replay without a second action', async (t) => {
  const s = await setup(t);
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Prepare a plan' }] });
  const revision = {
    type: 'message' as const,
    content: [{ type: 'text' as const, text: '/team-revise Add edge cases\nKeep the existing tests.' }],
  };
  await s.prompt('revision', revision);
  assert.deepEqual(s.calls.at(-1)?.value, {
    id: s.workflow().id,
    workspaceId: s.workflow().workspaceId,
    expectedRevision: 0,
    requestId: (s.calls.at(-1)?.value as { requestId: string }).requestId,
    action: 'followup',
    purpose: 'plan_revision',
    message: 'Add edge cases\nKeep the existing tests.',
  });
  const count = s.calls.length;
  await s.prompt('revision', revision);
  assert.equal(s.calls.length, count);
  assert.match(JSON.stringify(s.events), /team-revise Add edge cases\\nKeep the existing tests/);
  await s.prompt('adopt', { type: 'command', name: 'team-adopt', arguments: '' });
  const action = s.calls.at(-1)?.value as { action: string; allowNoTests?: boolean };
  assert.equal(action.action, 'adopt_plan');
  assert.equal(action.allowNoTests, undefined);
  assert.equal(s.workflow().testsApproved, false);
  assert.equal(
    s.calls.filter((c) => c.kind === 'action' && (c.value as { action: string }).action === 'approve').length,
    0,
  );
});

test('Team plan commands reject missing requests, extra adoption arguments and absent missions without mutation', async (t) => {
  const s = await setup(t, 'en');
  await s.open();
  for (const [i, text] of ['/team-revise Add tests', '/team-adopt', '/team-revise', '/team-adopt yes'].entries()) {
    await s.prompt('invalid-before-' + i, { type: 'message', content: [{ type: 'text', text }] });
    assert.equal(s.calls.length, 0);
  }
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Prepare a plan' }] });
  const count = s.calls.length;
  await s.prompt('empty', { type: 'command', name: 'team-revise', arguments: '  ' });
  await s.prompt('extra', { type: 'command', name: 'team-adopt', arguments: 'approve' });
  assert.equal(s.calls.length, count);
  assert.match(JSON.stringify(s.events), /Describe the revision after/);
});

test('restored Team settings mirrored as provider options reopen without losing commands or allowing custom restrictions', async (t) => {
  const s = await setup(t);
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Prepare a plan' }] });
  await s.prompt('revision', { type: 'command', name: 'team-revise', arguments: 'Keep scope' });
  const persisted = s.events.filter((e) => e.type === 'session.persistence').at(-1);
  assert.ok(persisted?.type === 'session.persistence');
  await s.connection.send({ type: 'session.close', sessionId: 'session', requestId: 'close' });
  const count = s.calls.length;
  const settings = {
    planner: s.workflow().config.roles.planner.provider,
    builder: s.workflow().config.roles.builder.provider,
    reviewer: s.workflow().config.roles.reviewer.provider,
    responseLanguage: 'host',
  };
  for (const [i, extra] of [
    { providerOptions: { customRestriction: true }, settings },
    { providerOptions: { ...settings, reviewer: 'different/model' }, settings },
    { providerOptions: settings, settings, systemPrompt: 'Keep this restriction' },
  ].entries()) {
    const before = s.events.length;
    await s.open(persisted.persistence, extra);
    assert.ok(
      s.events.slice(before).some((e) => e.type === 'request.failed'),
      'Unsupported config ' + i,
    );
    assert.equal(s.calls.length, count);
  }
  const before = s.events.length;
  await s.open(persisted.persistence, { providerOptions: settings, settings });
  assert.ok(s.events.slice(before).some((e) => e.type === 'session.ready'));
  await s.prompt('revision', { type: 'command', name: 'team-revise', arguments: 'Keep scope' });
  assert.equal(s.calls.length, count, 'Restored command acknowledgement must not send a second revision');
});

test('plan conversation needs no slash commands: Reviewer receives questions, agreement adopts only the proposal', async (t) => {
  const s = await setup(t);
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Prepare a plan' }] });
  const w = s.workflow();
  w.plan = {
    summary: 'Plan',
    tasks: ['Implement'],
    acceptance: ['Works'],
    tests: [{ command: 'npm test', timeoutMs: 10000 }],
  };
  for (const [i, text] of [
    'Ajoute des tests pour les erreurs',
    'Pourquoi cette approche ?',
    'Could you simplify the plan?',
  ].entries()) {
    await s.prompt('discussion-' + i, { type: 'message', content: [{ type: 'text', text }] });
    assert.equal((s.calls.at(-1)?.value as { purpose: string }).purpose, 'plan_revision');
    assert.equal((s.calls.at(-1)?.value as { message: string }).message, text);
  }
  w.planProposal = {
    summary: 'Candidate',
    plan: w.plan,
    baseVersion: 1,
    operationId: 'r1',
    agentId: 'reviewer',
    selection: w.config.roles.reviewer,
    at: 'now',
  };
  for (const [i, text] of [
    'oui',
    'ça me va',
    'cette version me convient',
    'adopt this plan',
    'sounds good',
  ].entries()) {
    await s.prompt('adopt-' + i, { type: 'message', content: [{ type: 'text', text }] });
    assert.equal((s.calls.at(-1)?.value as { action: string }).action, 'adopt_plan');
  }
  await s.prompt('conditional', { type: 'message', content: [{ type: 'text', text: 'oui mais ajoute des tests' }] });
  assert.equal((s.calls.at(-1)?.value as { purpose: string }).purpose, 'plan_revision');
  delete w.planProposal;
  await s.prompt('approve', { type: 'message', content: [{ type: 'text', text: 'oui' }] });
  assert.equal((s.calls.at(-1)?.value as { action: string }).action, 'approve');
  w.plan.tests = [];
  await s.prompt('short', { type: 'message', content: [{ type: 'text', text: 'oui' }] });
  assert.equal((s.calls.at(-1)?.value as { allowNoTests?: boolean }).allowNoTests, undefined);
  await s.prompt('explicit', { type: 'message', content: [{ type: 'text', text: 'j’accepte l’absence de tests' }] });
  assert.equal((s.calls.at(-1)?.value as { allowNoTests?: boolean }).allowNoTests, true);
  await s.prompt('pause', { type: 'message', content: [{ type: 'text', text: 'pause' }] });
  assert.equal((s.calls.at(-1)?.value as { action: string }).action, 'pause');
  await s.prompt('resume', { type: 'message', content: [{ type: 'text', text: 'reprends' }] });
  assert.equal((s.calls.at(-1)?.value as { action: string }).action, 'resume');
});

test('Team creation accepts explicit role models and preserves them through reopen and first mission', async (t) => {
  const codex = choices[0];
  const available = [{ ...codex, models: [...codex.models, { id: 'other', isDefault: false }] }, choices[1]];
  const s = await setup(t, 'fr', true, {
    open: async () => ({
      workspaceId: s.workflow().workspaceId,
      config: structuredClone(s.workflow().config),
      choices: available,
    }),
  });
  for (const planner of ['codex/unknown', 'agent-teams/auto']) {
    const before = s.events.length;
    await s.open(undefined, { settings: { planner }, providerOptions: { planner } });
    assert.ok(s.events.slice(before).some((event) => event.type === 'request.failed'));
  }
  const models = { planner: 'codex/other', builder: 'codex/detected/model' };
  await s.open(undefined, { settings: models, providerOptions: models });
  const opened = s.events.find((event) => event.type === 'session.opened');
  assert.ok(opened?.type === 'session.opened' && opened.persistence);
  await s.connection.send({ type: 'session.close', sessionId: 'session', requestId: 'close' });
  await s.open(opened.persistence, { settings: models, providerOptions: models });
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Prepare a plan' }] });
  assert.deepEqual(s.workflow().config.roles, {
    planner: { provider: 'codex/other', modeId: 'read-only' },
    builder: { provider: 'codex/detected/model', modeId: 'auto' },
    reviewer: { provider: 'codex/detected/model', modeId: 'read-only' },
  });
});

test('Team accepts the daemon-injected Paseo MCP endpoint and still rejects custom tools', async (t) => {
  const s = await setup(t, 'fr', true, { daemonUrl: 'ws://127.0.0.1:6918/ws' });
  const paseo = {
    type: 'http',
    url: 'http://127.0.0.1:6918/mcp/agents?callerAgentId=00000000-0000-4000-8000-000000000001',
  };
  for (const mcpServers of [
    { paseo: { ...paseo, url: paseo.url.replace('6918', '6919') } },
    { paseo: { ...paseo, url: paseo.url.replace('000001', '000002') } },
    { paseo, custom: { type: 'http', url: 'http://127.0.0.1:6918/other' } },
    { custom: paseo },
  ]) {
    const before = s.events.length;
    await s.open(undefined, { mcpServers });
    assert.ok(s.events.slice(before).some((event) => event.type === 'request.failed'));
  }
  await s.open(undefined, { mcpServers: { paseo } });
  assert.ok(s.events.some((event) => event.type === 'session.ready'));
  assert.equal(s.calls.length, 0);
});

test('a question during an active Reviewer turn gets a direct response without queuing or changing the operation', async (t) => {
  let consultations = 0;
  const s = await setup(t, 'fr', true, {
    async liveQuestion(w, question) {
      consultations++;
      assert.equal(w.operation?.id, 'review');
      assert.equal(question, 'En attendant, peux-tu décrire l’objectif ?');
      return 'La revue vérifie le traitement des erreurs.';
    },
  });
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Review a change' }] });
  const w = s.workflow();
  w.status = 'running';
  w.phase = 'reviewing';
  w.operation = { id: 'review', role: 'reviewer', phase: 'reviewing', state: 'sent', startedAt: 'now' };
  const before = structuredClone(w);
  const message = {
    type: 'message' as const,
    content: [{ type: 'text' as const, text: 'En attendant, peux-tu décrire l’objectif ?' }],
  };
  await s.prompt('question', message);
  await s.prompt('question', message);
  assert.equal(consultations, 1);
  assert.deepEqual(s.workflow(), before);
  assert.equal(s.calls.filter((entry) => entry.kind === 'action').length, 0);
  assert.equal(
    s.events.filter(
      (event) =>
        event.type === 'timeline.item' &&
        event.item.type === 'assistant_message' &&
        event.item.text === 'La revue vérifie le traitement des erreurs.',
    ).length,
    1,
  );
});

test('a reserved repository reports the blocking mission in the thread and waits for a new request', async (t) => {
  let attempts = 0;
  const s = await setup(t, 'fr', true, {
    async create() {
      attempts++;
      throw new RepositoryBusy({ id: 'blocking', workspaceId: 'owner', task: 'Revoir la PR précédente' });
    },
  });
  const request = { type: 'message' as const, content: [{ type: 'text' as const, text: 'Revoir une autre PR' }] };
  await s.open();
  await s.prompt('blocked', request);
  assert.match(JSON.stringify(s.events), /Revoir la PR précédente/);
  assert.match(JSON.stringify(s.events), /Clôture cette mission/);
  assert.ok(!s.events.some((e) => e.type === 'session.prompt_result' && e.result.type === 'failed'));
  const saved = s.events.findLast((e) => e.type === 'session.persistence');
  assert.ok(saved?.type === 'session.persistence');
  await s.connection.send({ type: 'session.close', sessionId: 'session', requestId: 'close' });
  await s.open(saved.persistence);
  await s.prompt('blocked', request);
  assert.equal(attempts, 1);
  await s.prompt('retry', request);
  assert.equal(attempts, 2);
});

test('explicit closure targets only the current mission, including while awaiting a clarification', async (t) => {
  const s = await setup(t);
  const send = (id: string, text: string) => s.prompt(id, { type: 'message', content: [{ type: 'text', text }] });
  await s.open();
  await send('empty-close', 'Clôture cette mission');
  assert.equal(s.calls.length, 0);
  await send('launch', 'Revoir cette modification');
  const w = s.workflow();
  w.clarifications = [
    {
      id: 'pending',
      at: 'now',
      answers: [],
      request: { kind: 'clarification', summary: 'Question ouverte', questions: [] },
    },
  ];
  await send('close', 'Clôture cette mission');
  assert.deepEqual(
    s.calls.filter((c) => c.kind === 'action').map((c) => (c.value as { action: string; id: string }).action),
    ['finish'],
  );
  assert.match(JSON.stringify(s.events), /Mission clôturée/);
});

test('questions at a delivery checkpoint stay conversational and never consume the pending choice', async (t) => {
  const s = await setup(t);
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Review PR 18' }] });
  const w = s.workflow();
  w.status = 'awaiting_final';
  w.phase = 'delivering';
  w.clarifications = [
    {
      id: 'delivery-question',
      purpose: 'delivery',
      at: 'now',
      answers: [],
      request: {
        kind: 'clarification',
        summary: 'Delivery',
        questions: [
          {
            id: 'delivery',
            title: 'Deliver?',
            options: [
              { id: 'main', label: 'Main', tradeoff: 'Integrate' },
              { id: 'pull_request', label: 'PR', tradeoff: 'Review' },
            ],
            recommendedOptionId: 'pull_request',
          },
        ],
      },
    },
  ];
  for (const [i, text] of [
    'tu as fais des changement ? il fallait juste faire le revue',
    'Pourquoi une livraison ?',
    'What did the Reviewer find?',
  ].entries()) {
    await s.prompt('question-' + i, { type: 'message', content: [{ type: 'text', text }] });
    const action = s.calls.at(-1)?.value as { action: string; purpose: string; message: string };
    assert.equal(action.action, 'followup');
    assert.equal(action.purpose, 'message');
    assert.equal(action.message, text);
    assert.equal(w.clarifications[0].resolvedAt, undefined);
    assert.deepEqual(w.clarifications[0].answers, []);
  }
});

test('orchestrator answers a conversational objection without punctuation while a role works', async (t) => {
  const s = await setup(t, 'fr', true, {
    async liveQuestion(_w, message) {
      assert.equal(message, 'Cette approche me semble fragile');
      return 'Le Reviewer vérifie justement ce risque sur le cas réel.';
    },
  });
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Build feature' }] });
  const w = s.workflow();
  w.status = 'running';
  w.phase = 'reviewing';
  w.operation = { id: 'r', role: 'reviewer', phase: 'reviewing', state: 'sent', startedAt: 'now' };
  const before = structuredClone(w);
  await s.prompt('objection', {
    type: 'message',
    content: [{ type: 'text', text: 'Cette approche me semble fragile' }],
  });
  assert.deepEqual(s.workflow(), before);
  assert.equal(s.calls.filter((c) => c.kind === 'action').length, 0);
  assert.ok(JSON.stringify(s.events).includes('Le Reviewer vérifie justement ce risque'));
});

test('orchestrator persists requested changes during active work before acknowledging them', async (t) => {
  const s = await setup(t, 'fr', true, {
    async liveQuestion() {
      return { text: 'Je transmets cette contrainte pour le prochain échange.', queue: true };
    },
  });
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Build feature' }] });
  const w = s.workflow();
  w.status = 'running';
  w.phase = 'building';
  w.operation = { id: 'b', role: 'builder', phase: 'building', state: 'sent', startedAt: 'now' };
  const input = {
    type: 'message' as const,
    content: [{ type: 'text' as const, text: 'Ajoute aussi le cas de saisie vide' }],
  };
  await s.prompt('amend', input);
  await s.prompt('amend', input);
  const actions = s.calls.filter((c) => c.kind === 'action');
  assert.equal(actions.length, 1);
  assert.equal((actions[0].value as { action: string; message: string }).action, 'followup');
  assert.equal((actions[0].value as { message: string }).message, 'Ajoute aussi le cas de saisie vide');
});

test('a persisted live routing decision retries after action failure without calling the orchestrator twice', async (t) => {
  let consultations = 0;
  const s = await setup(t, 'fr', true, {
    async liveQuestion() {
      consultations++;
      return { text: 'Je prends en compte cette contrainte.', queue: true };
    },
  });
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Build feature' }] });
  const w = s.workflow();
  w.status = 'running';
  w.phase = 'building';
  w.operation = { id: 'b', role: 'builder', phase: 'building', state: 'sent', startedAt: 'now' };
  const action = s.backend.action;
  let attempts = 0;
  s.backend.action = async (input) => {
    if (input.action === 'followup' && ++attempts === 1) throw Error('connection lost before acceptance');
    return action(input);
  };
  const input = { type: 'message' as const, content: [{ type: 'text' as const, text: 'Ajoute le cas vide' }] };
  await s.prompt('durable-change', input);
  const saved = s.events.findLast((e) => e.type === 'session.persistence');
  assert.ok(saved?.type === 'session.persistence');
  await s.connection.send({ type: 'session.close', sessionId: 'session', requestId: 'close' });
  await s.open(saved.persistence);
  await s.prompt('durable-change', input);
  assert.equal(consultations, 1);
  assert.equal(attempts, 2);
  assert.equal(
    s.calls.filter((c) => c.kind === 'action' && (c.value as { action: string }).action === 'followup').length,
    1,
  );
});

test('a question about an orchestrator choice does not become a free-text answer', async (t) => {
  const s = await setup(t);
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Build feature' }] });
  const w = s.workflow();
  w.status = 'attention';
  w.phase = 'validating';
  w.clarifications = [
    {
      id: 'q',
      purpose: 'coordination',
      at: 'now',
      answers: [],
      request: {
        kind: 'clarification',
        summary: 'Compatibility',
        questions: [
          {
            id: 'version',
            title: 'Which version?',
            options: [
              { id: 'v1', label: 'V1', tradeoff: 'Compatible' },
              { id: 'v2', label: 'V2', tradeoff: 'Migration' },
            ],
            recommendedOptionId: 'v1',
          },
        ],
      },
    },
  ];
  await s.prompt('explain', {
    type: 'message',
    content: [{ type: 'text', text: 'Pourquoi recommandes-tu cette option ?' }],
  });
  assert.equal((s.calls.at(-1)?.value as { action: string }).action, 'followup');
  assert.equal(w.clarifications[0].resolvedAt, undefined);
  assert.deepEqual(w.clarifications[0].answers, []);
});
