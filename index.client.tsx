import type { PluginClientContext } from '@getpaseo/plugin/client';
import { TeamsPanel, ProgressCard } from './client/panel';
import { cardSchema } from './shared/contracts';
export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({ id: 'agent-teams', title: 'Agent Teams', icon: 'Workflow', context: 'workspace', locations: ['workspace', 'explorer'], Component: TeamsPanel });
  client.addCommandCenterItem({ id: 'open-agent-teams', title: 'Open Agent Teams', icon: 'Workflow', context: 'workspace', onSelect({ openPanel }) { openPanel('agent-teams'); } });
  client.addTimelineRenderer({ kind: 'agent-teams-progress', version: 1, schema: cardSchema, Component: ProgressCard });
  return () => {};
}
