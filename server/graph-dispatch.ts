import { randomUUID } from 'node:crypto';
import type { PaseoApi } from '@getpaseo/client';
import { TeamError } from '../shared/errors';
import { GraphCheckpoints } from './graph-checkpoints';
import { observeGraphDispatch } from './graph-reconciliation';

// Internal initial-send boundary only. Sending is not completion or permission to
// consume an artifact. No retry, native permission response or graph transition.
export async function sendGraphDispatch(
  api: PaseoApi,
  checkpoints: GraphCheckpoints,
  input: { id: string; workspaceId: string; expectedRevision: number; operationId: string },
) {
  const current = await checkpoints.get(input.id, input.workspaceId);
  const activation = current.activations.find((item) => item.operationId === input.operationId);
  if (!activation?.dispatch || activation.result || current.status !== 'running')
    throw new TeamError('GRAPH_NOT_RUNNING', 'A pending bound activation is required');
  if (activation.dispatch.attemptId)
    return {
      status: 'existing' as const,
      state: current,
      observation: await observeGraphDispatch(api, current, input.operationId),
    };
  // Immutable publication arbitrates independent processes before any native I/O.
  const state = await checkpoints.claimDispatch(
    input.id,
    input.workspaceId,
    input.expectedRevision,
    input.operationId,
    randomUUID(),
  );
  const dispatch = state.activations.find((item) => item.operationId === input.operationId)!.dispatch!;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const agent = api.agents.ref(dispatch.agentId);
        if (!(await agent.refresh()) || agent.status !== 'idle' || agent.activeTurn || agent.pendingPermissions?.length)
          throw new Error('Native session is not idle and available');
        // This session was created solely for this operation. Foreign content or
        // an incomplete view prevents sending, even when no exact prompt exists.
        const page = await agent.timeline.refetch({ direction: 'before', limit: 1, projection: 'canonical' });
        // Paseo 0.11.2 reports hasOlder=true even for a fresh zero-entry
        // window. Accept only its explicit empty sequence bounds in that case.
        const emptyWindow =
          page.window?.minSeq === 0 &&
          page.window.maxSeq === 0 &&
          page.window.nextSeq === 1 &&
          !page.startCursor &&
          !page.endCursor;
        if (
          page.error ||
          page.entries.length ||
          (page.hasOlder && !emptyWindow) ||
          page.reset ||
          page.gap ||
          page.staleCursor
        )
          throw new Error('Native session is not provably empty');
        if (expired) throw new Error('Native preflight exceeded send budget');
        await agent.send(dispatch.prompt, { messageId: input.operationId, activeTurnBehavior: 'steer' });
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error('Native initial-send budget exceeded (20s)'));
        }, 20_000);
      }),
    ]);
    return { status: 'sent' as const, state };
  } catch (error) {
    // Even a preflight error retains the attempt. The native request may have
    // reached the daemon before its response was lost. Never clear or replay it.
    return { status: 'uncertain' as const, state, reason: String(error) };
  } finally {
    clearTimeout(timer);
  }
}
