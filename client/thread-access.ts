import { createElement } from 'react';
import { onLanguage } from './language-signal';
import { translate } from '../shared/i18n';
import { TEAM_PROVIDER_ID } from '../shared/team-composition';
import { TEAM_SETTINGS_SCREEN } from './routes';
import type { ComponentType } from 'react';
import type { PluginClientContext, PluginButtonContentProps, PluginButtonRegistration } from '@getpaseo/plugin/client';

/** The Team pill appears only in Team Auto threads; other harness threads stay untouched. */
export function addThreadAccess(
  client: PluginClientContext,
  Card: ComponentType<PluginButtonContentProps & { openSettings(): void }>,
) {
  const lifetime = new AbortController();
  let label = translate('fr', 'Équipe');
  const removeLanguage = onLanguage((language) => {
    label = translate(language, 'Équipe');
    for (const { button } of pills.values()) button.update({ title: label, label });
  });
  const pills = new Map<string, { workspaceId: string; button: PluginButtonRegistration }>();
  const remove = (id: string) => {
    pills.get(id)?.button.remove();
    pills.delete(id);
  };
  const apply = (agent: { id: string; workspaceId?: string | null; provider?: string | null }) => {
    if (lifetime.signal.aborted) return;
    if (!agent.workspaceId || agent.provider?.split('/')[0] !== TEAM_PROVIDER_ID) {
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
          title: label,
          label,
          icon: 'Workflow',
          behavior: {
            kind: 'popover',
            Content: (props: PluginButtonContentProps) =>
              createElement(Card, {
                ...props,
                openSettings: () => client.openSettings(TEAM_SETTINGS_SCREEN),
              }),
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
    removeLanguage();
    lifetime.abort();
    for (const id of pills.keys()) remove(id);
  };
}
