import type { PluginClientContext } from '@getpaseo/plugin/client';
import { TeamsPanel, ProgressCard } from './client/panel';
import { cardSchema } from './shared/contracts';
import { addThreadAccess } from './client/thread-access';
export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: 'agent-teams',
    title: 'Agent Teams',
    icon: 'Workflow',
    context: 'workspace',
    locations: ['workspace', 'explorer'],
    Component: (props) => (
      <TeamsPanel
        {...props}
        onChooseRepository={async (path) => {
          const workspace = await client.paseo.workspaces.open(path);
          client.openPanel('agent-teams', { workspaceId: workspace.id });
        }}
      />
    ),
  });
  client.addCommandCenterItem({
    id: 'open-agent-teams',
    title: 'Open Agent Teams',
    icon: 'Workflow',
    context: 'workspace',
    onSelect({ openPanel }) {
      openPanel('agent-teams');
    },
  });
  client.addTimelineRenderer({ kind: 'agent-teams-progress', version: 1, schema: cardSchema, Component: ProgressCard });
  return addThreadAccess(client);
}
