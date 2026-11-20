import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { PluginClientContext, PluginWorkspacePanelProps } from '@getpaseo/plugin/client';
import { interfaceLanguage, translate } from '../shared/i18n';
import { TEAM_PROVIDER_ID } from '../shared/team-composition';
import { onLanguage, useT } from './i18n';

import { NEW_TEAM_PANEL } from './routes';

function NewTeam({
  workspaceId,
  theme,
  navigation,
  create,
}: PluginWorkspacePanelProps & {
  create(workspaceId: string, key: string): Promise<string>;
}) {
  const t = useT();
  const colors = theme.colors;
  const intent = useRef<string | undefined>(undefined);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [created, setCreated] = useState<string>();

  const start = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      intent.current ??= `new-team-${Date.now()}-${Math.random()}-${Math.random()}`;
      const agentId = created ?? (await create(workspaceId, intent.current));
      setCreated(agentId);
      if (navigation) {
        navigation.openAgent({ agentId });
        intent.current = undefined;
        setCreated(undefined);
      }
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={{ padding: 20, gap: 12, alignItems: 'flex-start' }}>
      <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: '600' }}>{t('Nouvelle équipe')}</Text>
      <Text style={{ color: colors.foregroundMuted }}>
        {t('Ouvrez une conversation Team Auto dans cet espace de travail.')}
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={busy || (!!created && !navigation)}
        accessibilityState={{ disabled: busy || (!!created && !navigation), busy }}
        onPress={() => void start()}
        style={{
          backgroundColor: colors.surface2,
          borderColor: colors.accent,
          borderWidth: 1,
          borderRadius: 8,
          padding: 12,
        }}
      >
        <Text style={{ color: colors.foreground, fontWeight: '600' }}>
          {busy
            ? t('Création de l’équipe…')
            : created
              ? t('Ouvrir la conversation')
              : t('Créer la conversation Team Auto')}
        </Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.foreground }}>
          {t('Impossible d’ouvrir la nouvelle équipe. Réessayez.')}
        </Text>
      ) : null}
      {created && !navigation ? (
        <Text style={{ color: colors.foregroundMuted }}>
          {t('Conversation créée. Retrouvez-la dans les onglets de cet espace.')}
        </Text>
      ) : null}
    </View>
  );
}

export function addNewTeam(client: PluginClientContext) {
  let disposed = false;
  let release: (() => Promise<void>) | undefined;
  let language = interfaceLanguage(client.i18n?.locale);
  const title = () => translate(language, 'Nouvelle équipe');
  const create = async (workspaceId: string, idempotencyKey: string) => {
    const agent = await client.paseo.workspaces.ref(workspaceId).agents.create({
      config: { provider: `${TEAM_PROVIDER_ID}/auto` },
      idempotencyKey,
    });
    return agent.id;
  };
  const panel = client.addWorkspacePanel({
    id: NEW_TEAM_PANEL,
    title: title(),
    icon: 'UsersRound',
    locations: ['workspace'],
    Component: (props) => <NewTeam key={props.workspaceId} {...props} create={create} />,
  });
  const buttons = new Map<string, ReturnType<typeof client.addHeaderButton>>();
  const remove = (workspaceId: string) => {
    buttons.get(workspaceId)?.remove();
    buttons.delete(workspaceId);
  };
  const apply = (workspaceId: string) => {
    if (disposed || buttons.has(workspaceId)) return;
    buttons.set(
      workspaceId,
      client.addHeaderButton({
        id: NEW_TEAM_PANEL,
        workspaceId,
        button: {
          title: title(),
          label: title(),
          icon: 'UsersRound',
          behavior: { kind: 'action', onPress: () => client.openPanel(NEW_TEAM_PANEL, { workspaceId }) },
        },
      }),
    );
  };
  const offLanguage = onLanguage((next) => {
    language = next;
    for (const button of buttons.values()) button.update({ title: title(), label: title() });
  });
  void client.paseo.workspaces
    .list({ subscribe: {} })
    .then(({ subscription }) => {
      if (disposed) return subscription.release();
      release = () => subscription.release();
      subscription.subscribe({
        snapshot({ entries }) {
          const ids = new Set(entries.map((workspace) => workspace.id));
          for (const workspaceId of buttons.keys()) if (!ids.has(workspaceId)) remove(workspaceId);
          for (const workspaceId of ids) apply(workspaceId);
        },
        update(message) {
          if (message.type !== 'workspace_update') return;
          if (message.payload.kind === 'remove') remove(message.payload.id);
          else apply(message.payload.workspace.id);
        },
      });
    })
    .catch((error) => {
      if (!disposed) console.error('Agent Teams workspace access:', error);
    });
  return () => {
    disposed = true;
    void release?.().catch(() => {});
    offLanguage();
    for (const workspaceId of buttons.keys()) remove(workspaceId);
    void panel();
  };
}
