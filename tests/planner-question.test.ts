import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PaseoApi } from '@getpaseo/client';
import { ownedPlannerWorkflow } from '../server/planner-question';
import { plannerQuestionReadRpc, plannerQuestionAnswerRpc } from '../shared/planner-question';
import { Store } from '../server/store';
import { workflowFixture } from './fixtures';
import { git, repository } from '../server/git';

test('Planner card reads require the native owner, workspace and canonical repository without changing V1 state', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'teams-planner-card-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cwd = join(directory, 'repo');
  await mkdir(cwd);
  await git(cwd, ['init', '-q']);
  const store = new Store(join(directory, 'state'));
  const w = workflowFixture();
  w.cwd = cwd;
  w.repo = (await repository(cwd)).lock;
  w.requests = { 'create:team:owner-agent:mission': 'saved' };
  await store.put(w);
  let owner: { provider: string; workspaceId: string; cwd: string } | null = {
    provider: 'agent-teams',
    workspaceId: w.workspaceId,
    cwd,
  };
  let workspace = { workspaceDirectory: cwd };
  const api = {
    agents: { ref: (id: string) => ({ refresh: async () => ({ agent: id === 'owner-agent' ? owner : null }) }) },
    workspaces: { ref: (id: string) => ({ refresh: async () => (id === w.workspaceId ? workspace : null) }) },
  } as unknown as PaseoApi;
  const input = { id: w.id, workspaceId: w.workspaceId, ownerAgentId: 'owner-agent' };
  assert.deepEqual(await ownedPlannerWorkflow(api, store, input), w);
  await assert.rejects(ownedPlannerWorkflow(api, store, { ...input, ownerAgentId: 'other' }), /does not belong/);
  await assert.rejects(ownedPlannerWorkflow(api, store, { ...input, workspaceId: 'foreign' }));
  for (const value of [null, { ...owner!, provider: 'codex' }, { ...owner!, cwd: '/elsewhere' }]) {
    owner = value;
    await assert.rejects(ownedPlannerWorkflow(api, store, input), /owner unavailable/);
  }
  owner = { provider: 'agent-teams', workspaceId: w.workspaceId, cwd };
  workspace = { workspaceDirectory: '/elsewhere' };
  await assert.rejects(ownedPlannerWorkflow(api, store, input), /owner unavailable/);
  assert.deepEqual(await new Store(store.directory).get(w.id), w);
  assert.equal(plannerQuestionReadRpc.input.safeParse({ ...input, extra: true }).success, false);
  const answer = {
    ...input,
    expectedRevision: 0,
    clarificationId: 'pending',
    answer: { questionId: 'scope', text: 'Only docs' },
  };
  assert.equal(plannerQuestionAnswerRpc.input.safeParse(answer).success, true);
  assert.equal(plannerQuestionAnswerRpc.input.safeParse({ ...answer, answer: { questionId: 'scope' } }).success, false);
  assert.equal(plannerQuestionAnswerRpc.input.safeParse({ ...answer, expectedRevision: -1 }).success, false);
});
