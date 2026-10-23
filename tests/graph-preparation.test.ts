import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PaseoApi } from '@getpaseo/client';
import { git, repository } from '../server/git';
import { DefinitionCatalog } from '../server/definition-catalog';
import { GraphCheckpoints } from '../server/graph-checkpoints';
import { codeReviewPreset } from '../shared/workflow-definition';
import { graphDispatchPrompt, prepareGraphDispatch } from '../server/graph-preparation';

async function setup(
  t: { after: (fn: () => Promise<void>) => void },
  modeId = 'auto',
  access: 'write' | 'read-only' = 'write',
  provider = 'codex/model',
) {
  const directory = await mkdtemp(join(tmpdir(), 'teams-graph-prepare-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await git(directory, ['init', '-q']);
  const definition = codeReviewPreset({
    code: { provider, modeId },
    review: { provider: 'codex/model', modeId: 'read-only' },
  });
  definition.steps[0].access = access;
  const source = await new DefinitionCatalog(join(directory, 'definitions')).save({
    workspaceId: 'owner',
    expectedRevision: 0,
    definition,
  });
  const store = new GraphCheckpoints(join(directory, 'graphs'));
  const graph = await store.create({
    id: randomUUID(),
    repo: (await repository(directory)).lock,
    task: 'Preserve this task',
    source,
  });
  const operationId = randomUUID();
  const state = await store.reserve(graph.id, 'owner', 1, operationId);
  const input = { id: graph.id, workspaceId: 'owner', expectedRevision: state.revision, operationId };
  const creates: Record<string, unknown>[] = [];
  const agentId = randomUUID();
  const api = {
    config: { get: async () => ({ config: { providers: {} } }) },
    providers: {
      waitForReady: async () => ({
        entries: [
          { provider: 'codex', status: 'ready', models: [{ id: 'model' }] },
          { provider: 'claude', status: 'ready', models: [{ id: 'model' }] },
        ],
      }),
      listModes: async () => ({ modes: [{ id: 'auto' }, { id: 'plan' }] }),
    },
    workspaces: {
      ref: () => ({
        refresh: async () => ({ workspaceDirectory: directory }),
        agents: {
          create: async (request: Record<string, unknown>) => {
            creates.push(request);
            return { id: agentId };
          },
        },
      }),
    },
    agents: {
      ref: () => ({
        refresh: async () => {
          throw new Error('no rollout found');
        },
      }),
    },
  } as unknown as PaseoApi;
  return { directory, store, state, input, api, creates, agentId };
}

test('graph preparation binds a native session before any dispatch and observes on stale retry after reload', async (t) => {
  const h = await setup(t);
  const result = await prepareGraphDispatch(h.api, h.store, h.input);
  assert.equal(result.status, 'prepared');
  assert.equal(h.creates.length, 1);
  assert.equal(h.creates[0].idempotencyKey, `graph-${h.state.id}-${h.input.operationId}`);
  assert.equal(result.state.activations[0].dispatch?.agentId, h.agentId);
  assert.match(result.state.activations[0].dispatch!.prompt, /Preserve this task/);
  const retry = await prepareGraphDispatch(h.api, new GraphCheckpoints(h.store.directory), h.input);
  assert.equal(retry.status, 'existing');
  if (retry.status === 'existing')
    assert.deepEqual(retry.observation, {
      status: 'uncertain',
      reason: 'Native inspection failed; dispatch retained: Error: no rollout found',
    });
  assert.deepEqual(retry.state, result.state);
  assert.equal(h.creates.length, 1);
});

test('graph preparation enforces discovered models, modes, scope, revision and owner before creation', async (t) => {
  for (const [provider, modeId, pattern] of [
    ['codex/missing', 'auto', /Unavailable provider/],
    ['codex/model', 'missing', /Unavailable mode/],
    ['agent-teams/auto', 'auto', /cannot invoke Team Auto/],
  ] as const) {
    const h = await setup(t, modeId, 'write', provider);
    await assert.rejects(prepareGraphDispatch(h.api, h.store, h.input), pattern);
    assert.equal(h.creates.length, 0);
    assert.deepEqual(await h.store.get(h.state.id, 'owner'), h.state);
  }
  const h = await setup(t);
  await assert.rejects(prepareGraphDispatch(h.api, h.store, { ...h.input, workspaceId: 'other' }), /Workspace access/);
  await assert.rejects(prepareGraphDispatch(h.api, h.store, { ...h.input, expectedRevision: 1 }), /changed/);
  await git(h.directory, ['init', '-q', join(h.directory, 'other')]);
  h.api.workspaces.ref = (() => ({
    refresh: async () => ({ workspaceDirectory: join(h.directory, 'other') }),
  })) as unknown as typeof h.api.workspaces.ref;
  await assert.rejects(prepareGraphDispatch(h.api, h.store, h.input), /reserved repository/);
  assert.equal(h.creates.length, 0);
});

test('graph analysis uses verified Codex and Claude permissions without auto-accept or instruction-only fallback', async (t) => {
  for (const provider of ['codex/model', 'claude/model']) {
    const h = await setup(t, provider.startsWith('codex') ? 'read-only' : 'plan', 'read-only', provider);
    await prepareGraphDispatch(h.api, h.store, h.input);
    const config = h.creates[0].config as Record<string, unknown>;
    assert.deepEqual(
      config.options,
      provider.startsWith('codex')
        ? { sandbox_mode: 'read-only', approval_policy: 'never' }
        : { disallowedTools: ['ExitPlanMode', 'EnterPlanMode', 'Edit', 'Write', 'NotebookEdit'] },
    );
    assert.equal(config.featureValues, undefined);
  }
  const h = await setup(t, 'auto', 'read-only');
  await assert.rejects(prepareGraphDispatch(h.api, h.store, h.input), /verified native read-only/);
  assert.equal(h.creates.length, 0);
});

test('graph handoff retains structured artifacts and refuses oversized context before creating a session', async (t) => {
  const h = await setup(t);
  const build = { summary: 'Built', changes: ['exact change'], remaining: [] };
  const completed = await h.store.resolveArtifact(
    h.state.id,
    'owner',
    h.state.revision,
    h.input.operationId,
    JSON.stringify(build),
  );
  const nextId = randomUUID();
  const next = await h.store.reserve(completed.id, 'owner', completed.revision, nextId);
  const prompt = graphDispatchPrompt(next, nextId);
  assert.match(prompt, /exact change/);
  assert.match(prompt, /"verdict"/);
  assert.match(prompt, /"revision":1/);
  assert.throws(() => graphDispatchPrompt(next, h.input.operationId), /pending activation/);
  const large = await setup(t);
  large.state.task = 'x'.repeat(256 * 1024);
  // Persist a valid large checkpoint to exercise the check before session creation.
  const graph = await large.store.create({
    id: randomUUID(),
    repo: large.state.repo,
    task: large.state.task,
    source: large.state.source,
  });
  const reserved = await large.store.reserve(graph.id, 'owner', 1, large.input.operationId);
  await assert.rejects(
    prepareGraphDispatch(large.api, large.store, { ...large.input, id: graph.id, expectedRevision: reserved.revision }),
    /exceeds 256 KiB/,
  );
  assert.equal(large.creates.length, 0);
});

test('lost native creation response and concurrent preparations reuse the same operation key', async (t) => {
  const h = await setup(t);
  const original = h.api.workspaces.ref.bind(h.api.workspaces);
  let lost = true;
  h.api.workspaces.ref = ((workspace: string) => {
    const handle = original(workspace);
    const create = handle.agents.create.bind(handle.agents);
    handle.agents.create = async (...args: Parameters<typeof create>) => {
      const agent = await create(...args);
      if (lost) {
        lost = false;
        throw new Error('response lost');
      }
      return agent;
    };
    return handle;
  }) as typeof h.api.workspaces.ref;
  await assert.rejects(prepareGraphDispatch(h.api, h.store, h.input), /response lost/);
  assert.deepEqual(await h.store.get(h.state.id, 'owner'), h.state);
  const results = await Promise.allSettled([
    prepareGraphDispatch(h.api, h.store, h.input),
    prepareGraphDispatch(h.api, new GraphCheckpoints(h.store.directory), h.input),
  ]);
  assert.ok(results.some((result) => result.status === 'fulfilled'));
  for (const result of results)
    if (result.status === 'rejected') assert.match(String(result.reason), /checkpoint changed/);
  assert.equal(new Set(h.creates.map((request) => request.idempotencyKey)).size, 1);
  const bound = await h.store.get(h.state.id, 'owner');
  assert.equal(bound.activations.length, 1);
  assert.equal(bound.activations[0].dispatch?.agentId, h.agentId);
  assert.equal(bound.revision, 3);
});
