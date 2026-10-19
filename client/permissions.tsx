import { Pressable, ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRpc, type PluginHostProps } from '@getpaseo/plugin/client';
import { permissionsRpc, type Action, type Workflow } from '../shared/contracts';
import { errorMessage } from './errors';

export function TeamPermissions({
  workflow,
  theme,
  host,
  busy,
  onAction,
}: PluginHostProps & {
  workflow: Workflow;
  busy: boolean;
  onAction(action: Action['action'], extra?: Partial<Action>): Promise<void> | undefined;
}) {
  const call = useRpc(permissionsRpc),
    c = theme.colors;
  const query = useQuery({
    queryKey: ['team-permissions', host.id, workflow.id],
    queryFn: () => call({ id: workflow.id, workspaceId: workflow.workspaceId }),
    refetchInterval: 2000,
  });
  const button = (label: string, press: () => void, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy || disabled}
      onPress={press}
      style={{
        padding: 10,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 6,
        opacity: busy || disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: c.foreground }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ padding: 12, gap: 10, borderWidth: 1, borderColor: c.statusWarning, borderRadius: 8 }}>
      <Text accessibilityRole="header" style={{ color: c.foreground, fontWeight: '600' }}>
        Permissions de l’équipe
      </Text>
      {query.error ? (
        <Text accessibilityRole="alert" style={{ color: c.statusDanger }}>
          {errorMessage(query.error)}
        </Text>
      ) : null}
      {query.isLoading ? <Text style={{ color: c.foregroundMuted }}>Chargement des permissions…</Text> : null}
      {query.data?.map((request) => (
        <View key={request.id} style={{ gap: 8 }}>
          <Text style={{ color: c.foreground }}>
            {request.role} · {request.title}
          </Text>
          {request.description ? <Text style={{ color: c.foregroundMuted }}>{request.description}</Text> : null}
          {request.details !== '{}' ? (
            <ScrollView style={{ maxHeight: 160 }}>
              <Text selectable style={{ color: c.foregroundMuted, fontFamily: 'monospace', fontSize: 11 }}>
                {request.details}
              </Text>
            </ScrollView>
          ) : null}
          {!request.canAllow ? (
            <Text style={{ color: c.foregroundMuted }}>
              Ce rôle doit rester en lecture seule. Refusez le changement de mode natif.
            </Text>
          ) : null}
          {request.kind === 'question' && !request.actions.length ? (
            <Text style={{ color: c.foregroundMuted }}>Répondez à cette question dans la session native du rôle.</Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(request.actions.length
              ? request.actions
              : [
                  { id: '', label: 'Autoriser', behavior: 'allow' as const },
                  { id: '', label: 'Refuser', behavior: 'deny' as const },
                ]
            ).map((action) =>
              button(
                `${action.label} · ${request.title}`,
                () => {
                  void onAction('permission', {
                    permissionId: request.id,
                    behavior: action.behavior,
                    ...(action.id ? { selectedActionId: action.id } : {}),
                  });
                },
                action.behavior === 'allow' &&
                  (!request.canAllow || (request.kind === 'question' && !request.actions.length)),
              ),
            )}
          </View>
        </View>
      ))}
      {query.data?.length === 0 ? (
        <>
          <Text style={{ color: c.foregroundMuted }}>
            Aucune permission native en attente. Reprenez pour réconcilier le tour terminé ; aucun prompt ne sera
            renvoyé.
          </Text>
          {button('Reprendre après résolution des permissions', () => {
            void onAction('resume');
          })}
        </>
      ) : null}
      {button('Actualiser les permissions', () => {
        void query.refetch();
      })}
    </View>
  );
}
