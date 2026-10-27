import type { PaseoApi } from '@getpaseo/client';
import type { z } from 'zod';
import { graphActionRpc, graphResponseRpc } from '../shared/graph-actions';
import { TeamError } from '../shared/errors';
import { repository } from './git';
import type { GraphCheckpoints } from './graph-checkpoints';
import { listSavedGraphs } from './graph-list';
import { acceptGraphWithoutTests } from './graph-consumption';

// Called only from the authenticated plugin RPC handler, never a lifecycle hook,
// model result, recovery timer or provider prompt parser. Silence has no action.
export async function submitGraphAction(
  api: PaseoApi,
  checkpoints: GraphCheckpoints,
  raw: z.infer<typeof graphActionRpc.input>,
) {
  const input = graphActionRpc.input.parse(raw);
  const state = await checkpoints.get(input.id, input.workspaceId);
  const workspace = await api.workspaces.ref(input.workspaceId).refresh();
  if (!workspace?.workspaceDirectory) throw new TeamError('WORKSPACE_NOT_FOUND', 'Workspace directory is missing');
  if ((await repository(workspace.workspaceDirectory)).lock !== state.repo)
    throw new TeamError('REPOSITORY_CHANGED', 'Workspace no longer matches the reserved repository');
  const { id, workspaceId, expectedRevision, operationId, submission } = input;
  switch (submission.action) {
    case 'decide':
      return checkpoints.decideHuman(id, workspaceId, expectedRevision, operationId, submission.decision);
    case 'answer':
      return checkpoints.answerClarification(id, workspaceId, expectedRevision, operationId, submission.answer);
    case 'reject_tests':
      return checkpoints.rejectTests(id, workspaceId, expectedRevision, operationId, submission.decision);
    case 'accept_no_tests':
      return acceptGraphWithoutTests(api, checkpoints, input, submission.decision);
  }
}

export async function respondToOwnedGraph(
  api: PaseoApi,
  checkpoints: GraphCheckpoints,
  raw: z.infer<typeof graphResponseRpc.input>,
) {
  const { ownerAgentId, ...input } = graphResponseRpc.input.parse(raw);
  const owned = await listSavedGraphs(api, checkpoints, { workspaceId: input.workspaceId, ownerAgentId });
  if (!owned.some((state) => state.id === input.id))
    throw new TeamError('WORKSPACE_ACCESS_DENIED', 'Graph does not belong to this Team conversation');
  return submitGraphAction(api, checkpoints, input);
}
