import { randomUUID } from 'node:crypto';
import type { PaseoApi } from '@getpaseo/client';
import type { TestResult } from '../shared/contracts';
import { TeamError } from '../shared/errors';
import { runCommand } from './commands';
import { repository } from './git';
import { GraphCheckpoints } from './graph-checkpoints';
import { graphFingerprint } from './graph-integrity';

// Internal evidence stage, not a production transition API. Only explicitly saved
// definition commands run; no agent-proposed commands or implicit no-test approval.
export async function runGraphTests(
  api: PaseoApi,
  checkpoints: GraphCheckpoints,
  input: { id: string; workspaceId: string; expectedRevision: number; operationId: string },
) {
  const state = await checkpoints.get(input.id, input.workspaceId);
  const activation = state.activations.find((a) => a.operationId === input.operationId);
  if (!activation || activation.result || state.status !== 'running')
    throw new TeamError('GRAPH_NOT_RUNNING', 'Pending activation required');
  if (activation.testRun) return state; // Includes uncertain claims after restart.
  if (state.revision !== input.expectedRevision)
    throw new TeamError('GRAPH_CONFLICT', 'Graph checkpoint changed; reload before retrying');
  const step = state.source.definition.steps.find((s) => s.id === activation.stepId)!;
  if (!step.tests || activation.assessment?.status !== 'valid')
    throw new TeamError('GRAPH_TESTS_NOT_READY', 'Explicit tests and valid native assessment required');
  const fingerprint = await graphFingerprint(api, state);
  if (
    step.access === 'read-only' &&
    (!activation.integrity?.unchanged || activation.integrity.fingerprint !== fingerprint)
  )
    throw new TeamError('GRAPH_INTEGRITY_REQUIRED', 'Unchanged read-only evidence and current repository required');
  const workspace = await api.workspaces.ref(input.workspaceId).refresh();
  const repo = await repository(workspace!.workspaceDirectory!);
  if (repo.lock !== state.repo) throw new TeamError('REPOSITORY_CHANGED', 'Reserved repository changed');
  const attemptId = randomUUID();
  const claimed = await checkpoints.claimTests(
    state.id,
    input.workspaceId,
    state.revision,
    input.operationId,
    attemptId,
    fingerprint,
  );
  const results: TestResult[] = [];
  let error: string | undefined;
  try {
    for (const command of step.tests) results.push(await runCommand(repo.root, command));
  } catch (cause) {
    error = String(cause).slice(0, 4000);
  }
  // Failure to capture/publish leaves the claim uncertain. Never rerun it.
  return checkpoints.completeTests(state.id, input.workspaceId, claimed.revision, input.operationId, attemptId, {
    results,
    fingerprint: await graphFingerprint(api, state),
    ...(error ? { error } : {}),
  });
}
