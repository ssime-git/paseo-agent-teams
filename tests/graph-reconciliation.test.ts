import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PaseoApi } from '@getpaseo/client';
import type { GraphCheckpoint } from '../shared/graph-checkpoint';
import { observeGraphDispatch } from '../server/graph-reconciliation';

const prompt = '[agent-teams-operation:operation] exact saved prompt';
const state = {
  status: 'running',
  activations: [{ operationId: 'operation', dispatch: { agentId: 'agent', prompt } }],
} as unknown as GraphCheckpoint;
const user = (text = prompt) => ({ item: { type: 'user_message', text } });
function adapter(pages: Record<string, unknown>[] = [], overrides = {}) {
  let reads = 0;
  const handle = {
    refresh: async () => ({}),
    status: 'idle',
    activeTurn: null,
    pendingPermissions: [],
    ...overrides,
    timeline: { refetch: async () => pages[Math.min(reads++, pages.length - 1)] },
  };
  // Deliberately no run/send/wait/permission mutation methods in this adapter.
  const api = { agents: { ref: () => handle } } as unknown as PaseoApi;
  return { api, reads: () => reads };
}
const page = (entries: unknown[], extra = {}) => ({ entries, endCursor: { epoch: 'e', seq: 10 }, ...extra });

test('graph inspection proves exact prompt acceptance without claiming completion or mutating state', async () => {
  const before = structuredClone(state);
  for (const [overrides, status] of [
    [{}, 'accepted'],
    [{ status: 'running', activeTurn: {} }, 'running'],
    [{ pendingPermissions: [{}] }, 'permission'],
  ] as const) {
    const h = adapter([page([user(), { item: { type: 'assistant_message', text: 'unproven result' } }])], overrides);
    assert.equal((await observeGraphDispatch(h.api, state, 'operation')).status, status);
  }
  assert.deepEqual(state, before);
});

test('graph inspection rejects ambiguous, changed, missing and unavailable native histories', async () => {
  const cases = [
    adapter([page([])]),
    adapter([page([user(prompt + ' changed')])]),
    adapter([page([user(), user('human followup')])]),
    adapter([page([user(), user()])]),
    ...['reset', 'gap', 'staleCursor'].map((flag) => adapter([page([user()], { [flag]: true })])),
    adapter([page([user()], { endCursor: undefined })]),
    adapter([], { refresh: async () => null }),
    adapter([], {
      refresh: async () => {
        throw new Error('no rollout found');
      },
    }),
    adapter([page([user()])], { status: 'initializing' }),
  ];
  for (const h of cases) assert.equal((await observeGraphDispatch(h.api, state, 'operation')).status, 'uncertain');
  const h = adapter();
  assert.equal((await observeGraphDispatch(h.api, state, 'unknown')).status, 'uncertain');
  assert.equal(h.reads(), 0);
});

test('graph history pagination is bounded and rejects stalled cursors and epoch changes', async () => {
  const older = { hasOlder: true, startCursor: { epoch: 'e', seq: 2 } };
  const success = adapter([page([], older), page([user()])]);
  assert.equal((await observeGraphDispatch(success.api, state, 'operation')).status, 'accepted');
  const stalled = adapter([page([], older)]);
  assert.equal((await observeGraphDispatch(stalled.api, state, 'operation')).status, 'uncertain');
  assert.equal(stalled.reads(), 2);
  const changed = adapter([page([], older), page([user()], { endCursor: { epoch: 'other', seq: 10 } })]);
  assert.equal((await observeGraphDispatch(changed.api, state, 'operation')).status, 'uncertain');
  const bounded = adapter(
    Array.from({ length: 11 }, (_, i) => page([], { hasOlder: true, startCursor: { epoch: 'e', seq: 100 - i } })),
  );
  assert.equal((await observeGraphDispatch(bounded.api, state, 'operation')).status, 'uncertain');
  assert.equal(bounded.reads(), 10);
});
