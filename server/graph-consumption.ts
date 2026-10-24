import type { PaseoApi } from '@getpaseo/client';
import { TeamError } from '../shared/errors';
import { GraphCheckpoints } from './graph-checkpoints';
import { graphFingerprint } from './graph-integrity';

// Internal single-activation boundary. This never sends, runs shell commands or
// reserves the next activation; a stale retry observes the immutable decision.
export async function consumeGraphResult(
  api: PaseoApi,
  checkpoints: GraphCheckpoints,
  input: { id: string; workspaceId: string; expectedRevision: number; operationId: string },
) {
  const state = await checkpoints.get(input.id, input.workspaceId);
  const activation = state.activations.find((a) => a.operationId === input.operationId);
  if (!activation) throw new TeamError('GRAPH_OPERATION_NOT_FOUND', 'Unknown graph operation');
  if (activation.consumption) return state;
  if (state.revision !== input.expectedRevision)
    throw new TeamError('GRAPH_CONFLICT', 'Graph checkpoint changed; reload before retrying');
  return checkpoints.consumeEvidence(
    state.id,
    input.workspaceId,
    state.revision,
    input.operationId,
    await graphFingerprint(api, state),
  );
}
