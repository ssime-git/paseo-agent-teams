import type { PluginClientContext } from '@getpaseo/plugin/client';
import { showTeamWorkflow } from './client/drafts';
import { addNativeTimeline } from './client/native-timeline';
import { TeamsPanel, ProgressCard } from './client/panel';
import { cardSchema } from './shared/contracts';
import { addThreadAccess } from './client/thread-access';
import { TeamCard } from './client/team-card';
import { TeamSettings } from './client/team-settings';
import { addCreationAccess } from './client/new-workspace-pill';
import { WorkflowHistory } from './client/history';
import { HISTORY_SCREEN, TEAM_SETTINGS_SCREEN } from './client/routes';
export default function contribute(client: PluginClientContext) {
  client.addScreen({
    id: HISTORY_SCREEN,
    title: 'Agent Teams · Historique',
    Component: (props) => (
      <WorkflowHistory
        key={props.params.id ?? 'index'}
        {...props}
        onSelect={(id) => client.openScreen({ screenId: HISTORY_SCREEN, params: id ? { id } : {} })}
      />
    ),
  });
  client.addCommandCenterItem({
    id: HISTORY_SCREEN,
    title: 'Agent Teams · Historique',
    icon: 'History',
    keywords: ['Agent Teams', 'fermés', 'workflow history'],
    context: 'global',
    onSelect: ({ openScreen }) => openScreen({ screenId: HISTORY_SCREEN }),
  });
  client.addSettingsScreen({
    id: TEAM_SETTINGS_SCREEN,
    title: 'Agent Teams',
    icon: 'Workflow',
    Component: TeamSettings,
  });
  client.addCommandCenterItem({
    id: 'agent-teams-settings',
    title: 'Agent Teams · Équipe par défaut',
    icon: 'Settings',
    keywords: ['Agent Teams', 'Team Auto', 'modèles', 'équipe', 'réglages'],
    context: 'global',
    onSelect: ({ openSettings }) => openSettings(TEAM_SETTINGS_SCREEN),
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
    title: 'Agent Teams · Options avancées',
    icon: 'Workflow',
    keywords: ['Agent Teams', 'Manual Switch', 'panneau', 'workflow'],
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
  const removeThreadAccess = addThreadAccess(client, TeamCard);
  return () => {
    removeNativeTimeline();
    removeCreationAccess();
    removeThreadAccess();
  };
}
