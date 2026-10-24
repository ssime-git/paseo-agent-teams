import type { PluginLifecycleEvents } from '@getpaseo/plugin/server';
import type { GraphCheckpoints } from './graph-checkpoints';

// Only the official lifecycle hook may call this boundary. Never synthesize an
// event from idle state, waitForFinish, assistant text, or a native history page.
export async function captureGraphReceipt(
  checkpoints: GraphCheckpoints,
  event: PluginLifecycleEvents['agent.turn_ended'],
) {
  if (!event.turnId || !event.agent.workspaceId) return;
  for (const state of await checkpoints.all()) {
    if (state.source.workspaceId !== event.agent.workspaceId) continue;
    const activation = state.activations.find(
      (item) => item.dispatch?.agentId === event.agent.id && item.dispatch.attemptId,
    );
    if (!activation?.dispatch || activation.result) continue;
    // The hook carries this turn's native timeline. Require the exact bound
    // prompt, once, with no additional human message that could change its task.
    const users = event.timeline.filter((item) => item.type === 'user_message');
    if (users.length !== 1 || users[0].text !== activation.dispatch.prompt) continue;
    const promptIndex = event.timeline.indexOf(users[0]);
    const text = event.timeline
      .slice(promptIndex + 1)
      .filter((item) => item.type === 'assistant_message')
      .at(-1)?.text;
    if (text && text.length > 256 * 1024) continue; // No silent truncation.
    const receipt = {
      agentId: event.agent.id,
      attemptId: activation.dispatch.attemptId!,
      turnId: event.turnId,
      outcome: event.outcome.kind,
      ...(text !== undefined ? { text } : {}),
      ...(event.outcome.kind === 'failed' ? { error: event.outcome.error.message } : {}),
      ...(event.outcome.kind === 'canceled' ? { error: event.outcome.reason } : {}),
    };
    await checkpoints.receipt(state.id, state.source.workspaceId, state.revision, activation.operationId, receipt);
  }
}
