import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PluginClientContext } from '@getpaseo/plugin/client';
import { addThreadAccess } from '../client/thread-access';

test('thread buttons open the correct workspace, deduplicate updates and disappear on removal or disposal', async () => {
  type Agent = { id: string; workspaceId?: string; provider?: string };
  let observer!: {
    snapshot(value: { entries: { agent: Agent }[] }): void;
    update(value: { type: string; payload: { kind: string; agent?: Agent; agentId?: string } }): void;
  };
  const registrations: {
    agentId: string;
    workspaceId: string;
    button: {
      label: string;
      behavior: { kind: string; Content(props: object): { props: Record<string, () => void> } };
    };
    removed: boolean;
  }[] = [];
  const opened: unknown[] = [];
  let signal!: AbortSignal;
  const sent: unknown[] = [];
  const owner = {
    workspaceId: 'w1',
    status: 'idle',
    activeTurn: null as unknown,
    pendingPermissions: [] as unknown[],
    refresh: async () => true,
    send: async (...args: unknown[]) => {
      sent.push(args);
    },
  };
  const client = {
    paseo: {
      agents: {
        ref(id: string) {
          assert.equal(id, 'a');
          return owner;
        },
        list: async (input: { signal: AbortSignal }) => {
          signal = input.signal;
          return {
            subscription: {
              subscribe(value: typeof observer) {
                observer = value;
              },
            },
          };
        },
      },
    },
    addComposerPill(input: (typeof registrations)[number]) {
      const entry = { ...input, removed: false };
      registrations.push(entry);
      return {
        remove() {
          entry.removed = true;
        },
      };
    },
    openPanel(id: string, options: unknown) {
      opened.push({ id, options });
    },
    openSettings(id: string) {
      opened.push({ settings: id });
    },
  } as unknown as PluginClientContext;
  const Card = () => null;
  const dispose = addThreadAccess(client, Card);
  await Promise.resolve();
  const team = 'agent-teams/auto';
  observer.snapshot({
    entries: [
      { agent: { id: 'a', workspaceId: 'w1', provider: team } },
      { agent: { id: 'claude-thread', workspaceId: 'w1', provider: 'claude/opus' } },
      { agent: { id: 'unassigned', provider: team } },
    ],
  });
  observer.update({
    type: 'agent_update',
    payload: { kind: 'upsert', agent: { id: 'a', workspaceId: 'w1', provider: team } },
  });
  assert.equal(registrations.length, 1); // Only the Team Auto thread gets the Team pill.
  assert.equal(registrations[0].button.label, 'Équipe');
  const content = registrations[0].button.behavior.Content({}) as { props: Record<string, () => void> };
  const show = content.props.showGraphs as unknown as () => Promise<void>;
  assert.deepEqual(sent, []); // No prompt on registration or render.
  await show();
  assert.deepEqual(sent, [['/team-graphs', { activeTurnBehavior: 'steer' }]]);
  for (const change of [
    { status: 'running' },
    { activeTurn: { id: 'turn' } },
    { pendingPermissions: [{}] },
    { workspaceId: 'moved' },
  ]) {
    const original = { ...owner };
    Object.assign(owner, change);
    await assert.rejects(show(), /inactive/);
    Object.assign(owner, original);
  }
  assert.equal(sent.length, 1);
  content.props.openSettings();
  assert.deepEqual(opened, [{ settings: 'agent-teams' }]);
  observer.update({
    type: 'agent_update',
    payload: { kind: 'upsert', agent: { id: 'a', workspaceId: 'w2', provider: team } },
  });
  assert.equal(registrations[0].removed, true);
  assert.equal(registrations[1].workspaceId, 'w2');
  observer.snapshot({ entries: [{ agent: { id: 'b', workspaceId: 'w3', provider: team } }] });
  assert.equal(registrations[1].removed, true);
  observer.update({ type: 'agent_update', payload: { kind: 'remove', agentId: 'b' } });
  assert.equal(registrations[2].removed, true);
  observer.snapshot({ entries: [{ agent: { id: 'c', workspaceId: 'w4', provider: team } }] });
  dispose();
  assert.equal(signal.aborted, true);
  assert.ok(registrations.every((r) => r.removed));
  observer.update({
    type: 'agent_update',
    payload: { kind: 'upsert', agent: { id: 'd', workspaceId: 'w5', provider: team } },
  });
  assert.equal(registrations.length, 4);
});
