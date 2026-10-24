import { createHash } from 'node:crypto';
import type { PaseoApi } from '@getpaseo/client';
import type { GraphCheckpoint } from '../shared/graph-checkpoint';
import { TeamError } from '../shared/errors';
import { repository, snapshot } from './git';
import { GraphCheckpoints } from './graph-checkpoints';

// Same bounded working set as V1: HEAD, index, tracked and non-ignored
// untracked files, symlink targets and modes. Ignored files are outside this proof.
export async function graphFingerprint(api: PaseoApi, state: GraphCheckpoint) {
  const workspace = await api.workspaces.ref(state.source.workspaceId).refresh();
  if (!workspace?.workspaceDirectory) throw new TeamError('WORKSPACE_NOT_FOUND', 'Workspace directory is missing');
  const repo = await repository(workspace.workspaceDirectory);
  if (repo.lock !== state.repo)
    throw new TeamError('REPOSITORY_CHANGED', 'Workspace no longer matches the reserved repository');
  const value = await snapshot(repo.root);
  value.files = Object.fromEntries(Object.entries(value.files).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function verifyGraphIntegrity(
  api: PaseoApi,
  checkpoints: GraphCheckpoints,
  input: { id: string; workspaceId: string; expectedRevision: number; operationId: string },
) {
  const state = await checkpoints.get(input.id, input.workspaceId);
  const activation = state.activations.find((item) => item.operationId === input.operationId);
  if (!activation?.receipt || !activation.dispatch?.baseline)
    throw new TeamError(
      'GRAPH_BASELINE_REQUIRED',
      'Receipt and pre-send baseline required; never reconstruct a baseline',
    );
  if (activation.integrity) return state;
  if (state.revision !== input.expectedRevision)
    throw new TeamError('GRAPH_CONFLICT', 'Graph checkpoint changed; reload before retrying');
  return checkpoints.recordIntegrity(
    state.id,
    input.workspaceId,
    state.revision,
    input.operationId,
    await graphFingerprint(api, state),
  );
}
