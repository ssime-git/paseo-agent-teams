import type { PluginClientContext } from '@getpaseo/plugin/client';
import { settingsRpc } from '@getpaseo/plugin';
import { addNativeTimeline } from './client/native-timeline';
import { addThreadAccess } from './client/thread-access';
import { TeamCard } from './client/team-card';
import { TeamSettings } from './client/team-settings';
import { TEAM_SETTINGS_SCREEN } from './client/routes';
import { announceLanguage, onLanguage } from './client/language-signal';
import { teamSettings } from './shared/team-composition';
import { translator, type Language } from './shared/i18n';

/** Team Auto lives in the native thread; the plugin adds its settings screen, the Team pill and renderers. */
export default function contribute(client: PluginClientContext) {
  const removeSettings = client.addSettingsScreen({
    id: TEAM_SETTINGS_SCREEN,
    title: 'Agent Teams',
    icon: 'Workflow',
    Component: TeamSettings,
  });
  // The Command Center title is registered per language and replaced when the language changes.
  let removeCommand: (() => unknown) | undefined;
  let current: Language = 'fr';
  const register = (language: Language) => {
    current = language;
    void removeCommand?.();
    const t = translator(language);
    removeCommand = client.addCommandCenterItem({
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
    });
  };
  register(current);
  const removeLanguage = onLanguage(register);
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
  const removeNativeTimeline = addNativeTimeline(client);
  const removeThreadAccess = addThreadAccess(client, TeamCard);
  return () => {
    clearInterval(languageTimer);
    removeLanguage();
    void removeCommand?.();
    void removeSettings();
    removeNativeTimeline();
    removeThreadAccess();
  };
}
