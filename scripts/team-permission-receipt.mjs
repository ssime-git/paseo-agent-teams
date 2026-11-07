import assert from 'node:assert/strict';

// Team denies with interrupt:true: Claude may end in error with no final report.
// This proves refusal and a stopped pipeline, never successful Builder completion.
export function assertTeamDeniedWriteReceipt(proof) {
  const {
    beforeDenial: before,
    nativeRequest: request,
    permissionIntent: intent,
    finalWorkflow: final,
    finalAgent: agent,
    timeline,
  } = proof;
  assert.equal(before.status, 'permission');
  assert.equal(before.operation.role, 'builder');
  assert.equal(before.agents.builder, proof.agentId);
  assert.equal(intent.id, before.id);
  assert.equal(intent.workspaceId, before.workspaceId);
  assert.equal(intent.action, 'permission');
  assert.equal(intent.behavior, 'deny');
  assert.equal(intent.permissionId, request.id);
  assert.equal(request.kind, 'tool');
  assert.match(request.name, /^Write$/i);
  assert.equal(final.id, before.id);
  assert.equal(final.status, 'paused');
  assert.deepEqual(final.operation, before.operation, 'Interrupted operation remains retained, never resent');
  assert.equal(agent.activeTurn, null);
  assert.deepEqual(agent.pendingPermissions, []);
  assert.ok(['idle', 'closed', 'error'].includes(agent.status));
  assert.equal(timeline.error, null);
  assert.equal(timeline.hasOlder, false);
  assert.equal(timeline.hasNewer, false);
  assert.equal(timeline.gap, false);
  const items = timeline.entries.map(({ item }) => item);
  const users = items.filter((i) => i.type === 'user_message');
  assert.equal(users.length, 1);
  assert.ok(users[0].text.startsWith(`[agent-teams-operation:${before.operation.id}]\n`));
  const writes = items.filter((i) => i.type === 'tool_call' && /^Write$/i.test(i.name));
  assert.equal(writes.length, 1);
  const write = writes[0];
  assert.ok(write.callId);
  assert.equal(write.callId, request.metadata.toolUseId);
  assert.equal(request.input.file_path, proof.root + '/RESULT.txt');
  assert.equal(write.detail.filePath, request.input.file_path);
  assert.equal(write.detail.content, request.input.content);
  assert.equal(write.status, 'failed');
  assert.equal(write.error.is_error, true);
  assert.equal(write.error.tool_use_id, write.callId);
  assert.match(write.error.content, /tool use was rejected/);
  assert.ok(!items.slice(items.indexOf(write) + 1).some((i) => i.type === 'tool_call'));
  assert.equal(final.events.filter((e) => e.kind === 'dispatch' && e.role === 'builder').length, 1);
  assert.equal(final.events.filter((e) => e.kind === 'dispatch' && e.role === 'reviewer').length, 0);
  assert.equal(final.events.filter((e) => e.kind === 'permission_resolved').length, 1);
}

export function assertTeamDenialRestored(before, after) {
  const diagnostic = '[System Error] [ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use';
  const content = (timeline) =>
    timeline.entries
      .map(({ item }) => {
        const { messageId, clientMessageId, ...rest } = item;
        return rest;
      })
      // Paseo's transient interrupt diagnostic is not in the provider session file.
      // Never discard other assistant replies or native tool receipts.
      .filter((item) => !(item.type === 'assistant_message' && item.text === diagnostic));
  assert.deepEqual(content(after), content(before));
}
