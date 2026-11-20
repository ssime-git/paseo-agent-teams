import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workflowFixture } from './fixtures';
import { loadResponseUi } from './response-ui-harness';

test('live role card shows actual subtasks, pauses honestly, reports refresh errors and disappears on completion', async (t) => {
  const React = (await import('react')).default;
  const { create, act } = await import('react-test-renderer');
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { TeamActivity } = await loadResponseUi(t, 'client/team-activity.tsx', '__activityTest');
  const w = workflowFixture();
  w.operation = { id: 'op', role: 'builder', phase: 'building', state: 'sent', startedAt: 'now' };
  w.status = 'running';
  w.plan = { summary: 'Plan', tasks: ['Preserve README', 'Add edge cases'], acceptance: ['Works'], tests: [] };
  let fail = false;
  (globalThis as Record<string, unknown>).__activityTest = {
    language: 'en',
    rpc: (name: string) => async () => {
      if (fail) throw Error('offline');
      if (name === 'teams.operation_activity')
        return [
          { toolName: '', summary: 'Reviewing the error handling' },
          { toolName: 'Read', summary: 'src/validation.ts' },
        ];
      return structuredClone(w);
    },
  };
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__activityTest;
  });
  const props = {
    item: {
      data: {
        id: w.id,
        workspaceId: w.workspaceId,
        operationId: 'op',
        role: 'builder',
        model: 'Detected model',
        description: 'Implement approved plan',
      },
    },
    agentId: 'owner',
    theme: {
      colors: { accent: 'blue', foreground: 'black', foregroundMuted: 'grey', border: 'grey', surface1: 'white' },
    },
  };
  let tree: ReturnType<typeof create>;
  await act(async () => {
    tree = create(React.createElement(TeamActivity, props));
  });
  const text = () => JSON.stringify(tree!.toJSON());
  assert.match(text(), /Detected model/);
  assert.match(text(), /Preserve README/);
  assert.match(text(), /Add edge cases/);
  assert.match(text(), /In progress/);
  assert.match(text(), /From the sub-agent thread/);
  assert.match(text(), /Reviewing the error handling/);
  assert.match(text(), /src\/validation.ts/);
  w.status = 'paused';
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1100));
  });
  assert.match(text(), /Team paused/);
  fail = true;
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1100));
  });
  assert.match(text(), /Refresh unavailable/);
  fail = false;
  delete w.operation;
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1100));
  });
  assert.equal(tree!.toJSON(), null);
  await act(async () => tree!.unmount());
});
