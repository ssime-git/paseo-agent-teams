import { createElement } from 'react';
import type { ComponentType } from 'react';
import type { PluginClientContext, PluginButtonContentProps, PluginButtonRegistration } from '@getpaseo/plugin/client';

export function addThreadAccess(
  client: PluginClientContext,
  QuickStart?: ComponentType<PluginButtonContentProps & { openPanel(): void }>,
) {
  const lifetime = new AbortController();
  const pills = new Map<string, { workspaceId: string; button: PluginButtonRegistration }>();
  const remove = (id: string) => {
    pills.get(id)?.button.remove();
    pills.delete(id);
  };
  const apply = (agent: { id: string; workspaceId?: string | null }) => {
    if (lifetime.signal.aborted) return;
    if (!agent.workspaceId) {
      remove(agent.id);
      return;
    }
    if (pills.get(agent.id)?.workspaceId === agent.workspaceId) return;
    remove(agent.id);
    const workspaceId = agent.workspaceId;
    pills.set(agent.id, {
      workspaceId,
      button: client.addComposerPill({
        id: 'agent-teams',
        workspaceId,
        agentId: agent.id,
        button: {
          title: QuickStart ? 'Mode agent' : 'Ouvrir Agent Teams',
          label: QuickStart ? 'Mode agent' : 'Agent Teams',
          icon: 'Workflow',
          behavior: QuickStart
            ? {
                kind: 'popover',
                Content: (props: PluginButtonContentProps) =>
                  createElement(QuickStart, {
                    ...props,
                    openPanel: (target?: string) =>
                      client.openPanel('agent-teams', { workspaceId: target ?? workspaceId }),
                  }),
              }
            : {
                kind: 'menu',
                items: [
                  {
                    kind: 'item',
                    id: 'open',
                    title: 'Ouvrir le panneau',
                    icon: 'Workflow',
                    behavior: { kind: 'action', onPress: () => client.openPanel('agent-teams', { workspaceId }) },
                  },
                ],
              },
        },
      }),
    });
  };
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) return;
      subscription.subscribe({
        snapshot({ entries }) {
          const ids = new Set(entries.map(({ agent }) => agent.id));
          for (const id of pills.keys()) if (!ids.has(id)) remove(id);
          for (const { agent } of entries) apply(agent);
        },
        update(message) {
          if (message.type !== 'agent_update' || lifetime.signal.aborted) return;
          if (message.payload.kind === 'remove') remove(message.payload.agentId);
          else apply(message.payload.agent);
        },
      });
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) console.error('Agent Teams thread access:', error);
    });
  return () => {
    lifetime.abort();
    for (const id of pills.keys()) remove(id);
  };
}
