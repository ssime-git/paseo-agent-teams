import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PaseoApi } from '@getpaseo/client';
import type { PluginLifecycleEvents } from '@getpaseo/plugin/server';
import { completedTurnTimeline } from '../server/turn-timeline';

const event: PluginLifecycleEvents['agent.turn_ended'] = {
  agent: {
    id: 'native-agent',
    workspaceId: 'owner',
    provider: 'codex',
    cwd: '/isolated',
    title: null,
    parentAgentId: null,
  },
  turnId: 'completed-turn',
  outcome: { kind: 'completed' },
  timeline: [],
};
const entry = (seq: number, turnId = event.turnId, type = 'assistant_message') => ({
  seqStart: seq,
  seqEnd: seq,
  turnId,
  item: { type, text: `text-${seq}` },
});
const page = (entries = [entry(1, event.turnId, 'user_message'), entry(2)]) => ({
  entries,
  endCursor: { epoch: 'epoch', seq: entries.at(-1)!.seqEnd },
  startCursor: { epoch: 'epoch', seq: entries[0].seqStart },
  hasOlder: false,
  hasNewer: false,
});
function fixture(pages: unknown[], workspaces: (string | null)[] = ['owner']) {
  let calls = 0,
    refreshes = 0;
  const agent = {
    workspaceId: 'owner' as string | null,
    activeTurn: undefined as { turnId: string } | undefined,
    refresh: async () => {
      agent.workspaceId = workspaces[Math.min(refreshes++, workspaces.length - 1)];
      return agent.workspaceId ? {} : undefined;
    },
    timeline: {
      refetch: async () => {
        if (calls >= pages.length) throw new Error('Unexpected page');
        return pages[calls++];
      },
    },
  };
  const api = {
    agents: {
      ref: (id: string) => {
        assert.equal(id, event.agent.id);
        return agent;
      },
    },
  } as unknown as PaseoApi;
  return { api, agent, calls: () => calls };
}

test('0.13 empty completion hooks fetch only the identified turn and preserve its native outcome', async () => {
  const p = page([
    entry(1, 'older', 'user_message'),
    entry(2, 'older'),
    entry(3, event.turnId, 'user_message'),
    entry(4),
  ]);
  for (const outcome of [
    { kind: 'completed' },
    { kind: 'failed', error: { message: 'Native failure' } },
    { kind: 'canceled', reason: 'User canceled' },
  ] as const) {
    const h = fixture([p]);
    assert.deepEqual(
      await completedTurnTimeline(h.api, { ...event, outcome }),
      p.entries.slice(2).map((e) => e.item),
    );
    assert.equal(h.calls(), 1);
  }
  assert.deepEqual(event.timeline, []);
});

test('turn history spans bounded pages without borrowing a preceding turn', async () => {
  const h = fixture([
    { ...page([entry(3), entry(4)]), hasOlder: true },
    page([entry(1, 'previous'), entry(2, event.turnId, 'user_message')]),
  ]);
  assert.deepEqual(await completedTurnTimeline(h.api, event), [
    entry(2, event.turnId, 'user_message').item,
    entry(3).item,
    entry(4).item,
  ]);
  assert.equal(h.calls(), 2);
});

test('progress cards without a turn ID do not obscure completion, even with overlapping update ranges', async () => {
  const progress = { ...entry(2, null, 'plugin'), seqEnd: 20 };
  const prompt = entry(3, event.turnId, 'user_message');
  const reply = entry(4);
  const h = fixture([page([entry(1, 'older'), progress, prompt, reply, entry(21, null, 'plugin')])]);
  assert.deepEqual(await completedTurnTimeline(h.api, event), [prompt.item, reply.item]);
});

test('plugin-only pages can precede the native turn and never count as completion evidence', async () => {
  const prompt = entry(2, event.turnId, 'user_message');
  const reply = entry(3);
  const h = fixture([
    { ...page([entry(5, null, 'plugin')]), hasOlder: true },
    { ...page([reply]), hasOlder: true },
    page([entry(1, null, 'plugin'), prompt]),
  ]);
  assert.deepEqual(await completedTurnTimeline(h.api, event), [prompt.item, reply.item]);
  assert.equal(await completedTurnTimeline(fixture([page([entry(1, null, 'plugin')])]).api, event), undefined);
});

test('missing identity, foreign workspace, changed workspace and failed reads retain uncertainty', async () => {
  const h = fixture([]);
  assert.equal(await completedTurnTimeline(h.api, { ...event, turnId: null }), undefined);
  assert.equal(
    await completedTurnTimeline(h.api, { ...event, agent: { ...event.agent, workspaceId: null } }),
    undefined,
  );
  assert.equal(h.calls(), 0);
  for (const scope of [['foreign'], [null], ['owner', 'foreign']])
    assert.equal(await completedTurnTimeline(fixture([page()], scope).api, event), undefined);
  assert.equal(await completedTurnTimeline(fixture([]).api, event), undefined);
});

test('incomplete history, foreign turns, missing IDs and extra user prompts never become receipts', async () => {
  for (const value of [
    { ...page(), error: { message: 'Failed' } },
    { ...page(), reset: true },
    { ...page(), gap: true },
    { ...page(), staleCursor: true },
    { ...page(), hasNewer: true },
    { ...page(), endCursor: undefined },
    { ...page(), entries: [] },
    page([entry(1), entry(2)]),
    page([entry(1, event.turnId, 'user_message'), entry(2, 'next')]),
    page([entry(1, null, 'user_message'), entry(2)]),
    page([entry(1, event.turnId, 'user_message'), entry(2, 'foreign'), entry(3)]),
    page([entry(1, event.turnId, 'user_message'), entry(2, event.turnId, 'user_message'), entry(3)]),
  ])
    assert.equal(await completedTurnTimeline(fixture([value]).api, event), undefined);
});

test('epoch changes, overlapping pages, missing/repeated cursors and the 1000-entry budget fail closed', async () => {
  const tail = { ...page([entry(3)]), hasOlder: true };
  const older = page([entry(1, event.turnId, 'user_message'), entry(2)]);
  for (const pages of [
    [tail, { ...older, endCursor: { epoch: 'changed', seq: 2 } }],
    [tail, page([entry(3)])],
    [{ ...tail, startCursor: undefined }],
    [tail, { ...page([entry(2)]), hasOlder: true, startCursor: tail.startCursor }],
    Array.from({ length: 10 }, (_, i) => ({ ...page([entry(1000 - i)]), hasOlder: true })),
  ]) {
    const h = fixture(pages);
    assert.equal(await completedTurnTimeline(h.api, event), undefined);
    assert.ok(h.calls() <= 10);
  }
});

test('a later active turn during history retrieval cannot be used for an earlier completion hook', async () => {
  const h = fixture([page()]);
  h.agent.activeTurn = { turnId: 'later-turn' };
  assert.equal(await completedTurnTimeline(h.api, event), undefined);
});
