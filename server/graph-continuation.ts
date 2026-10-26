import type { PaseoApi } from '@getpaseo/client';
import type { z } from 'zod';
import { graphAdvanceRpc } from '../shared/graph-actions';
import { TEAM_PROVIDER_ID } from '../shared/team-composition';
import { TeamError } from '../shared/errors';
import { repository } from './git';
import type { GraphCheckpoints } from './graph-checkpoints';
import { advanceGraph } from './graph-executor';

// Client RPC only, never a model tool, timer or lifecycle callback. Legacy
// internal checkpoints without explicit admission cannot acquire execution rights.
export async function continueSavedGraph(
  api: PaseoApi,
  checkpoints: GraphCheckpoints,
  raw: z.infer<typeof graphAdvanceRpc.input>,
) {
  const input = graphAdvanceRpc.input.parse(raw);
  const state = await checkpoints.get(input.id, input.workspaceId);
  if (!state.admission?.approvedDefinition || state.admission.ownerAgentId !== input.ownerAgentId)
    throw new TeamError('WORKSPACE_ACCESS_DENIED', 'Explicit Team admission required');
  const workspace = await api.workspaces.ref(input.workspaceId).refresh();
  if (!workspace?.workspaceDirectory) throw new TeamError('WORKSPACE_NOT_FOUND', 'Workspace directory is missing');
  const owner = (await api.agents.ref(input.ownerAgentId).refresh())?.agent;
  if (
    owner?.workspaceId !== input.workspaceId ||
    owner.provider !== TEAM_PROVIDER_ID ||
    owner.cwd !== workspace.workspaceDirectory
  )
    throw new TeamError('WORKSPACE_ACCESS_DENIED', 'Native Team owner unavailable');
  if ((await repository(workspace.workspaceDirectory)).lock !== state.repo)
    throw new TeamError('REPOSITORY_CHANGED', 'Workspace no longer matches the reserved repository');
  return advanceGraph(api, checkpoints, input);
}
