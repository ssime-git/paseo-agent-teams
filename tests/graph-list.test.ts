import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PaseoApi } from '@getpaseo/client';
import type { PluginServerContext } from '@getpaseo/plugin/server';
import { contributeServer } from '../server/plugin';
import { listSavedGraphs } from '../server/graph-list';
import { GraphCheckpoints } from '../server/graph-checkpoints';
import { git, repository } from '../server/git';
import { graphListRpc } from '../shared/graph-actions';
import { definitionRecordSchema } from '../shared/definition-catalog';
import { codeReviewPreset } from '../shared/workflow-definition';

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), 'teams-graph-list-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cwd = join(directory, 'repo');
  await mkdir(cwd);
  await git(cwd, ['init', '-q']);
  const checkpoints = new GraphCheckpoints(join(directory, 'graphs'));
  const input = { workspaceId: 'workspace', ownerAgentId: 'team' };
  let workspace: { workspaceDirectory: string } | null = { workspaceDirectory: cwd };
  let owner: { workspaceId: string; provider: string; cwd: string } | null = {
    workspaceId: input.workspaceId,
    provider: 'agent-teams',
    cwd,
  };
  const api = {
    workspaces: { ref: (id: string) => ({ refresh: async () => (id === input.workspaceId ? workspace : null) }) },
    agents: { ref: (id: string) => ({ refresh: async () => ({ agent: id === input.ownerAgentId ? owner : null }) }) },
  } as unknown as PaseoApi;
  const source = definitionRecordSchema.parse({
    version: 1,
    id: randomUUID(),
    workspaceId: input.workspaceId,
    revision: 1,
    savedAt: new Date().toISOString(),
    definition: codeReviewPreset({
      code: { provider: 'fixture/model', modeId: 'read-only' },
      review: { provider: 'fixture/model', modeId: 'read-only' },
    }),
  });
  const create = (overrides = {}) =>
    checkpoints.create({
      id: randomUUID(),
      repo: repo.lock,
      task: 'Recover explicitly admitted graph',
      source,
      admission: { ownerAgentId: input.ownerAgentId, approvedDefinition: true },
      ...overrides,
    });
  const repo = await repository(cwd);
  return {
    directory,
    cwd,
    checkpoints,
    input,
    api,
    create,
    source,
    move: (value: typeof workspace) => {
      workspace = value;
    },
    changeOwner: (value: typeof owner) => {
      owner = value;
    },
  };
}

test('Team graph discovery returns exact owned snapshots after reconnect without dispatch or mutation', async (t) => {
  const f = await setup(t);
  assert.deepEqual(await listSavedGraphs(f.api, f.checkpoints, f.input), []);
  const ready = await f.create();
  const reserved = await f.checkpoints.reserve(ready.id, f.input.workspaceId, 1, randomUUID());
  const foreignOwner = await f.create({ admission: { ownerAgentId: 'another-team', approvedDefinition: true } });
  const legacy = await f.create({ admission: undefined });
  const foreignWorkspace = await f.create({ source: { ...f.source, workspaceId: 'elsewhere' } });
  const files = [reserved, foreignOwner, legacy, foreignWorkspace].map((s) =>
    join(f.checkpoints.directory, s.id, `${s.revision}.json`),
  );
  const before = await Promise.all(files.map((p) => readFile(p, 'utf8')));
  const old = process.env.PASEO_AGENT_TEAMS_DATA_DIR;
  process.env.PASEO_AGENT_TEAMS_DATA_DIR = f.directory;
  let handler!: (input: unknown, context: unknown) => Promise<unknown>;
  const cleanup = contributeServer({
    handle(contract: { name: string }, fn: typeof handler) {
      if (contract.name === graphListRpc.name) handler = fn;
    },
    on() {},
    before() {},
    registerProvider() {},
    registerSettings: () => ({ read: async () => ({ status: 'ready', values: {} }) }),
  } as unknown as PluginServerContext);
  try {
    assert.deepEqual(graphListRpc.output.parse(await handler(f.input, { paseo: f.api })), [reserved]);
  } finally {
    await cleanup();
    if (old === undefined) delete process.env.PASEO_AGENT_TEAMS_DATA_DIR;
    else process.env.PASEO_AGENT_TEAMS_DATA_DIR = old;
  }
  assert.deepEqual(await listSavedGraphs(f.api, new GraphCheckpoints(f.checkpoints.directory), f.input), [reserved]);
  assert.deepEqual(await Promise.all(files.map((p) => readFile(p, 'utf8'))), before);
});

test('Team graph discovery rejects unavailable owners, moved workspaces and invalid RPC input', async (t) => {
  const f = await setup(t);
  await f.create();
  for (const bad of [
    { ...f.input, ownerAgentId: 'unknown' },
    { ...f.input, workspaceId: 'foreign' },
    { ...f.input, approveDefinition: true },
    { ...f.input, ownerAgentId: '' },
  ])
    await assert.rejects(listSavedGraphs(f.api, f.checkpoints, bad));
  f.changeOwner({ workspaceId: f.input.workspaceId, provider: 'codex', cwd: f.cwd });
  await assert.rejects(listSavedGraphs(f.api, f.checkpoints, f.input), /owner unavailable/);
  f.changeOwner({ workspaceId: 'foreign', provider: 'agent-teams', cwd: f.cwd });
  await assert.rejects(listSavedGraphs(f.api, f.checkpoints, f.input), /owner unavailable/);
  const moved = join(f.directory, 'moved');
  await mkdir(moved);
  await git(moved, ['init', '-q']);
  f.move({ workspaceDirectory: moved });
  f.changeOwner({ workspaceId: f.input.workspaceId, provider: 'agent-teams', cwd: moved });
  await assert.rejects(listSavedGraphs(f.api, f.checkpoints, f.input), /no longer matches/);
  f.move(null);
  await assert.rejects(listSavedGraphs(f.api, f.checkpoints, f.input), /missing/);
});

test('Team graph discovery retains terminal history and returns stable ordering across concurrent reads', async (t) => {
  const f = await setup(t);
  const first = await f.create();
  const op = randomUUID();
  const running = await f.checkpoints.reserve(first.id, f.input.workspaceId, 1, op);
  const failed = await f.checkpoints.resolve(first.id, f.input.workspaceId, running.revision, op, {
    outcome: 'failure',
    summary: 'Stopped explicitly',
  });
  assert.equal(failed.status, 'failed');
  const ready = await f.create();
  const expected = [failed, ready].sort((a, b) => a.id.localeCompare(b.id));
  const [a, b] = await Promise.all([
    listSavedGraphs(f.api, f.checkpoints, f.input),
    listSavedGraphs(f.api, new GraphCheckpoints(f.checkpoints.directory), f.input),
  ]);
  assert.deepEqual(a, expected);
  assert.deepEqual(b, expected);
  assert.equal((await f.checkpoints.get(ready.id, f.input.workspaceId)).activations.length, 0);
});

test('Team graph discovery fails closed on corrupt durable state without deleting evidence', async (t) => {
  const f = await setup(t);
  const state = await f.create();
  const file = join(f.checkpoints.directory, state.id, '1.json');
  await writeFile(file, '{broken');
  await assert.rejects(listSavedGraphs(f.api, f.checkpoints, f.input), /Graph state may hold a repository lock/);
  assert.equal(await readFile(file, 'utf8'), '{broken');
});
