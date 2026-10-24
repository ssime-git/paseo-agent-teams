import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PaseoApi } from '@getpaseo/client';
import { git, repository } from '../server/git';
import { DefinitionCatalog } from '../server/definition-catalog';
import { GraphCheckpoints } from '../server/graph-checkpoints';
import { codeReviewPreset } from '../shared/workflow-definition';
import { graphCheckpointSchema } from '../shared/graph-checkpoint';
import { sendGraphDispatch } from '../server/graph-dispatch';
import { graphFingerprint, verifyGraphIntegrity } from '../server/graph-integrity';

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), 'teams-integrity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = join(directory, 'repo');
  await mkdir(repo);
  await git(repo, ['init', '-q']);
  await writeFile(join(repo, 'file'), 'original');
  await git(repo, ['add', 'file']);
  await mkdir(join(repo, 'sub'));
  const definition = codeReviewPreset({
    code: { provider: 'codex/model', modeId: 'read-only' },
    review: { provider: 'codex/model', modeId: 'read-only' },
  });
  definition.steps[0].access = 'read-only';
  const source = await new DefinitionCatalog(join(directory, 'definitions')).save({
    workspaceId: 'owner',
    expectedRevision: 0,
    definition,
  });
  const store = new GraphCheckpoints(join(directory, 'graphs'));
  const state = await store.create({ id: randomUUID(), repo: (await repository(repo)).lock, task: 'Inspect', source });
  const operationId = randomUUID();
  await store.reserve(state.id, 'owner', 1, operationId);
  const agentId = randomUUID();
  await store.bindDispatch(state.id, 'owner', 2, operationId, {
    agentId,
    prompt: `[agent-teams-operation:${operationId}] inspect`,
  });
  let sends = 0;
  const api = {
    workspaces: { ref: () => ({ refresh: async () => ({ workspaceDirectory: join(repo, 'sub') }) }) },
    agents: {
      ref: () => ({
        status: 'idle',
        refresh: async () => ({}),
        timeline: { refetch: async () => ({ entries: [] }) },
        send: async () => {
          const saved = await store.get(state.id, 'owner');
          assert.equal(saved.activations[0].dispatch?.baseline, await graphFingerprint(api, saved));
          sends++;
        },
      }),
    },
  } as unknown as PaseoApi;
  const input = { id: state.id, workspaceId: 'owner', expectedRevision: 3, operationId };
  const finish = async () => {
    const saved = await store.get(state.id, 'owner');
    return store.receipt(state.id, 'owner', saved.revision, operationId, {
      agentId,
      attemptId: saved.activations[0].dispatch!.attemptId!,
      turnId: 'turn',
      outcome: 'completed',
    });
  };
  return { repo, state, store, api, input, finish, sends: () => sends };
}

test('read-only baseline precedes native send, verifies from repository root and survives restart', async (t) => {
  const h = await setup(t);
  assert.equal((await sendGraphDispatch(h.api, h.store, h.input)).status, 'sent');
  const receipt = await h.finish();
  const input = { ...h.input, expectedRevision: receipt.revision };
  const verified = await verifyGraphIntegrity(h.api, h.store, input);
  assert.equal(verified.activations[0].integrity?.unchanged, true);
  assert.equal(verified.status, 'running');
  assert.equal(verified.activations[0].result, undefined);
  const restarted = new GraphCheckpoints(h.store.directory);
  assert.deepEqual(await verifyGraphIntegrity(h.api, restarted, h.input), verified);
  await sendGraphDispatch(h.api, restarted, h.input);
  assert.equal(h.sends(), 1);
  const corrupt = structuredClone(verified);
  corrupt.activations[0].integrity!.unchanged = false;
  assert.equal(graphCheckpointSchema.safeParse(corrupt).success, false);
});

test('content, index, deletion, mode, symlink and untracked changes persist as mismatches without restoring files', async (t) => {
  for (const kind of ['content', 'index', 'delete', 'mode', 'symlink', 'untracked']) {
    const h = await setup(t);
    await sendGraphDispatch(h.api, h.store, h.input);
    if (kind === 'content') await writeFile(join(h.repo, 'file'), 'changed');
    if (kind === 'index') await git(h.repo, ['rm', '--cached', 'file']);
    if (kind === 'delete') await rm(join(h.repo, 'file'));
    if (kind === 'mode') await chmod(join(h.repo, 'file'), 0o755);
    if (kind === 'symlink') await symlink('file', join(h.repo, 'link'));
    if (kind === 'untracked') await writeFile(join(h.repo, 'new'), 'new');
    const receipt = await h.finish();
    const verified = await verifyGraphIntegrity(h.api, h.store, { ...h.input, expectedRevision: receipt.revision });
    assert.equal(verified.activations[0].integrity?.unchanged, false, kind);
    await writeFile(join(h.repo, 'file'), 'original');
    assert.deepEqual(await verifyGraphIntegrity(h.api, h.store, h.input), verified);
    assert.equal(h.sends(), 1);
  }
});

test('missing receipt or legacy baseline, wrong scope, stale revision and changed repository fail closed', async (t) => {
  const h = await setup(t);
  await assert.rejects(verifyGraphIntegrity(h.api, h.store, h.input), /baseline required/);
  await h.store.claimDispatch(h.state.id, 'owner', 3, h.input.operationId, randomUUID());
  await h.finish();
  await assert.rejects(verifyGraphIntegrity(h.api, h.store, h.input), /never reconstruct/);
  const fresh = await setup(t);
  await sendGraphDispatch(fresh.api, fresh.store, fresh.input);
  const receipt = await fresh.finish();
  await assert.rejects(verifyGraphIntegrity(fresh.api, fresh.store, fresh.input), /changed/);
  await assert.rejects(
    verifyGraphIntegrity(fresh.api, fresh.store, { ...fresh.input, workspaceId: 'foreign' }),
    /access denied/,
  );
  fresh.api.workspaces.ref = (() => ({
    refresh: async () => ({ workspaceDirectory: h.repo }),
  })) as unknown as typeof fresh.api.workspaces.ref;
  await assert.rejects(
    verifyGraphIntegrity(fresh.api, fresh.store, { ...fresh.input, expectedRevision: receipt.revision }),
    /reserved repository/,
  );
});

test('concurrent integrity writers publish one revision and permit idempotent recovery', async (t) => {
  const h = await setup(t);
  await sendGraphDispatch(h.api, h.store, h.input);
  const receipt = await h.finish();
  const input = { ...h.input, expectedRevision: receipt.revision };
  const results = await Promise.allSettled([
    verifyGraphIntegrity(h.api, h.store, input),
    verifyGraphIntegrity(h.api, new GraphCheckpoints(h.store.directory), input),
  ]);
  assert.ok(results.some((result) => result.status === 'fulfilled'));
  for (const result of results) if (result.status === 'rejected') assert.match(String(result.reason), /changed/);
  const saved = await h.store.get(h.state.id, 'owner');
  assert.equal(saved.revision, receipt.revision + 1);
  assert.deepEqual(await verifyGraphIntegrity(h.api, h.store, h.input), saved);
});

test('pre-send snapshot failure never claims or sends and ignored files stay outside the declared scope', async (t) => {
  const h = await setup(t);
  const before = await h.store.get(h.state.id, 'owner');
  await writeFile(join(h.repo, '.gitignore'), 'ignored\n');
  const fingerprint = await graphFingerprint(h.api, before);
  await writeFile(join(h.repo, 'ignored'), 'outside proof');
  assert.equal(await graphFingerprint(h.api, before), fingerprint);
  await writeFile(join(h.repo, 'too-large'), Buffer.alloc(21 * 1024 * 1024));
  await assert.rejects(sendGraphDispatch(h.api, h.store, h.input), /20 MiB/);
  assert.deepEqual(await h.store.get(h.state.id, 'owner'), before);
  assert.equal(h.sends(), 0);
});

test('HEAD changes invalidate the evidence even when the working files are identical', async (t) => {
  const h = await setup(t);
  await sendGraphDispatch(h.api, h.store, h.input);
  await git(h.repo, [
    '-c',
    'user.name=Isolated',
    '-c',
    'user.email=isolated@example.invalid',
    'commit',
    '-qm',
    'initial',
  ]);
  const receipt = await h.finish();
  const verified = await verifyGraphIntegrity(h.api, h.store, { ...h.input, expectedRevision: receipt.revision });
  assert.equal(verified.activations[0].integrity?.unchanged, false);
});
