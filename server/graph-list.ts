import type { PaseoApi } from '@getpaseo/client';
import type { z } from 'zod';
import { graphListRpc } from '../shared/graph-actions';
import { TEAM_PROVIDER_ID } from '../shared/team-composition';
import { TeamError } from '../shared/errors';
import { repository } from './git';
import type { GraphCheckpoints } from './graph-checkpoints';

// Read only. Discovery cannot admit legacy checkpoints or continue a waiting run.
export async function listSavedGraphs(
  api: PaseoApi,
  checkpoints: GraphCheckpoints,
  raw: z.infer<typeof graphListRpc.input>,
) {
  const input = graphListRpc.input.parse(raw);
  const workspace = await api.workspaces.ref(input.workspaceId).refresh();
  if (!workspace?.workspaceDirectory) throw new TeamError('WORKSPACE_NOT_FOUND', 'Workspace directory is missing');
  const owner = (await api.agents.ref(input.ownerAgentId).refresh())?.agent;
  if (
    owner?.workspaceId !== input.workspaceId ||
    owner.provider !== TEAM_PROVIDER_ID ||
    owner.cwd !== workspace.workspaceDirectory
  )
    throw new TeamError('WORKSPACE_ACCESS_DENIED', 'Native Team owner unavailable');
  const repo = (await repository(workspace.workspaceDirectory)).lock;
  const states = (await checkpoints.all()).filter(
    (state) =>
      state.source.workspaceId === input.workspaceId &&
      state.admission?.approvedDefinition &&
      state.admission.ownerAgentId === input.ownerAgentId,
  );
  if (states.some((state) => state.repo !== repo))
    throw new TeamError('REPOSITORY_CHANGED', 'Workspace no longer matches the reserved repository');
  return states.sort((a, b) => a.id.localeCompare(b.id));
}
