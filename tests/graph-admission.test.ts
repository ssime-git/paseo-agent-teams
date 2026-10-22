import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store';
import { DefinitionCatalog } from '../server/definition-catalog';
import { codeReviewPreset } from '../shared/workflow-definition';
import { workflowFixture } from './fixtures';
import { Engine, type Runtime } from '../server/engine';

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), 'teams-graph-admission-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  const selection = { provider: 'fixture/model', modeId: 'fixture' };
  const source = await new DefinitionCatalog(join(directory, 'definitions')).save({
    workspaceId: 'owner',
    expectedRevision: 0,
    definition: codeReviewPreset({ code: selection, review: selection }, 0),
  });
  const input = () => ({ id: randomUUID(), repo: '/repo/.git', task: 'Admission', source });
  return { directory, store, input };
}

test('graph admission excludes V1 target locks and leaves V1 bytes and pending operations unchanged', async (t) => {
  const { directory, store, input } = await setup(t);
  const legacy = workflowFixture();
  legacy.repositoryTargets = [{ root: '/repo', lock: '/repo/.git' }];
  legacy.operation = { id: 'pending', role: 'planner', phase: 'planning', state: 'sent', startedAt: 'before' };
  await store.put(legacy);
  const file = join(directory, `${legacy.id}.json`),
    before = await readFile(file, 'utf8');
  await assert.rejects(store.createGraph(input()), /Another workflow/);
  assert.equal(await readFile(file, 'utf8'), before);
  await store.createGraph({ ...input(), repo: '/independent/.git' });
  legacy.status = 'completed';
  delete legacy.operation;
  await store.put(legacy);
  const graph = await store.createGraph(input());
  await assert.rejects(new Store(directory).assertCanCreate('/repo/.git'), /Another graph/);
  await store.graphs.reserve(graph.id, 'owner', 1, randomUUID());
  await assert.rejects(store.assertCanCreate('/repo/.git'), /Another graph/);
  await store.assertCanCreate('/other/.git');
});

test('V1 creation and graph admission share one critical section through snapshot persistence', async (t) => {
  const { store, input } = await setup(t);
  let entered!: () => void, release!: () => void;
  const preparing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = workflowFixture();
  let turns = 0;
  const runtime = {
    async prepare() {
      entered();
      await gate;
      return { cwd: '/repo', repo: '/repo/.git', baseline: '/unused-admission-baseline' };
    },
    async publish() {},
    async agent() {
      turns++;
      return 'unexpected';
    },
  } as unknown as Runtime;
  const engine = new Engine(store, runtime);
  t.after(async () => {
    engine.close();
    await engine.settle();
  });
  const creating = engine.create('owner', 'V1', { ...fixture.config, mode: 'manual' }, 'create');
  await preparing;
  const graph = store.createGraph(input());
  release();
  await creating;
  await assert.rejects(graph, /Another workflow/);
  await engine.settle();
  assert.equal(turns, 0);
  assert.equal((await store.graphs.all()).length, 0);
});

test('graph first blocks V1 creation and completed follow-up before native dispatch', async (t) => {
  const { store, input } = await setup(t);
  const fixture = workflowFixture();
  fixture.repo = '/repo/.git';
  fixture.status = 'completed';
  await store.put(fixture);
  const graph = await store.createGraph(input());
  let turns = 0;
  const runtime = {
    async prepare() {
      return { cwd: '/repo', repo: '/repo/.git', baseline: '/unused-admission-baseline' };
    },
    async agent() {
      turns++;
      return 'unexpected';
    },
  } as unknown as Runtime;
  const engine = new Engine(store, runtime);
  t.after(async () => {
    engine.close();
    await engine.settle();
  });
  await assert.rejects(engine.create('owner', 'V1', fixture.config, 'new'), /Another graph/);
  await assert.rejects(
    engine.action({
      id: fixture.id,
      expectedRevision: 0,
      requestId: 'followup',
      action: 'followup',
      message: 'Continue',
    }),
    /Another graph/,
  );
  assert.equal(turns, 0);
  const op = randomUUID();
  await store.graphs.reserve(graph.id, 'owner', 1, op);
  await store.graphs.resolve(graph.id, 'owner', 2, op, { outcome: 'failure', summary: 'Stopped' });
  await new Store(store.directory).assertCanCreate('/repo/.git');
});

test('graph competitors serialize; corrupt graph evidence blocks admission without deleting files', async (t) => {
  const { directory, store, input } = await setup(t);
  const results = await Promise.allSettled([store.createGraph(input()), store.createGraph(input())]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const graph = (await store.graphs.all())[0];
  const file = join(directory, 'graphs', graph.id, '1.json');
  await writeFile(file, '{broken');
  for (const instance of [store, new Store(directory)]) {
    await assert.rejects(instance.assertCanCreate('/other/.git'), /Graph state may hold a repository lock/);
    await assert.rejects(instance.createGraph(input()), /Graph state may hold a repository lock/);
  }
  assert.equal(await readFile(file, 'utf8'), '{broken');
  assert.deepEqual(await store.all(), []);
});

test('unanswered human graph retains repository reservation after reload without inferred approval', async (t) => {
  const { directory, store, input } = await setup(t);
  const draft = input();
  draft.source.definition.steps[1].contract = 'human';
  draft.source.definition.steps[1].transitions = [
    { outcome: 'approve', target: null },
    { outcome: 'reject', target: 'code' },
  ];
  const graph = await store.createGraph(draft);
  const build = randomUUID(),
    human = randomUUID();
  await store.graphs.reserve(graph.id, 'owner', 1, build);
  await store.graphs.resolve(graph.id, 'owner', 2, build, { outcome: 'success', summary: 'Built' });
  const waiting = await store.graphs.reserve(graph.id, 'owner', 3, human);
  const restarted = new Store(directory);
  await assert.rejects(restarted.assertCanCreate(graph.repo), /Another graph/);
  assert.deepEqual(await restarted.graphs.get(graph.id, 'owner'), waiting);
  await restarted.graphs.resolve(graph.id, 'owner', 4, human, { outcome: 'reject', summary: 'Explicit refusal' });
  assert.equal((await restarted.graphs.get(graph.id, 'owner')).status, 'exhausted');
  await restarted.assertCanCreate(graph.repo);
});
