import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PluginClientContext } from '@getpaseo/plugin/client';
import { addThreadAccess } from '../client/thread-access';

test('thread buttons open the correct workspace, deduplicate updates and disappear on removal or disposal', async () => {
  type Agent = { id: string; workspaceId?: string };
  let observer!: {
    snapshot(value: { entries: { agent: Agent }[] }): void;
    update(value: { type: string; payload: { kind: string; agent?: Agent; agentId?: string } }): void;
  };
  const registrations: {
    agentId: string;
    workspaceId: string;
    button: { behavior: { onPress(): void } };
    removed: boolean;
  }[] = [];
  const opened: unknown[] = [];
  let signal!: AbortSignal;
  const client = {
    paseo: {
      agents: {
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
  } as unknown as PluginClientContext;
  const dispose = addThreadAccess(client);
  await Promise.resolve();
  observer.snapshot({ entries: [{ agent: { id: 'a', workspaceId: 'w1' } }, { agent: { id: 'unassigned' } }] });
  observer.update({ type: 'agent_update', payload: { kind: 'upsert', agent: { id: 'a', workspaceId: 'w1' } } });
  assert.equal(registrations.length, 1);
  registrations[0].button.behavior.onPress();
  assert.deepEqual(opened, [{ id: 'agent-teams', options: { workspaceId: 'w1' } }]);
  observer.update({ type: 'agent_update', payload: { kind: 'upsert', agent: { id: 'a', workspaceId: 'w2' } } });
  assert.equal(registrations[0].removed, true);
  assert.equal(registrations[1].workspaceId, 'w2');
  observer.snapshot({ entries: [{ agent: { id: 'b', workspaceId: 'w3' } }] });
  assert.equal(registrations[1].removed, true);
  observer.update({ type: 'agent_update', payload: { kind: 'remove', agentId: 'b' } });
  assert.equal(registrations[2].removed, true);
  observer.snapshot({ entries: [{ agent: { id: 'c', workspaceId: 'w4' } }] });
  dispose();
  assert.equal(signal.aborted, true);
  assert.ok(registrations.every((r) => r.removed));
  observer.update({ type: 'agent_update', payload: { kind: 'upsert', agent: { id: 'd', workspaceId: 'w5' } } });
  assert.equal(registrations.length, 4);
});
