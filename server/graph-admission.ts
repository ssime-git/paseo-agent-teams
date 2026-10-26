import type { PaseoApi } from '@getpaseo/client';
import type { z } from 'zod';
import { graphAdmitRpc } from '../shared/graph-actions';
import { TEAM_PROVIDER_ID } from '../shared/team-composition';
import { TeamError } from '../shared/errors';
import { repository } from './git';
import type { DefinitionCatalog } from './definition-catalog';
import type { Store } from './store';

// Authenticated client RPC only. Admission reserves the repository; it neither
// creates native sessions nor approves their permissions or sends a model turn.
export async function admitSavedGraph(
  api: PaseoApi,
  store: Store,
  catalog: DefinitionCatalog,
  raw: z.infer<typeof graphAdmitRpc.input>,
) {
  const input = graphAdmitRpc.input.parse(raw);
  const workspace = await api.workspaces.ref(input.workspaceId).refresh();
  if (!workspace?.workspaceDirectory) throw new TeamError('WORKSPACE_NOT_FOUND', 'Workspace directory is missing');
  const owner = (await api.agents.ref(input.ownerAgentId).refresh())?.agent;
  if (
    owner?.workspaceId !== input.workspaceId ||
    owner.provider !== TEAM_PROVIDER_ID ||
    owner.cwd !== workspace.workspaceDirectory
  )
    throw new TeamError('WORKSPACE_ACCESS_DENIED', 'Native Team owner unavailable');
  const history = await catalog.history(input.definitionId, input.workspaceId);
  const source = history.find((record) => record.revision === input.definitionRevision);
  if (!source) throw new TeamError('DEFINITION_NOT_FOUND', 'Saved workflow definition revision not found');
  return store.createGraph({
    id: input.id,
    repo: (await repository(workspace.workspaceDirectory)).lock,
    task: input.task,
    source,
    admission: { ownerAgentId: input.ownerAgentId, approvedDefinition: true },
  });
}
