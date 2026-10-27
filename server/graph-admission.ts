import { createHash } from 'node:crypto';
import type { PaseoApi } from '@getpaseo/client';
import type { z } from 'zod';
import { graphAdmitRpc, graphPreviewRpc, graphConfirmRpc } from '../shared/graph-actions';
import { TEAM_PROVIDER_ID } from '../shared/team-composition';
import { TeamError } from '../shared/errors';
import { repository } from './git';
import type { DefinitionCatalog } from './definition-catalog';
import type { Store } from './store';

// Preview does not reserve a repository, create sessions or send a model turn.
export async function previewSavedGraph(
  api: PaseoApi,
  catalog: DefinitionCatalog,
  raw: z.infer<typeof graphPreviewRpc.input>,
) {
  const input = graphPreviewRpc.input.parse(raw);
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
  const preview = {
    source,
    repository: await repository(workspace.workspaceDirectory),
    task: input.task,
    ownerAgentId: input.ownerAgentId,
  };
  return { ...preview, confirmation: createHash('sha256').update(JSON.stringify(preview)).digest('hex') };
}

async function publishAdmission(store: Store, id: string, preview: z.infer<typeof graphPreviewRpc.output>) {
  return store.createGraph({
    id,
    repo: preview.repository.lock,
    task: preview.task,
    source: preview.source,
    admission: { ownerAgentId: preview.ownerAgentId, approvedDefinition: true },
  });
}

// Existing explicit RPC remains compatible with admitted/persisted clients.
export async function admitSavedGraph(
  api: PaseoApi,
  store: Store,
  catalog: DefinitionCatalog,
  raw: z.infer<typeof graphAdmitRpc.input>,
) {
  const { id, approveDefinition: _approved, ...input } = graphAdmitRpc.input.parse(raw);
  return publishAdmission(store, id, await previewSavedGraph(api, catalog, input));
}

// New launch clients must return the exact preview fingerprint and confirmation.
// Re-read live ownership/repository before comparing, then publish that same value.
export async function confirmSavedGraph(
  api: PaseoApi,
  store: Store,
  catalog: DefinitionCatalog,
  raw: z.infer<typeof graphConfirmRpc.input>,
) {
  const { id, approveDefinition: _approved, confirmation, ...input } = graphConfirmRpc.input.parse(raw);
  const preview = await previewSavedGraph(api, catalog, input);
  if (preview.confirmation !== confirmation)
    throw new TeamError('GRAPH_PREVIEW_CHANGED', 'Launch preview changed; read and confirm it again');
  return publishAdmission(store, id, preview);
}
