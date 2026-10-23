import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRpc, useSettings, type PluginButtonContentProps } from '@getpaseo/plugin/client';
import { listRpc, teamChoicesRpc, type Workflow } from '../shared/contracts';
import { defaultTeam, teamSettings, type TeamProviderChoice } from '../shared/team-composition';
import { TeamRoster } from './team-roster';
import { useT } from './i18n';

/** The Team Auto composer pill: who is on the team and who has control. The mission itself is the thread. */
export function TeamCard(props: PluginButtonContentProps & { openSettings(): void; openPanel(): void }) {
  const { theme, workspaceId, layout, close, openSettings, openPanel } = props;
  const agentId = props.context === 'agent' ? props.agentId : undefined;
  const c = theme.colors;
  const t = useT();
  const listCall = useRpc(listRpc),
    choicesCall = useRpc(teamChoicesRpc);
  const settings = useSettings(teamSettings);
  const [choices, setChoices] = useState<TeamProviderChoice[]>([]);
  const [workflow, setWorkflow] = useState<Workflow>();
  useEffect(() => {
    let live = true;
    choicesCall({})
      .then((value) => live && setChoices(value))
      .catch(() => {});
    const refresh = () =>
      listCall({ workspaceId })
        .then((list) => {
          if (!live || !agentId) return;
          setWorkflow(
            list.findLast((w) =>
              Object.keys(w.requests ?? {}).some((key) => key.startsWith(`create:team:${agentId}:`)),
            ),
          );
        })
        .catch(() => {});
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [workspaceId, agentId]);
  const roles =
    workflow?.config.roles ?? defaultTeam(choices, settings.status === 'ready' ? settings.values : undefined);
  const link = (label: string, onPress: () => void, muted = false) => (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        close();
        onPress();
      }}
      style={{ paddingVertical: 6 }}
    >
      <Text style={{ color: muted ? c.foregroundMuted : c.accent, fontSize: 13, fontWeight: muted ? '400' : '600' }}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View style={{ width: layout.compact ? undefined : 400, padding: 16, gap: 14 }}>
      <View style={{ gap: 4 }}>
        {/* On compact layouts the host sheet already shows the pill title. */}
        {layout.compact ? null : (
          <Text style={{ color: c.foreground, fontSize: 15, fontWeight: '600' }}>{t('Équipe')}</Text>
        )}
        {workflow ? null : (
          <Text style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
            {t(
              'Équipe par défaut. Décrivez la mission dans le composer ; pour cette conversation, les rôles restent réglables jusqu’au premier message.',
            )}
          </Text>
        )}
      </View>
      <TeamRoster
        t={t}
        config={{ roles }}
        providers={choices}
        workflow={workflow}
        colors={c}
        compact={layout.compact}
      />
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          columnGap: 18,
          borderTopWidth: 1,
          borderTopColor: c.border,
          paddingTop: 8,
        }}
      >
        {link(t('Modifier l’équipe par défaut'), openSettings)}
        {link(t('Options avancées'), openPanel, true)}
      </View>
    </View>
  );
}
