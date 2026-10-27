import type { PaseoApi } from '@getpaseo/client';
import type { z } from 'zod';
import { plannerQuestionReadRpc } from '../shared/planner-question';
import { TEAM_PROVIDER_ID } from '../shared/team-composition';
import { TeamError } from '../shared/errors';
import { repository } from './git';
import type { Store } from './store';

export async function ownedPlannerWorkflow(
  api: PaseoApi,
  store: Store,
  raw: z.infer<typeof plannerQuestionReadRpc.input>,
) {
  const input = plannerQuestionReadRpc.input.parse(raw);
  const w = await store.authorize(input.id, input.workspaceId);
  if (!Object.keys(w.requests).some((key) => key.startsWith(`create:team:${input.ownerAgentId}:`)))
    throw new TeamError('WORKSPACE_ACCESS_DENIED', 'Workflow does not belong to this Team conversation');
  const owner = (await api.agents.ref(input.ownerAgentId).refresh())?.agent;
  const workspace = await api.workspaces.ref(input.workspaceId).refresh();
  if (
    owner?.provider !== TEAM_PROVIDER_ID ||
    owner.workspaceId !== input.workspaceId ||
    owner.cwd !== w.cwd ||
    workspace?.workspaceDirectory !== w.cwd
  )
    throw new TeamError('WORKSPACE_ACCESS_DENIED', 'Native Team owner unavailable');
  if ((await repository(w.cwd)).lock !== w.repo)
    throw new TeamError('REPOSITORY_CHANGED', 'Workspace no longer matches the reserved repository');
  return w;
}
