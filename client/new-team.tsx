import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRpc, type PluginClientContext, type PluginWorkspacePanelProps } from '@getpaseo/plugin/client';
import { interfaceLanguage, translate } from '../shared/i18n';
import { TextInput } from '@getpaseo/plugin/client/ui';
import { roles, teamChoicesRpc, type Role } from '../shared/contracts';
import {
  roleMode,
  roleTitle,
  teamModelLabel,
  TEAM_PROVIDER_ID,
  type TeamProviderChoice,
} from '../shared/team-composition';
import { onLanguage, useT } from './i18n';

import { NEW_TEAM_PANEL } from './routes';

type TeamModels = Partial<Record<Role, string>>;

function NewTeam({
  workspaceId,
  theme,
  navigation,
  create,
}: PluginWorkspacePanelProps & {
  create(workspaceId: string, key: string, models: TeamModels): Promise<string>;
}) {
  const t = useT();
  const colors = theme.colors;
  const intent = useRef<string | undefined>(undefined);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [created, setCreated] = useState<string>();
  const [editing, setEditing] = useState<Role>();
  const [search, setSearch] = useState('');
  const [models, setModels] = useState<TeamModels>({});
  const [choices, setChoices] = useState<TeamProviderChoice[]>();
  const [catalogError, setCatalogError] = useState(false);
  const catalog = useRpc(teamChoicesRpc);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  useEffect(() => {
    let live = true;
    catalogRef.current({ workspaceId }).then(
      (value) => {
        if (live) setChoices(value);
      },
      () => {
        if (live) setCatalogError(true);
      },
    );
    return () => {
      live = false;
    };
  }, [workspaceId]);

  const start = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      intent.current ??= `new-team-${Date.now()}-${Math.random()}-${Math.random()}`;
      const agentId = created ?? (await create(workspaceId, intent.current, models));
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
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: '600' }}>{t('Nouvelle équipe')}</Text>
      <Text style={{ color: colors.foregroundMuted }}>
        {t('Ouvrez une conversation Team Auto dans cet espace de travail.')}
      </Text>
      {choices ? (
        <View style={{ gap: 8, maxWidth: 640 }}>
          {roles.map((role) => {
            const options = choices.flatMap((provider) =>
              provider.id !== TEAM_PROVIDER_ID && roleMode(provider, role)
                ? provider.models.map((model) => ({
                    value: `${provider.id}/${model.id}`,
                    label: `${provider.label ?? provider.id} · ${teamModelLabel(model.id, model.label)}`,
                  }))
                : [],
            );
            const defaultModel = { value: '', label: t('Modèle par défaut') };
            const selected = options.find((option) => option.value === models[role]) ?? defaultModel;
            const expanded = editing === role;
            const query = search.trim().toLowerCase();
            const results = options.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(query));
            return (
              <View key={role} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t(roleTitle[role])}: ${selected.label}`}
                  accessibilityState={{ expanded }}
                  disabled={busy || !!created}
                  onPress={() => {
                    setSearch('');
                    setEditing(expanded ? undefined : role);
                  }}
                  style={{ padding: 12, gap: 4 }}
                >
                  <Text style={{ color: colors.foreground, fontWeight: '600' }}>{t(roleTitle[role])}</Text>
                  <Text style={{ color: colors.foregroundMuted }}>{selected.label}</Text>
                </Pressable>
                {expanded ? (
                  <View style={{ padding: 12, gap: 4 }}>
                    <TextInput
                      accessibilityLabel={t('Rechercher un modèle')}
                      placeholder={t('Rechercher un modèle')}
                      value={search}
                      onChangeText={setSearch}
                      style={{
                        padding: 10,
                        color: colors.foreground,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 8,
                      }}
                    />
                    {query && !results.length ? (
                      <Text style={{ color: colors.foregroundMuted }}>{t('Aucun modèle trouvé.')}</Text>
                    ) : null}
                    {[defaultModel, ...results].map(({ value, label }) => (
                      <Pressable
                        key={value}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected.value === value }}
                        disabled={busy}
                        onPress={() => {
                          if (inFlight.current) return;
                          intent.current = undefined;
                          setModels((previous) => ({ ...previous, [role]: value }));
                          setEditing(undefined);
                        }}
                        style={{ padding: 12 }}
                      >
                        <Text style={{ color: colors.foreground }}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={{ color: colors.foregroundMuted }}>
          {catalogError ? t('Catalogue des modèles indisponible.') : t('Recherche des modèles disponibles…')}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy || (!!created && !navigation)}
        accessibilityState={{ disabled: busy || (!!created && !navigation), busy }}
        onPress={() => void start()}
        style={{
          alignSelf: 'flex-start',
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
    </ScrollView>
  );
}

export function addNewTeam(client: PluginClientContext) {
  let disposed = false;
  let release: (() => Promise<void>) | undefined;
  let language = interfaceLanguage(client.i18n?.locale);
  const title = () => translate(language, 'Nouvelle équipe');
  const create = async (workspaceId: string, idempotencyKey: string, models: TeamModels) => {
    const options = Object.fromEntries(Object.entries(models).filter(([, model]) => model));
    const agent = await client.paseo.workspaces.ref(workspaceId).agents.create({
      config: { provider: `${TEAM_PROVIDER_ID}/auto`, ...(Object.keys(options).length ? { options } : {}) },
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
