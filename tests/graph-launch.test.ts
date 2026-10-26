import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PaseoApi } from '@getpaseo/client';
import { admitSavedGraph } from '../server/graph-admission';
import { Store } from '../server/store';
import { DefinitionCatalog } from '../server/definition-catalog';
import { git } from '../server/git';
import { codeReviewPreset } from '../shared/workflow-definition';
import { graphAdmitRpc } from '../shared/graph-actions';

async function setup(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), 'teams-graph-launch-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cwd = join(directory, 'repo');
  await mkdir(cwd);
  await git(cwd, ['init', '-q']);
  const data = join(directory, 'state');
  const store = new Store(data),
    catalog = new DefinitionCatalog(join(data, 'definitions'));
  const selection = { provider: 'codex/detected-model', modeId: 'read-only' };
  const definition = codeReviewPreset({ code: selection, review: selection }, 1);
  definition.steps[0].tests = [{ command: 'test -f README.md', timeoutMs: 1000 }];
  const source = await catalog.save({ workspaceId: 'workspace', expectedRevision: 0, definition });
  let workspace: { workspaceDirectory: string } | null = { workspaceDirectory: cwd };
  let owner: { workspaceId: string; provider: string; cwd: string } | null = {
    workspaceId: 'workspace',
    provider: 'agent-teams',
    cwd,
  };
  // Deliberately no create/send/test APIs: any dispatch would fail this harness.
  const api = {
    workspaces: { ref: () => ({ refresh: async () => workspace }) },
    agents: { ref: () => ({ refresh: async () => (owner ? { agent: owner } : null) }) },
  } as unknown as PaseoApi;
  const input = {
    id: randomUUID(),
    workspaceId: 'workspace',
    ownerAgentId: 'team-owner',
    definitionId: source.id,
    definitionRevision: 1,
    task: 'Approved task',
    approveDefinition: true as const,
  };
  const admit = (overrides = {}, target = store) => admitSavedGraph(api, target, catalog, { ...input, ...overrides });
  return {
    data,
    store,
    catalog,
    definition,
    source,
    input,
    admit,
    cwd,
    setWorkspace: (value: typeof workspace) => {
      workspace = value;
    },
    setOwner: (value: typeof owner) => {
      owner = value;
    },
  };
}

test('saved graph admission freezes the explicitly approved revision and replays after reload and progress', async (t) => {
  const { store, catalog, source, input, admit, data } = await setup(t);
  const newer = structuredClone(source.definition);
  newer.steps[0].tests![0].command = 'exit 99';
  await catalog.save({ id: source.id, workspaceId: input.workspaceId, expectedRevision: 1, definition: newer });
  const graph = await admit();
  assert.deepEqual(graph.source, source);
  assert.deepEqual(graph.admission, { ownerAgentId: input.ownerAgentId, approvedDefinition: true });
  assert.equal(graph.status, 'ready');
  assert.deepEqual(graph.activations, []);
  assert.deepEqual(await admit({}, new Store(data)), graph);
  const progressed = await store.graphs.reserve(graph.id, input.workspaceId, 1, randomUUID());
  assert.deepEqual(await admit({}, new Store(data)), progressed);
  for (const override of [{ task: 'Changed task' }, { ownerAgentId: 'other-team' }, { definitionRevision: 2 }])
    await assert.rejects(admit(override), /used differently/);
  await assert.rejects(admit({ id: randomUUID() }), /Another graph/);
  assert.deepEqual(await new Store(data).graphs.get(graph.id, input.workspaceId), progressed);
});

test('admission requires explicit confirmation, exact saved scope and a native Team owner', async (t) => {
  const { admit, input, setOwner, setWorkspace, cwd, store } = await setup(t);
  for (const override of [
    { approveDefinition: false },
    { approveDefinition: undefined },
    { definition: {} },
    { definitionRevision: 0 },
  ])
    assert.equal(graphAdmitRpc.input.safeParse({ ...input, ...override }).success, false);
  await assert.rejects(admit({ definitionRevision: 2 }), /revision not found/);
  for (const owner of [
    null,
    { workspaceId: 'foreign', provider: 'agent-teams', cwd },
    { workspaceId: 'workspace', provider: 'codex', cwd },
    { workspaceId: 'workspace', provider: 'agent-teams', cwd: '/elsewhere' },
  ]) {
    setOwner(owner);
    await assert.rejects(admit(), /owner unavailable/);
  }
  setOwner({ workspaceId: 'foreign', provider: 'agent-teams', cwd });
  await assert.rejects(admit({ workspaceId: 'foreign' }), /access denied/);
  setWorkspace(null);
  await assert.rejects(admit(), /directory is missing/);
  assert.deepEqual(await store.graphs.all(), []);
});

test('concurrent identical admissions publish once; moved workspace cannot replay an approval', async (t) => {
  const { admit, input, store, cwd, setWorkspace, setOwner, data } = await setup(t);
  const [a, b] = await Promise.all([admit(), admit()]);
  assert.deepEqual(a, b);
  assert.equal((await store.graphs.all()).length, 1);
  const other = join(cwd, 'other');
  await mkdir(other);
  await git(other, ['init', '-q']);
  setWorkspace({ workspaceDirectory: other });
  setOwner({ workspaceId: input.workspaceId, provider: 'agent-teams', cwd: other });
  await assert.rejects(admit({}, new Store(data)), /used differently/);
  assert.deepEqual(await store.graphs.get(a.id, input.workspaceId), a);
});
