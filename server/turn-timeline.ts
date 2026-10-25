import type { PaseoApi } from '@getpaseo/client';
import type { PluginLifecycleEvents } from '@getpaseo/plugin/server';
import type { AgentTimelineItem } from '@getpaseo/protocol/agent-types';

// Paseo 0.13 completion hooks no longer embed history. The hook remains the
// completion evidence; history supplies only the exact identified turn's text.
// Missing/ambiguous history never fabricates a receipt or authorizes resending.
export async function completedTurnTimeline(
  api: PaseoApi,
  event: PluginLifecycleEvents['agent.turn_ended'],
): Promise<readonly AgentTimelineItem[] | undefined> {
  if (!event.turnId || !event.agent.workspaceId) return;
  try {
    const agent = api.agents.ref(event.agent.id);
    if (!(await agent.refresh()) || agent.workspaceId !== event.agent.workspaceId) return;
    const entries = [];
    let cursor;
    let epoch: string | undefined;
    const cursors = new Set<string>();
    for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
      const page = await agent.timeline.refetch({ direction: 'before', limit: 100, projection: 'canonical', cursor });
      if (page.error || page.reset || page.gap || page.staleCursor || !page.endCursor || !page.entries.length) return;
      if (pageNumber === 0 && page.hasNewer) return;
      if (epoch && epoch !== page.endCursor.epoch) return;
      epoch = page.endCursor.epoch;
      if (entries.length && page.entries.at(-1)!.seqEnd >= entries[0].seqStart) return;
      entries.unshift(...page.entries);
      // A later turn makes a delayed hook ambiguous; do not borrow its output.
      if (entries.at(-1)!.turnId !== event.turnId) return;
      const first = entries.findIndex((entry) => entry.turnId === event.turnId);
      if (entries.slice(0, first).some((entry) => !entry.turnId)) return;
      const turn = entries.slice(first);
      if (turn.some((entry) => entry.turnId !== event.turnId)) return;
      if (first > 0 || !page.hasOlder) {
        if (turn[0].item.type !== 'user_message' || turn.filter((e) => e.item.type === 'user_message').length !== 1)
          return;
        if (!(await agent.refresh()) || agent.workspaceId !== event.agent.workspaceId) return;
        if (agent.activeTurn && agent.activeTurn.turnId !== event.turnId) return;
        return turn.map((entry) => entry.item);
      }
      if (!page.startCursor) return;
      const key = JSON.stringify(page.startCursor);
      if (cursors.has(key)) return;
      cursors.add(key);
      cursor = page.startCursor;
    }
  } catch {
    // Preserve the operation and its repository reservation on read failure.
  }
}
