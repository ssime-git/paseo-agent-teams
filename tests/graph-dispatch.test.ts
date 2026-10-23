import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PaseoApi } from '@getpaseo/client';
import { DefinitionCatalog } from '../server/definition-catalog';
import { GraphCheckpoints } from '../server/graph-checkpoints';
import { codeReviewPreset } from '../shared/workflow-definition';
import { graphCheckpointSchema } from '../shared/graph-checkpoint';
import { sendGraphDispatch } from '../server/graph-dispatch';

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), 'teams-send-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = await new DefinitionCatalog(join(directory, 'definitions')).save({
    workspaceId: 'owner',
    expectedRevision: 0,
    definition: codeReviewPreset({
      code: { provider: 'codex/model', modeId: 'auto' },
      review: { provider: 'codex/model', modeId: 'read-only' },
    }),
  });
  const store = new GraphCheckpoints(join(directory, 'graphs'));
  const state = await store.create({ id: randomUUID(), repo: directory, task: 'task', source });
  const operationId = randomUUID();
  await store.reserve(state.id, 'owner', 1, operationId);
  const prompt = `[agent-teams-operation:${operationId}] exact prompt`;
  await store.bindDispatch(state.id, 'owner', 2, operationId, { agentId: randomUUID(), prompt });
  const input = { id: state.id, workspaceId: 'owner', expectedRevision: 3, operationId };
  let sends = 0;
  let lost = false;
  const entries: unknown[] = [];
  const handle = {
    status: 'idle',
    activeTurn: null,
    pendingPermissions: [],
    refresh: async () => ({}),
    timeline: { refetch: async () => ({ entries, endCursor: { epoch: 'e', seq: 1 } }) },
    send: async (text: string, options: unknown) => {
      sends++;
      const saved = JSON.parse(await readFile(join(store.directory, state.id, '4.json'), 'utf8'));
      assert.ok(saved.activations[0].dispatch.attemptId);
      assert.equal(text, prompt);
      assert.deepEqual(options, { messageId: operationId, activeTurnBehavior: 'steer' });
      entries.push({ item: { type: 'user_message', text } });
      if (lost) throw new Error('lost response');
    },
  };
  const api = { agents: { ref: () => handle } } as unknown as PaseoApi;
  return {
    store,
    input,
    api,
    handle,
    entries,
    sends: () => sends,
    lose: () => {
      lost = true;
    },
  };
}

test('native initial send publishes its attempt before I/O and only observes on stale reload', async (t) => {
  const h = await setup(t);
  const sent = await sendGraphDispatch(h.api, h.store, h.input);
  assert.equal(sent.status, 'sent');
  const retry = await sendGraphDispatch(h.api, new GraphCheckpoints(h.store.directory), h.input);
  assert.equal(retry.status, 'existing');
  if (retry.status === 'existing') assert.equal(retry.observation.status, 'accepted');
  assert.equal(h.sends(), 1);
  assert.deepEqual(retry.state, sent.state);
  assert.equal(retry.state.status, 'running');
  assert.equal(retry.state.activations[0].result, undefined);
});

test('independent checkpoint writers cannot both claim a native initial send', async (t) => {
  const h = await setup(t);
  const results = await Promise.allSettled([
    sendGraphDispatch(h.api, h.store, h.input),
    sendGraphDispatch(h.api, new GraphCheckpoints(h.store.directory), h.input),
  ]);
  assert.equal(h.sends(), 1);
  assert.ok(results.some((r) => r.status === 'fulfilled' && r.value.status === 'sent'));
  for (const r of results) if (r.status === 'rejected') assert.match(String(r.reason), /changed|already attempted/);
});

test('lost send response and crash before send retain their attempts without replay', async (t) => {
  const h = await setup(t);
  h.lose();
  assert.equal((await sendGraphDispatch(h.api, h.store, h.input)).status, 'uncertain');
  assert.equal((await sendGraphDispatch(h.api, h.store, h.input)).status, 'existing');
  assert.equal(h.sends(), 1);
  const crashed = await setup(t);
  await crashed.store.claimDispatch(crashed.input.id, 'owner', 3, crashed.input.operationId, randomUUID());
  const retry = await sendGraphDispatch(crashed.api, new GraphCheckpoints(crashed.store.directory), crashed.input);
  assert.equal(retry.status, 'existing');
  if (retry.status === 'existing') assert.equal(retry.observation.status, 'uncertain');
  assert.equal(crashed.sends(), 0);
});

test('initial send rejects foreign histories, busy sessions, wrong scope and stale revisions', async (t) => {
  for (const kind of ['foreign', 'running', 'permission', 'missing', 'incomplete', 'error']) {
    const h = await setup(t);
    if (kind === 'foreign') h.entries.push({ item: { type: 'user_message', text: 'foreign' } });
    if (kind === 'running') h.handle.status = 'running';
    if (kind === 'permission') Object.assign(h.handle, { pendingPermissions: [{}] });
    if (kind === 'missing')
      h.handle.refresh = async () => {
        throw new Error('missing');
      };
    if (kind === 'error')
      Object.assign(h.handle.timeline, { refetch: async () => ({ entries: [], error: 'native failed' }) });
    if (kind === 'incomplete') Object.assign(h.handle.timeline, { refetch: async () => ({ entries: [], gap: true }) });
    assert.equal((await sendGraphDispatch(h.api, h.store, h.input)).status, 'uncertain');
    assert.equal(h.sends(), 0);
    const saved = await h.store.get(h.input.id, 'owner');
    assert.ok(saved.activations[0].dispatch?.attemptId);
    assert.equal(saved.status, 'running');
  }
  const h = await setup(t);
  await assert.rejects(sendGraphDispatch(h.api, h.store, { ...h.input, workspaceId: 'other' }), /Workspace access/);
  await assert.rejects(sendGraphDispatch(h.api, h.store, { ...h.input, expectedRevision: 2 }), /changed/);
  assert.equal(h.sends(), 0);
  const before = await h.store.get(h.input.id, 'owner');
  assert.equal(graphCheckpointSchema.parse(before).revision, 3);
  const corrupt = structuredClone(before);
  corrupt.activations[0].dispatch!.attemptId = randomUUID();
  assert.equal(graphCheckpointSchema.safeParse(corrupt).success, false);
});

test('expired preflight cannot send later when its native read finally resolves', async (t) => {
  const h = await setup(t);
  let release!: (value: object) => void;
  let entered!: () => void;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  h.handle.refresh = () => {
    entered();
    return new Promise<object>((resolve) => {
      release = resolve;
    });
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = sendGraphDispatch(h.api, h.store, h.input);
  await reached;
  t.mock.timers.tick(20_000);
  const result = await pending;
  assert.equal(result.status, 'uncertain');
  release({});
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(h.sends(), 0);
  assert.ok((await h.store.get(h.input.id, 'owner')).activations[0].dispatch?.attemptId);
});

test('official fresh empty window permits initial send despite hasOlder, ambiguous windows do not', async (t) => {
  for (const nextSeq of [1, 2]) {
    const h = await setup(t);
    Object.assign(h.handle.timeline, {
      refetch: async () => ({
        entries: [],
        hasOlder: true,
        startCursor: null,
        endCursor: null,
        window: { minSeq: 0, maxSeq: 0, nextSeq },
      }),
    });
    assert.equal((await sendGraphDispatch(h.api, h.store, h.input)).status, nextSeq === 1 ? 'sent' : 'uncertain');
    assert.equal(h.sends(), nextSeq === 1 ? 1 : 0);
  }
});
