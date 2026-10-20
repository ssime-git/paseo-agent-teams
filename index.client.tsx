import type { PluginClientContext } from '@getpaseo/plugin/client';
import { showTeamWorkflow } from './client/drafts';
import { addNativeTimeline } from './client/native-timeline';
import { TeamsPanel, ProgressCard } from './client/panel';
import { cardSchema } from './shared/contracts';
import { addThreadAccess } from './client/thread-access';
import { QuickStart } from './client/quick-start';
import { NEW_TEAM_SCREEN, NewTeamSidebar, NewTeamWorkspace } from './client/new-workspace';
import { addCreationAccess } from './client/new-workspace-pill';
import { WorkflowHistory, HistorySidebar } from './client/history';
import { HISTORY_SCREEN } from './client/routes';
export default function contribute(client: PluginClientContext) {
  client.addScreen({
    id: HISTORY_SCREEN,
    title: 'Historique des workflows',
    Component: (props) => (
      <WorkflowHistory
        key={props.params.id ?? 'index'}
        {...props}
        onSelect={(id) => client.openScreen({ screenId: HISTORY_SCREEN, params: id ? { id } : {} })}
      />
    ),
  });
  client.addSidebarHeaderItem({ id: HISTORY_SCREEN, title: 'Historique des workflows', Component: HistorySidebar });
  client.addCommandCenterItem({
    id: HISTORY_SCREEN,
    title: 'Historique des workflows',
    icon: 'History',
    keywords: ['Agent Teams', 'fermés', 'workflow history'],
    context: 'global',
    onSelect: ({ openScreen }) => openScreen({ screenId: HISTORY_SCREEN }),
  });
  client.addScreen({
    id: NEW_TEAM_SCREEN,
    title: 'Nouveau workspace agent',
    Component: (props) => (
      <NewTeamWorkspace {...props} onOpen={(workspaceId) => client.openPanel('agent-teams', { workspaceId })} />
    ),
  });
  client.addSidebarHeaderItem({
    id: 'new-agent-workspace',
    title: 'Nouveau workspace agent',
    Component: NewTeamSidebar,
  });
  client.addCommandCenterItem({
    id: 'new-agent-workspace',
    title: 'Nouveau workspace agent',
    icon: 'Workflow',
    keywords: ['mode agent', 'Agent Teams', 'new workspace', 'équipe', 'workflow'],
    context: 'global',
    onSelect: ({ openScreen }) => openScreen({ screenId: NEW_TEAM_SCREEN }),
  });
  client.addWorkspacePanel({
    id: 'agent-teams',
    title: 'Agent Teams',
    icon: 'Workflow',
    context: 'workspace',
    locations: ['workspace', 'explorer'],
    Component: (props) => (
      <TeamsPanel
        {...props}
        onOpenHistory={() => client.openScreen({ screenId: HISTORY_SCREEN })}
        onOpenWorkspace={(workspaceId) => client.openPanel('agent-teams', { workspaceId })}
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
  client.addTimelineRenderer({
    kind: 'agent-teams-progress',
    version: 1,
    schema: cardSchema,
    Component: (props) => (
      <ProgressCard
        {...props}
        onOpenWorkflow={
          props.item.data.workspaceId
            ? () => {
                if (props.item.data.status.split(' · ').at(-1) === 'completed')
                  client.openScreen({ screenId: HISTORY_SCREEN, params: { id: props.item.data.workflowId } });
                else {
                  showTeamWorkflow(`${props.host.id}:${props.item.data.workspaceId}`, props.item.data.workflowId);
                  client.openPanel('agent-teams', { workspaceId: props.item.data.workspaceId! });
                }
              }
            : undefined
        }
      />
    ),
  });
  const removeNativeTimeline = addNativeTimeline(client);
  const removeCreationAccess = addCreationAccess(client);
  const removeThreadAccess = addThreadAccess(client, QuickStart);
  return () => {
    removeNativeTimeline();
    removeCreationAccess();
    removeThreadAccess();
  };
}
