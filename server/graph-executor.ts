import { randomUUID } from 'node:crypto';
import type { PaseoApi } from '@getpaseo/client';
import type { GraphCheckpoint } from '../shared/graph-checkpoint';
import { TeamError } from '../shared/errors';
import { GraphCheckpoints } from './graph-checkpoints';
import { prepareGraphDispatch } from './graph-preparation';
import { sendGraphDispatch } from './graph-dispatch';
import { observeGraphDispatch } from './graph-reconciliation';
import { verifyGraphIntegrity } from './graph-integrity';
import { runGraphTests } from './graph-tests';
import { consumeGraphResult } from './graph-consumption';

export type GraphAdvance = {
  status: 'progressed' | 'waiting' | 'blocked' | 'terminal' | 'stale';
  reason: string;
  state: GraphCheckpoint;
};

// Internal executor for an already admitted graph. One durable boundary per call,
// no polling, model retry, human decision or native permission response. The Team
// adapter must authenticate launch/commands before calling; this is not an RPC.
export async function advanceGraph(
  api: PaseoApi,
  checkpoints: GraphCheckpoints,
  input: { id: string; workspaceId: string; expectedRevision: number },
): Promise<GraphAdvance> {
  const state = await checkpoints.get(input.id, input.workspaceId);
  const result = (status: GraphAdvance['status'], reason: string, next = state): GraphAdvance => ({
    status,
    reason,
    state: next,
  });
  // A lost response must not execute the *next* boundary on a stale retry.
  if (state.revision !== input.expectedRevision) return result('stale', 'checkpoint_changed');
  if (['succeeded', 'failed', 'exhausted'].includes(state.status)) return result('terminal', state.status);
  if (state.status === 'waiting_human') return result('waiting', 'human_response_required');
  if (state.status === 'ready')
    return result(
      'progressed',
      'reserved',
      await checkpoints.reserve(state.id, input.workspaceId, state.revision, randomUUID()),
    );

  const activation = state.activations.at(-1)!;
  const step = state.source.definition.steps.find((item) => item.id === activation.stepId)!;
  const operation = { ...input, operationId: activation.operationId };
  if (!activation.dispatch) {
    const prepared = await prepareGraphDispatch(api, checkpoints, operation);
    return result('progressed', 'prepared', prepared.state);
  }
  if (!activation.dispatch.attemptId) {
    const sent = await sendGraphDispatch(api, checkpoints, operation);
    return result(sent.status === 'sent' ? 'progressed' : 'waiting', sent.status, sent.state);
  }
  if (!activation.receipt) {
    const observation = await observeGraphDispatch(api, state, activation.operationId);
    // Even idle/accepted is not a completion receipt. Only the lifecycle hook
    // adapter can publish it; observing never clears or repeats the send claim.
    return result('waiting', observation.status === 'accepted' ? 'completion_receipt_required' : observation.status);
  }
  if (step.access === 'read-only') {
    if (!activation.integrity)
      return result('progressed', 'integrity_recorded', await verifyGraphIntegrity(api, checkpoints, operation));
    if (!activation.integrity.unchanged) return result('blocked', 'read_only_changed');
  }
  if (!activation.assessment)
    return result(
      'progressed',
      'assessed',
      await checkpoints.assessReceipt(state.id, input.workspaceId, state.revision, activation.operationId),
    );
  if (activation.assessment.status !== 'valid') return result('blocked', activation.assessment.status);
  if (!step.tests) return result('waiting', 'explicit_no_tests_decision_required');
  if (activation.testRun && !activation.testRun.completion) return result('blocked', 'test_completion_uncertain');
  try {
    if (!activation.testRun)
      return result('progressed', 'tests_recorded', await runGraphTests(api, checkpoints, operation));
    return result('progressed', 'consumed', await consumeGraphResult(api, checkpoints, operation));
  } catch (error) {
    if (
      error instanceof TeamError &&
      ['GRAPH_TESTS_FAILED', 'GRAPH_EVIDENCE_STALE', 'GRAPH_INTEGRITY_REQUIRED'].includes(error.code)
    )
      return result('blocked', error.code);
    throw error;
  }
}
