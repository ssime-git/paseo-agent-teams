import assert from 'node:assert/strict';

// A nonempty timeline or an unchanged file alone cannot prove native denial.
export function assertDeniedWriteReceipt(proof) {
  assert.equal(proof.turn.status, 'permission');
  assert.equal(proof.request.kind, 'tool');
  assert.match(proof.request.name, /^write$/i);
  assert.ok(proof.request.id);
  assert.equal(proof.denialIntent.requestId, proof.request.id);
  assert.equal(proof.denialIntent.response.behavior, 'deny');
  const message = proof.denialIntent.response.message;
  assert.ok(typeof message === 'string' && message.length > 0);
  assert.equal(proof.timeline.error, null);
  assert.equal(proof.timeline.hasOlder, false, 'The complete turn must be visible');
  assert.equal(proof.timeline.hasNewer, false);
  assert.equal(proof.timeline.gap, false);
  const items = proof.timeline.entries.map(({ item }) => item);
  const users = items.filter((item) => item.type === 'user_message');
  assert.equal(users.length, 1, 'Exactly one prompt expected');
  assert.equal(users[0].text, proof.turnIntent.prompt);
  const tools = items.filter((item) => item.type === 'tool_call');
  const writes = tools.filter((item) => /^write$/i.test(item.name));
  assert.equal(writes.length, 1, 'Exactly one Write attempt expected');
  const write = writes[0];
  assert.ok(typeof write.callId === 'string' && write.callId.length > 0);
  assert.equal(write.callId, proof.request.metadata.toolUseId);
  assert.equal(proof.request.input.file_path, proof.root + '/RESULT.txt');
  assert.equal(write.detail.content, proof.request.input.content);
  assert.equal(write.detail.filePath, proof.root + '/RESULT.txt');
  assert.equal(write.status, 'failed');
  assert.equal(write.error.is_error, true);
  assert.equal(write.error.tool_use_id, write.callId);
  assert.equal(write.error.content, message);
  const writeIndex = items.indexOf(write);
  assert.ok(!items.slice(writeIndex + 1).some((item) => item.type === 'tool_call'), 'No tool retry after denial');
  assert.ok(tools.every((item) => item === write || (item.name === 'Read' && item.status === 'completed')));
  assert.ok(items.slice(writeIndex + 1).some((item) => item.type === 'assistant_message' && item.text?.trim()));
}
