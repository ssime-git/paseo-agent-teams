import assert from 'node:assert/strict';

export function assertModelTimelineRestored(before, after, workflowId, operationId) {
  const content = (timeline) => {
    assert.equal(timeline.error, null);
    assert.equal(timeline.hasOlder, false);
    assert.equal(timeline.hasNewer, false);
    assert.equal(timeline.gap, false);
    const items = timeline.entries
      .map(({ item }) => item)
      .filter((item) => {
        // Host progress projections are not provider session content; record is compared separately.
        return !(
          item.type === 'plugin' &&
          item.pluginId === 'paseo-agent-teams' &&
          item.kind === 'agent-teams-progress' &&
          item.data.workflowId === workflowId
        );
      })
      .map(({ messageId, clientMessageId, ...item }) => {
        // Paseo's live result separator is presentation only, absent after provider rehydration.
        if (item.type === 'assistant_message' && item.text.startsWith('\n\n---\n\n'))
          return { ...item, text: item.text.slice(7) };
        return item;
      });
    const prompts = items.filter((item) => item.type === 'user_message');
    const ids = Array.isArray(operationId) ? operationId : [operationId];
    assert.ok(ids.length > 0 && new Set(ids).size === ids.length);
    assert.equal(prompts.length, ids.length);
    for (let n = 0; n < ids.length; n++) assert.ok(prompts[n].text.startsWith(`[agent-teams-operation:${ids[n]}]\n`));
    return items;
  };
  assert.deepEqual(content(after), content(before));
}
