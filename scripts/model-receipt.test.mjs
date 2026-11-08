import test from 'node:test';
import assert from 'node:assert/strict';
import { assertModelTimelineRestored } from './model-receipt.mjs';

test('model restart preserves all native content while ignoring only identified host presentation', () => {
  const timeline = (items) => ({
    error: null,
    gap: false,
    hasOlder: false,
    hasNewer: false,
    entries: items.map((item) => ({ item })),
  });
  const prompt = {
    type: 'user_message',
    text: '[agent-teams-operation:op]\nexact prompt',
    messageId: 'live',
    clientMessageId: 'op',
  };
  const tool = {
    type: 'tool_call',
    name: 'Shell',
    status: 'completed',
    callId: 'tool',
    detail: { command: 'sleep 5' },
  };
  const answer = { type: 'assistant_message', text: '\n\n---\n\n{"summary":"plan"}' };
  const progress = {
    type: 'plugin',
    pluginId: 'paseo-agent-teams',
    kind: 'agent-teams-progress',
    data: { workflowId: 'workflow' },
  };
  const before = timeline([progress, prompt, tool, answer]);
  const restored = timeline([
    { ...prompt, messageId: 'restored', clientMessageId: undefined },
    tool,
    { ...answer, text: '{"summary":"plan"}' },
  ]);
  assertModelTimelineRestored(before, restored, 'workflow', 'op');
  for (const altered of [
    timeline([prompt, tool, { ...answer, text: '{"summary":"other"}' }]),
    timeline([prompt, { ...tool, status: 'failed' }, answer]),
    timeline([prompt, answer]),
    timeline([prompt, prompt, tool, answer]),
    timeline([{ ...prompt, text: '[agent-teams-operation:other]\nexact prompt' }, tool, answer]),
    timeline([prompt, tool, answer, { ...progress, pluginId: 'another-plugin' }]),
    { ...restored, gap: true },
    { ...restored, hasOlder: true },
    { ...restored, hasNewer: true },
    { ...restored, error: 'failed read' },
  ])
    assert.throws(() => assertModelTimelineRestored(before, altered, 'workflow', 'op'));
});
