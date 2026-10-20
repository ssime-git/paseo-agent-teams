import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeMessageIndex, nativeText, projectNativeReport } from '../client/native-projection';
const artifact = {
  eventId: 'e',
  workflowId: 'w',
  workspaceId: 'ws',
  role: 'builder' as const,
  text: '\n\n---\n\n{"summary":"Done","changes":["actual.js"],"remaining":[]}',
};
test('saved SDK presentation separators match the actual canonical native assistant message', () => {
  const index = nativeMessageIndex([artifact]);
  assert.equal(index.get(nativeText('{"summary":"Done","changes":["actual.js"],"remaining":[]}'))?.eventId, 'e');
  assert.equal(index.get(nativeText('An unrelated JSON response')), undefined);
  assert.equal(artifact.text.startsWith('\n\n---'), true);
});
test('ambiguous identical responses from different workflows are never attributed to the wrong team', () => {
  const index = nativeMessageIndex([artifact, { ...artifact, eventId: 'other', workflowId: 'another' }]);
  assert.equal(index.get(nativeText(artifact.text)), null);
});

test('a long native report split into assistant items renders once with all fields intact', () => {
  const body = JSON.stringify({
    summary: 'Verified behavior. '.repeat(150),
    tasks: ['Implement'],
    acceptance: ['All cases'],
    tests: [],
  });
  const record = { ...artifact, role: 'planner' as const, text: body };
  const index = nativeMessageIndex([record]);
  const first = body.slice(0, 1000),
    middle = body.slice(1000, 2000),
    last = body.slice(2000);
  const rendered = projectNativeReport(first, index);
  assert.equal(rendered?.kind, 'report');
  assert.equal(rendered?.kind === 'report' && rendered.record.text, body);
  assert.equal(projectNativeReport(middle, index)?.kind, 'continuation');
  assert.equal(projectNativeReport(last, index)?.kind, 'continuation');
  assert.equal(projectNativeReport('Unrelated prose', index), undefined);
});
