import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTeamDeniedWriteReceipt } from './team-permission-receipt.mjs';

function fixture() {
  const operation = { id: 'op', role: 'builder', state: 'sent' };
  return {
    root: '/tmp/isolated',
    agentId: 'builder',
    beforeDenial: {
      id: 'workflow',
      workspaceId: 'workspace',
      status: 'permission',
      operation,
      agents: { builder: 'builder' },
    },
    nativeRequest: {
      id: 'permission',
      kind: 'tool',
      name: 'Write',
      metadata: { toolUseId: 'native' },
      input: { file_path: '/tmp/isolated/RESULT.txt', content: 'changed\n' },
    },
    permissionIntent: {
      id: 'workflow',
      workspaceId: 'workspace',
      action: 'permission',
      permissionId: 'permission',
      behavior: 'deny',
    },
    finalWorkflow: {
      id: 'workflow',
      status: 'paused',
      operation: structuredClone(operation),
      events: [
        { kind: 'dispatch', role: 'builder' },
        { kind: 'permission_resolved', role: 'builder' },
      ],
    },
    finalAgent: { status: 'error', activeTurn: null, pendingPermissions: [] },
    timeline: {
      error: null,
      hasOlder: false,
      hasNewer: false,
      gap: false,
      entries: [
        { item: { type: 'user_message', text: '[agent-teams-operation:op]\nApproved prompt' } },
        {
          item: {
            type: 'tool_call',
            name: 'Write',
            callId: 'native',
            status: 'failed',
            detail: { filePath: '/tmp/isolated/RESULT.txt', content: 'changed\n' },
            error: { is_error: true, tool_use_id: 'native', content: 'The tool use was rejected. STOP.' },
          },
        },
        { item: { type: 'assistant_message', text: '[System Error] interrupted' } },
      ],
    },
  };
}

test('Team interrupted denial requires native rejection, retained operation and no retry or next stage', () => {
  assertTeamDeniedWriteReceipt(fixture());
  const mutations = [
    (p) => {
      p.beforeDenial.status = 'running';
    },
    (p) => {
      p.permissionIntent.behavior = 'allow';
    },
    (p) => {
      p.permissionIntent.permissionId = 'other';
    },
    (p) => {
      p.permissionIntent.workspaceId = 'other';
    },
    (p) => {
      p.finalWorkflow.operation.id = 'resent';
    },
    (p) => {
      p.finalWorkflow.status = 'completed';
    },
    (p) => {
      p.finalAgent.activeTurn = { id: 'running' };
    },
    (p) => {
      p.finalAgent.pendingPermissions = [{}];
    },
    (p) => {
      p.finalAgent.status = 'running';
    },
    (p) => {
      p.timeline.error = 'transport error';
    },
    (p) => {
      p.timeline.hasOlder = true;
    },
    (p) => {
      p.timeline.hasNewer = true;
    },
    (p) => {
      p.timeline.gap = true;
    },
    (p) => {
      p.timeline.entries = [];
    },
    (p) => {
      p.timeline.entries[0].item.text = 'unrelated native prompt';
    },
    (p) => {
      p.timeline.entries[1].item.callId = 'other';
    },
    (p) => {
      p.timeline.entries[1].item.status = 'completed';
    },
    (p) => {
      p.timeline.entries[1].item.error.tool_use_id = 'other';
    },
    (p) => {
      p.timeline.entries[1].item.error.content = 'unrelated tool failure';
    },
    (p) => {
      p.nativeRequest.input.content = 'other';
    },
    (p) => {
      p.nativeRequest.input.file_path = '/tmp/other';
    },
    (p) => {
      p.timeline.entries.push(structuredClone(p.timeline.entries[1]));
    },
    (p) => {
      p.timeline.entries.push({ item: { type: 'tool_call', name: 'Bash' } });
    },
    (p) => {
      p.timeline.entries.push({ item: { type: 'user_message', text: 'retry' } });
    },
    (p) => {
      p.finalWorkflow.events.push({ kind: 'dispatch', role: 'builder' });
    },
    (p) => {
      p.finalWorkflow.events.push({ kind: 'dispatch', role: 'reviewer' });
    },
    (p) => {
      p.finalWorkflow.events.push({ kind: 'permission_resolved' });
    },
  ];
  for (const [i, mutate] of mutations.entries()) {
    const proof = fixture();
    mutate(proof);
    assert.throws(() => assertTeamDeniedWriteReceipt(proof), { name: 'AssertionError' }, 'mutation ' + i);
  }
});

test('restore tolerates only the exact transient interrupt diagnostic, retaining prompts and receipts', async () => {
  const { assertTeamDenialRestored } = await import('./team-permission-receipt.mjs');
  const before = fixture().timeline;
  before.entries[2].item.text =
    '[System Error] [ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use';
  const restored = structuredClone(before);
  restored.entries.pop();
  assertTeamDenialRestored(before, restored);
  for (const mutate of [
    (t) => {
      t.entries[0].item.text = 'new prompt';
    },
    (t) => {
      t.entries[1].item.status = 'completed';
    },
    (t) => {
      t.entries[1].item.error.tool_use_id = 'other';
    },
    (t) => {
      t.entries.push({ item: { type: 'assistant_message', text: 'Invented success' } });
    },
  ]) {
    const changed = structuredClone(restored);
    mutate(changed);
    assert.throws(() => assertTeamDenialRestored(before, changed), { name: 'AssertionError' });
  }
  before.entries[2].item.text = 'Real assistant explanation';
  assert.throws(() => assertTeamDenialRestored(before, restored), { name: 'AssertionError' });
});
