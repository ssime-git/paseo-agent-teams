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
async function setup(t: { after(fn: () => Promise<void>): void }) {
  let w = workflowFixture();
  w.config.roles = automaticTeam(choices);
  w.config.builderAutoAccept = false;
  w.status = 'awaiting_plan';
  const calls: { kind: string; value: unknown }[] = [];
  let created = false;
  const backend: TeamProviderBackend = {
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
    create: async (workspaceId, task, config, requestId) => {
      calls.push({ kind: 'create', value: { workspaceId, task, config, requestId } });
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
    capabilities: ['prompt.message', 'prompt.command', 'session.persistence', 'session.configure', 'timeline.plugin'],
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
  return { connection, events, calls, open, prompt, workflow: () => w, provider };
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

test('native Team projects builder and reviewer handoffs into one conversation without dispatching another request', async (t) => {
  const s = await setup(t);
  await s.open();
  await s.prompt('mission', { type: 'message', content: [{ type: 'text', text: 'Follow the team' }] });
  const w = s.workflow();
  w.status = 'running';
  w.phase = 'building';
  w.operation = { id: 'build', role: 'builder', phase: 'building', state: 'sent', startedAt: 'now' };
  w.revision++;
  await s.prompt('status', { type: 'command', name: 'team-status', arguments: '' });
  w.phase = 'reviewing';
  w.operation.role = 'reviewer';
  w.revision++;
  await s.prompt('status', { type: 'command', name: 'team-status', arguments: '' });
  const details = s.events
    .filter((e) => e.type === 'timeline.item' && e.item.type === 'plugin')
    .map((e) => JSON.stringify(e));
  assert.ok(details.some((e) => e.includes('builder · codex/detected/model a la main.')));
  assert.ok(details.some((e) => e.includes('reviewer · codex/detected/model a la main.')));
  assert.equal(s.calls.filter((c) => c.kind === 'create').length, 1);
  assert.equal(s.calls.filter((c) => c.kind === 'action').length, 0);
  w.status = 'awaiting_final';
  w.revision++;
  await s.prompt('status', { type: 'command', name: 'team-status', arguments: '' });
  assert.equal(s.events.filter((e) => e.type === 'session.prompt_result' && e.clientMessageId === 'status').length, 1);
  assert.equal(
    s.events.filter((e) => e.type === 'session.turn' && e.turnId === 'team:turn:status' && e.state === 'completed')
      .length,
    1,
  );
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
