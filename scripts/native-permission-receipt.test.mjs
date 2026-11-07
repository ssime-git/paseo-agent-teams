import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDeniedWriteReceipt } from './native-permission-receipt.mjs';

function fixture() {
  return {
    root: '/tmp/isolated',
    turn: { status: 'permission' },
    request: {
      id: 'permission-1',
      kind: 'tool',
      name: 'Write',
      metadata: { toolUseId: 'native-1' },
      input: { file_path: '/tmp/isolated/RESULT.txt', content: 'changed' },
    },
    turnIntent: { prompt: 'Write once; stop if denied.' },
    denialIntent: { requestId: 'permission-1', response: { behavior: 'deny', message: 'Denied by test' } },
    timeline: {
      error: null,
      hasOlder: false,
      hasNewer: false,
      gap: false,
      entries: [
        { item: { type: 'user_message', text: 'Write once; stop if denied.' } },
        {
          item: {
            type: 'tool_call',
            callId: 'native-1',
            name: 'Write',
            detail: { filePath: '/tmp/isolated/RESULT.txt', content: 'changed' },
            status: 'failed',
            error: { is_error: true, tool_use_id: 'native-1', content: 'Denied by test' },
          },
        },
        { item: { type: 'assistant_message', text: 'Denied; stopped.' } },
      ],
    },
  };
}

test('native denial requires an identified failed Write receipt and complete single turn', () => {
  assertDeniedWriteReceipt(fixture());
  const mutations = [
    (p) => {
      p.request.metadata.toolUseId = 'other';
    },
    (p) => {
      p.request.input.content = 'different';
    },
    (p) => {
      p.request.input.file_path = '/tmp/other';
    },
    (p) => {
      p.timeline.entries = [];
    },
    (p) => {
      p.turn.status = 'idle';
    },
    (p) => {
      p.denialIntent.requestId = 'other';
    },
    (p) => {
      p.denialIntent.response.behavior = 'allow';
    },
    (p) => {
      p.timeline.gap = true;
    },
    (p) => {
      p.timeline.hasOlder = true;
    },
    (p) => {
      p.timeline.hasNewer = true;
    },
    (p) => {
      p.timeline.error = 'failed';
    },
    (p) => {
      p.timeline.entries[1].item.status = 'completed';
    },
    (p) => {
      p.timeline.entries[1].item.callId = '';
    },
    (p) => {
      p.timeline.entries[1].item.error.tool_use_id = 'other';
    },
    (p) => {
      p.timeline.entries[1].item.error.content = 'unrelated failure';
    },
    (p) => {
      p.timeline.entries[1].item.detail.filePath = '/tmp/other/RESULT.txt';
    },
    (p) => {
      p.timeline.entries.push(p.timeline.entries[1]);
    },
    (p) => {
      p.timeline.entries.push({ item: { type: 'tool_call', name: 'Read', status: 'completed' } });
    },
    (p) => {
      p.timeline.entries.push(p.timeline.entries[0]);
    },
    (p) => {
      p.timeline.entries.pop();
    },
  ];
  for (const mutate of mutations) {
    const proof = fixture();
    mutate(proof);
    assert.throws(() => assertDeniedWriteReceipt(proof), mutate.toString());
  }
});
