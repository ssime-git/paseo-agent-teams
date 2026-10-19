import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginServerContext } from '@getpaseo/plugin/server';
import { contributeServer } from '../server/plugin';
import { Store } from '../server/store';
import { workflowFixture } from './fixtures';

test('plugin list is a read and history/action require workspace ownership', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'teams-plugin-'));
  const old = process.env.PASEO_AGENT_TEAMS_DATA_DIR;
  process.env.PASEO_AGENT_TEAMS_DATA_DIR = dir;
  const w = workflowFixture();
  w.config.recovery = 'automatic';
  w.events.push({ id: 'event', at: new Date().toISOString(), kind: 'created', text: 'Fixture' });
  await new Store(dir).put(w);
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const fake = {
    handle(contract: { name: string }, handler: unknown) {
      handlers.set(contract.name, handler as (input: unknown) => Promise<unknown>);
    },
    on() {},
  } as unknown as PluginServerContext;
  const cleanup = contributeServer(fake);
  t.after(async () => {
    if (typeof cleanup === 'function') await cleanup();
    if (old === undefined) delete process.env.PASEO_AGENT_TEAMS_DATA_DIR;
    else process.env.PASEO_AGENT_TEAMS_DATA_DIR = old;
    await rm(dir, { recursive: true, force: true });
  });
  const list = await handlers.get('teams.list')!({ workspaceId: 'owner' });
  assert.equal((list as unknown[]).length, 1);
  assert.equal((await new Store(dir).get(w.id)).revision, 0);
  assert.deepEqual(await handlers.get('teams.list')!({ workspaceId: 'foreign' }), []);
  await assert.rejects(handlers.get('teams.history')!({ id: w.id, workspaceId: 'foreign' }), /access denied/);
  await assert.rejects(handlers.get('teams.history')!({ id: w.id }), /access denied/);
  await assert.rejects(handlers.get('teams.action')!({ id: w.id, workspaceId: 'foreign' }), /access denied/);
  assert.deepEqual(await handlers.get('teams.history')!({ id: w.id, workspaceId: 'owner' }), w.events);
});

test('catalog reveals lock owner metadata across workspaces of the same repository while preserving action ownership', async (t) => {
  const { git, repository } = await import('../server/git');
  const { mkdir } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'teams-lock-catalog-'));
  const repo = join(dir, 'repo'),
    unrelated = join(dir, 'unrelated');
  await mkdir(repo);
  await mkdir(unrelated);
  await git(repo, ['init', '-q']);
  await git(unrelated, ['init', '-q']);
  await mkdir(join(repo, 'subdirectory'));
  const old = process.env.PASEO_AGENT_TEAMS_DATA_DIR;
  process.env.PASEO_AGENT_TEAMS_DATA_DIR = join(dir, 'state');
  const store = new Store(process.env.PASEO_AGENT_TEAMS_DATA_DIR);
  const w = workflowFixture();
  w.repo = (await repository(repo)).lock;
  w.cwd = repo;
  await store.put(w);
  type Handler = (input: { workspaceId: string }, context: unknown) => Promise<unknown>;
  const handlers = new Map<string, Handler>();
  const cleanup = contributeServer({
    handle(contract: { name: string }, handler: Handler) {
      handlers.set(contract.name, handler);
    },
    on() {},
  } as unknown as PluginServerContext);
  t.after(async () => {
    if (typeof cleanup === 'function') await cleanup();
    if (old === undefined) delete process.env.PASEO_AGENT_TEAMS_DATA_DIR;
    else process.env.PASEO_AGENT_TEAMS_DATA_DIR = old;
    await rm(dir, { recursive: true, force: true });
  });
  const catalog = handlers.get('teams.catalog')!;
  const context = (cwd: string) => ({
    paseo: {
      workspaces: { ref: () => ({ refresh: async () => ({ workspaceDirectory: cwd }) }) },
      providers: { waitForReady: async () => ({ entries: [] }) },
      config: { get: async () => ({ config: { providers: {} } }) },
    },
  });
  const result = (await catalog({ workspaceId: 'different-workspace' }, context(join(repo, 'subdirectory')))) as {
    blockingWorkflow: unknown;
  };
  assert.deepEqual(result.blockingWorkflow, { id: w.id, workspaceId: 'owner', task: w.task, status: 'awaiting_plan' });
  assert.equal(
    'blockingWorkflow' in ((await catalog({ workspaceId: 'unrelated' }, context(unrelated))) as object),
    false,
  );
  // Visibility of lock metadata does not grant cross-workspace mutation access.
  const action = handlers.get('teams.action') as unknown as (input: unknown) => Promise<unknown>;
  await assert.rejects(action({ id: w.id, workspaceId: 'different-workspace' }), /access denied/);
});
