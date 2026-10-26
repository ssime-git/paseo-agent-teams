import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PaseoApi } from '@getpaseo/client';
import type { PluginServerContext } from '@getpaseo/plugin/server';
import { contributeServer } from '../server/plugin';
import { Store } from '../server/store';
import { graphDispatchPrompt } from '../server/graph-preparation';
import { DefinitionCatalog } from '../server/definition-catalog';
import { git, repository } from '../server/git';
import { graphActionRpc, graphRecordRpc } from '../shared/graph-actions';
import type { GraphCheckpoint } from '../shared/graph-checkpoint';
import { codeReviewPreset } from '../shared/workflow-definition';

async function setup(t: { after: (fn: () => Promise<void>) => void }, human: boolean | 'plan' = true) {
  const directory = await mkdtemp(join(tmpdir(), 'teams-graph-actions-'));
  const cwd = join(directory, 'repo');
  await mkdir(cwd);
  await git(cwd, ['init', '-q']);
  const data = join(directory, 'state');
  const old = process.env.PASEO_AGENT_TEAMS_DATA_DIR;
  process.env.PASEO_AGENT_TEAMS_DATA_DIR = data;
  const handlers = new Map<string, (input: unknown, context?: unknown) => Promise<GraphCheckpoint>>();
  const cleanup = contributeServer({
    handle(contract: { name: string }, handler: unknown) {
      handlers.set(contract.name, handler as (input: unknown, context?: unknown) => Promise<GraphCheckpoint>);
    },
    on() {},
    before() {},
    registerProvider() {},
    registerSettings: () => ({ read: async () => ({ status: 'ready', values: {} }) }),
  } as unknown as PluginServerContext);
  t.after(async () => {
    await cleanup();
    if (old === undefined) delete process.env.PASEO_AGENT_TEAMS_DATA_DIR;
    else process.env.PASEO_AGENT_TEAMS_DATA_DIR = old;
    await rm(directory, { recursive: true, force: true });
  });
  const definition = codeReviewPreset({
    code: { provider: 'fixture/model', modeId: 'fixture' },
    review: { provider: 'fixture/model', modeId: 'fixture' },
  });
  if (human === 'plan') {
    definition.steps[0].contract = 'plan';
    definition.steps[0].access = 'read-only';
  } else if (human) {
    definition.steps[0].contract = 'human';
    definition.steps[0].access = 'read-only';
    definition.steps[0].transitions = [
      { outcome: 'approve', target: 'review' },
      { outcome: 'reject', target: null },
    ];
  }
  const source = await new DefinitionCatalog(join(data, 'definitions')).save({
    workspaceId: 'owner',
    expectedRevision: 0,
    definition,
  });
  const store = new Store(data);
  let state = await store.createGraph({
    id: randomUUID(),
    repo: (await repository(cwd)).lock,
    task: 'Explicit input',
    source,
  });
  const op = randomUUID();
  state = await store.graphs.reserve(state.id, 'owner', state.revision, op);
  let workspace: { workspaceDirectory: string } | null = { workspaceDirectory: cwd };
  // No native session, permission or shell API: an accidental dispatch fails.
  const api = { workspaces: { ref: () => ({ refresh: async () => workspace }) } } as unknown as PaseoApi;
  const input = { id: state.id, workspaceId: 'owner', expectedRevision: state.revision, operationId: op };
  const action = (submission: unknown, overrides = {}) =>
    handlers.get(graphActionRpc.name)!(graphActionRpc.input.parse({ ...input, submission, ...overrides }), {
      paseo: api,
    });
  return {
    directory,
    store,
    state,
    op,
    api,
    input,
    action,
    handlers,
    move: (value: typeof workspace) => {
      workspace = value;
    },
  };
}

test('graph RPC human submission is scoped, explicit, replayable and does not reserve the next step', async (t) => {
  const { store, state, action, handlers, input, move } = await setup(t);
  const submission = {
    action: 'decide',
    decision: { id: randomUUID(), outcome: 'approve', summary: 'Approved scope' },
  };
  assert.deepEqual(await handlers.get(graphRecordRpc.name)!(input), state);
  await assert.rejects(handlers.get(graphRecordRpc.name)!({ ...input, workspaceId: 'foreign' }), /access denied/);
  await assert.rejects(action(submission, { workspaceId: 'foreign' }), /access denied/);
  await assert.rejects(action(submission, { expectedRevision: 1 }), /changed/);
  move(null);
  await assert.rejects(action(submission), /missing/);
  move({ workspaceDirectory: '/tmp' });
  await assert.rejects(action(submission), /not an accessible Git repository/);
  const other = join(store.directory, 'other-repo');
  await mkdir(other, { recursive: true });
  await git(other, ['init', '-q']);
  move({ workspaceDirectory: other });
  await assert.rejects(action(submission), /no longer matches/);
  assert.deepEqual(await store.graphs.get(state.id, 'owner'), state);
});

test('graph RPC persists a human decision once across restart, rejects contradictions and concurrent clients', async (t) => {
  const { store, state, action } = await setup(t);
  const submission = {
    action: 'decide',
    decision: { id: randomUUID(), outcome: 'approve', summary: 'Approved scope' },
  };
  const results = await Promise.allSettled([action(submission), action(submission)]);
  assert.ok(results.some((r) => r.status === 'fulfilled'));
  const saved = await new Store(store.directory).graphs.get(state.id, 'owner');
  assert.equal(saved.revision, state.revision + 1);
  assert.equal(saved.status, 'ready');
  assert.equal(saved.nextStepId, 'review');
  assert.equal(saved.activations.length, 1);
  assert.deepEqual(await action(submission), saved);
  await assert.rejects(
    action({ ...submission, decision: { ...submission.decision, outcome: 'reject' } }),
    /differently/,
  );
  assert.deepEqual(await new Store(store.directory).graphs.get(state.id, 'owner'), saved);
  assert.throws(() => graphActionRpc.input.parse({ ...state, submission: { action: 'decide' } }));
});

async function assessed(f: Awaited<ReturnType<typeof setup>>, text: string) {
  let state = f.state;
  const agentId = randomUUID(),
    attemptId = randomUUID();
  state = await f.store.graphs.bindDispatch(state.id, 'owner', state.revision, f.op, {
    agentId,
    prompt: graphDispatchPrompt(state, f.op),
  });
  state = await f.store.graphs.claimDispatch(
    state.id,
    'owner',
    state.revision,
    f.op,
    attemptId,
    state.source.definition.steps[0].access === 'read-only' ? 'a'.repeat(64) : undefined,
  );
  state = await f.store.graphs.receipt(state.id, 'owner', state.revision, f.op, {
    agentId,
    attemptId,
    turnId: 'fixture',
    outcome: 'completed',
    text,
  });
  if (state.source.definition.steps[0].access === 'read-only')
    state = await f.store.graphs.recordIntegrity(state.id, 'owner', state.revision, f.op, 'a'.repeat(64));
  state = await f.store.graphs.assessReceipt(state.id, 'owner', state.revision, f.op);
  return state;
}

test('graph RPC keeps partial clarification pending and accepts later free response without dispatch', async (t) => {
  const f = await setup(t, 'plan');
  const state = await assessed(
    f,
    JSON.stringify({
      kind: 'clarification',
      summary: 'Choose scope',
      questions: ['scope', 'delivery'].map((id) => ({
        id,
        title: `Choose ${id}`,
        recommendedOptionId: 'small',
        options: [
          { id: 'small', label: 'Small', tradeoff: 'Quick' },
          { id: 'large', label: 'Large', tradeoff: 'Slower' },
        ],
      })),
    }),
  );
  const first = { action: 'answer', answer: { questionId: 'scope', optionId: 'small' } };
  const partial = await f.action(first, { expectedRevision: state.revision });
  assert.equal(partial.status, 'waiting_human');
  assert.deepEqual(await f.action(first), partial);
  assert.throws(() => f.action({ action: 'answer', answer: { questionId: 'delivery' } }), /Choose an option/);
  await assert.rejects(
    f.action(
      { action: 'answer', answer: { questionId: 'delivery', optionId: 'invented' } },
      { expectedRevision: partial.revision },
    ),
    /Unknown/,
  );
  const complete = await f.action(
    { action: 'answer', answer: { questionId: 'delivery', text: 'Next week' } },
    { expectedRevision: partial.revision },
  );
  assert.equal(complete.status, 'ready');
  assert.equal(complete.activations.length, 1);
  assert.deepEqual(await new Store(f.store.directory).graphs.get(state.id, 'owner'), complete);
});

test('graph RPC accepts no tests only explicitly, with current fingerprint, and can reject instead', async (t) => {
  const f = await setup(t, false);
  const text = JSON.stringify({ summary: 'Done', changes: ['Fixture'], remaining: [] });
  const state = await assessed(f, text);
  assert.equal(state.activations[0].assessment?.status, 'valid');
  const decision = { id: randomUUID(), summary: 'Manual verification accepted for this fixture' };
  const saved = await f.action({ action: 'accept_no_tests', decision }, { expectedRevision: state.revision });
  assert.equal(saved.status, 'ready');
  assert.equal(saved.activations.length, 1);
  assert.equal(saved.activations[0].noTestsDecision?.id, decision.id);
  assert.equal(saved.activations[0].testRun, undefined);
  assert.deepEqual(await f.action({ action: 'accept_no_tests', decision }), saved);
  await assert.rejects(
    f.action({ action: 'accept_no_tests', decision: { ...decision, summary: 'Changed' } }),
    /differently/,
  );
});

test('graph RPC test rejection persists failure without approving the native result', async (t) => {
  const f = await setup(t, false);
  const state = await assessed(f, JSON.stringify({ summary: 'Done', changes: ['Fixture'], remaining: [] }));
  const submission = { action: 'reject_tests', decision: { id: randomUUID(), summary: 'Tests required' } };
  const rejected = await f.action(submission, { expectedRevision: state.revision });
  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.activations[0].testRejection?.reason, 'absent');
  assert.equal(rejected.activations[0].result?.outcome, 'failure');
  assert.deepEqual(await f.action(submission), rejected);
});
