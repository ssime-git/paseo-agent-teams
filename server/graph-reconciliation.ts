import type { PaseoApi } from '@getpaseo/client';
import type { GraphCheckpoint } from '../shared/graph-checkpoint';

export type GraphObservation =
  { status: 'uncertain'; reason: string } | { status: 'permission' | 'running' | 'accepted' };

// Read-only and bounded: observing acceptance never authorizes a resend or proves
// completion. A future executor must consume a durable completion receipt.
export async function observeGraphDispatch(
  api: PaseoApi,
  state: GraphCheckpoint,
  operationId: string,
): Promise<GraphObservation> {
  const activation = state.activations.find((entry) => entry.operationId === operationId);
  const uncertain = (reason: string): GraphObservation => ({ status: 'uncertain', reason });
  if (!activation?.dispatch || activation.result || state.status !== 'running')
    return uncertain('No pending native dispatch to reconcile');
  try {
    const agent = api.agents.ref(activation.dispatch.agentId);
    if (!(await agent.refresh())) return uncertain('Saved native agent is missing');
    const entries = [];
    let cursor;
    const cursors = new Set<string>();
    let epoch: string | undefined;
    for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
      const page = await agent.timeline.refetch({ direction: 'before', limit: 100, projection: 'canonical', cursor });
      if (page.reset || page.gap || page.staleCursor || !page.endCursor)
        return uncertain('Native timeline is incomplete or changed');
      if (epoch && epoch !== page.endCursor.epoch) return uncertain('Native timeline epoch changed');
      epoch = page.endCursor.epoch;
      entries.unshift(...page.entries);
      const matches = entries.filter(
        (entry) => entry.item.type === 'user_message' && entry.item.text === activation.dispatch!.prompt,
      );
      if (matches.length > 1) return uncertain('Saved prompt appears more than once');
      if (matches.length === 1) {
        const index = entries.indexOf(matches[0]);
        if (entries.slice(index + 1).some((entry) => entry.item.type === 'user_message'))
          return uncertain('Another prompt followed the saved operation');
        // Refresh after history inspection: a busy or permission-blocked agent is
        // never interpreted as an idle completed operation.
        if (!(await agent.refresh())) return uncertain('Saved native agent disappeared');
        if (agent.pendingPermissions?.length) return { status: 'permission' };
        if (agent.status === 'running' && agent.activeTurn) return { status: 'running' };
        if (agent.status !== 'idle' || agent.activeTurn) return uncertain('Native agent state is unresolved');
        return { status: 'accepted' };
      }
      if (!page.hasOlder) return uncertain('Cannot prove acceptance of the exact saved prompt');
      if (!page.startCursor) return uncertain('Native history cursor is missing');
      const key = JSON.stringify(page.startCursor);
      if (cursors.has(key)) return uncertain('Native history cursor did not advance');
      cursors.add(key);
      cursor = page.startCursor;
    }
    return uncertain('Native history exceeds the 1000-entry reconciliation budget');
  } catch (error) {
    return uncertain(`Native inspection failed; dispatch retained: ${String(error)}`);
  }
}
