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
import { settingsRpc } from '@getpaseo/plugin';
import { teamSettings } from './shared/team-composition';
import { translator, type Language } from './shared/i18n';
import { announceLanguage, onLanguage } from './client/language-signal';
export default function contribute(client: PluginClientContext) {
  // Titles are registered once per language and replaced when the language setting changes.
  let titled: (() => unknown)[] = [];
  const register = (language: Language) => {
    for (const remove of titled) void remove();
    const t = translator(language);
    titled = [
      client.addScreen({
        id: HISTORY_SCREEN,
        title: t('Agent Teams · Historique'),
        Component: (props) => (
          <WorkflowHistory
            key={props.params.id ?? 'index'}
            {...props}
            onSelect={(id) => client.openScreen({ screenId: HISTORY_SCREEN, params: id ? { id } : {} })}
          />
        ),
      }),
      client.addCommandCenterItem({
        id: HISTORY_SCREEN,
        title: t('Agent Teams · Historique'),
        icon: 'History',
        keywords: ['Agent Teams', 'fermés', 'closed', 'workflow history', 'historique'],
        context: 'global',
        onSelect: ({ openScreen }) => openScreen({ screenId: HISTORY_SCREEN }),
      }),
      client.addSettingsScreen({
        id: TEAM_SETTINGS_SCREEN,
        title: 'Agent Teams',
        icon: 'Workflow',
        Component: TeamSettings,
      }),
      client.addCommandCenterItem({
        id: 'agent-teams-settings',
        title: t('Agent Teams · Équipe par défaut'),
        icon: 'Settings',
        keywords: [
          'Agent Teams',
          'Team Auto',
          'modèles',
          'models',
          'équipe',
          'team',
          'réglages',
          'settings',
          'langue',
          'language',
        ],
        context: 'global',
        onSelect: ({ openSettings }) => openSettings(TEAM_SETTINGS_SCREEN),
      }),
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
      }),
      client.addCommandCenterItem({
        id: 'open-agent-teams',
        title: t('Agent Teams · Options avancées'),
        icon: 'Workflow',
        keywords: ['Agent Teams', 'Manual Switch', 'panneau', 'panel', 'workflow'],
        context: 'workspace',
        onSelect({ openPanel }) {
          openPanel('agent-teams');
        },
      }),
    ];
  };
  let current: Language = 'fr';
  register(current);
  const removeLanguage = onLanguage((language) => {
    current = language;
    register(language);
  });
  // Another client can change the language: follow the host setting without a reload.
  const followLanguage = () =>
    void client
      .rpc(settingsRpc(teamSettings.id).read, {})
      .then((state) => {
        const language = state.status === 'ready' ? (state.values as { language?: Language }).language : undefined;
        if (language && language !== current) announceLanguage(language);
      })
      .catch(() => {});
  followLanguage();
  const languageTimer = setInterval(followLanguage, 10_000);
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
    clearInterval(languageTimer);
    removeLanguage();
    for (const remove of titled) void remove();
    removeNativeTimeline();
    removeCreationAccess();
    removeThreadAccess();
  };
}
