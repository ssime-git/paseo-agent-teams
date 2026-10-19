import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRpc, type PluginScreenProps, type PluginSidebarItemProps } from '@getpaseo/plugin/client';
import { SidebarRow } from '@getpaseo/plugin/client/ui';
import { workflowIndexRpc, workflowRecordRpc } from '../shared/contracts';
import { HISTORY_SCREEN } from './routes';
import { Markdown } from './markdown';
import { TestLog } from './test-log';
import { renderEvent } from './events';
import { errorMessage } from './errors';

export function HistorySidebar({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="History"
      active={currentScreen?.screenId === HISTORY_SCREEN}
      onPress={() => openScreen({ screenId: HISTORY_SCREEN })}
    />
  );
}

/** Saved records are readable without resolving the workspace or starting any agents. */
export function WorkflowHistory({
  theme,
  host,
  params,
  navigation,
  onSelect,
}: PluginScreenProps & { onSelect(id?: string): void }) {
  const indexCall = useRpc(workflowIndexRpc),
    recordCall = useRpc(workflowRecordRpc);
  const selected = params.id ?? '';
  const [search, setSearch] = useState('');
  const c = theme.colors;
  const index = useQuery({ queryKey: ['team-history', host.id], queryFn: () => indexCall({}), refetchInterval: 5000 });
  const record = useQuery({
    queryKey: ['team-record', host.id, selected],
    queryFn: () => recordCall({ id: selected }),
    enabled: !!selected,
    refetchInterval: (query) => (selected && query.state.data?.status !== 'completed' ? 5000 : false),
  });
  const w = record.data;
  const button = (label: string, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ padding: 10, borderWidth: 1, borderColor: c.border, borderRadius: 6 }}
    >
      <Text style={{ color: c.foreground }}>{label}</Text>
    </Pressable>
  );
  const bullets = (values: string[]) => values.map((value) => `- ${value}`).join('\n');
  const section = (title: string, source: string) => (
    <View style={{ padding: 14, gap: 8, borderWidth: 1, borderColor: c.border, borderRadius: 8 }}>
      <Text accessibilityRole="header" style={{ color: c.foreground, fontWeight: '600' }}>
        {title}
      </Text>
      <Markdown source={source} colors={c} />
    </View>
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={{ color: c.foreground, fontSize: 22, fontWeight: '600' }}>
        Historique des workflows
      </Text>
      <Text style={{ color: c.foregroundMuted }}>
        {host.label} · Tous les workspaces, y compris les workflows fermés.
      </Text>
      {button('Actualiser l’historique', () => {
        void index.refetch();
        if (selected) void record.refetch();
      })}
      {selected ? (
        button('Retour à la liste des workflows', () => onSelect())
      ) : (
        <TextInput
          accessibilityLabel="Rechercher un workflow"
          value={search}
          onChangeText={setSearch}
          placeholder="Rechercher par tâche, dossier ou identifiant"
          placeholderTextColor={c.foregroundMuted}
          style={{ padding: 12, color: c.foreground, borderWidth: 1, borderColor: c.border, borderRadius: 8 }}
        />
      )}
      {index.error || (selected && record.error) ? (
        <Text accessibilityRole="alert" style={{ color: c.statusDanger }}>
          {errorMessage(index.error ?? record.error)}
        </Text>
      ) : null}
      {!selected ? (
        <>
          {index.isLoading ? <Text style={{ color: c.foregroundMuted }}>Chargement…</Text> : null}
          {index.data?.length === 0 ? (
            <Text style={{ color: c.foregroundMuted }}>Aucun workflow enregistré.</Text>
          ) : null}
          {index.data
            ?.filter((item) => `${item.task} ${item.cwd} ${item.id}`.toLowerCase().includes(search.toLowerCase()))
            .map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Ouvrir le workflow ${item.id}`}
                onPress={() => onSelect(item.id)}
                style={{ padding: 14, gap: 6, borderWidth: 1, borderColor: c.border, borderRadius: 8 }}
              >
                <Text style={{ color: c.foreground, fontWeight: '600' }}>{item.task}</Text>
                <Text style={{ color: c.foregroundMuted }}>
                  {item.closed ? 'Fermé' : item.status === 'completed' ? 'Terminé' : item.status} · {item.phase} ·{' '}
                  {item.id.slice(0, 8)}
                </Text>
                <Text style={{ color: c.foregroundMuted }}>{item.cwd}</Text>
                <Text style={{ color: c.foregroundMuted }}>
                  {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : ''}
                </Text>
              </Pressable>
            ))}
        </>
      ) : !w ? (
        <Text style={{ color: c.foregroundMuted }}>Chargement du workflow…</Text>
      ) : (
        <>
          <Text style={{ color: c.foreground, fontWeight: '600' }}>
            {w.closed ? 'Workflow fermé' : w.status} · correction {w.cycle}
          </Text>
          <Text selectable style={{ color: c.foregroundMuted }}>
            {w.cwd} · {w.id}
          </Text>
          {section('Tâche', w.task)}
          {w.plan
            ? section(
                'Plan',
                `${w.plan.summary}\n\n### Tâches\n${bullets(w.plan.tasks)}\n\n### Critères d’acceptation\n${bullets(w.plan.acceptance)}\n\n### Tests prévus\n${bullets(w.plan.tests.map((test) => test.command))}`,
              )
            : null}
          {w.build
            ? section(
                'Implémentation',
                `${w.build.summary}\n\n${bullets(w.build.changes)}\n\n### Travail restant\n${bullets(w.build.remaining)}`,
              )
            : null}
          {w.review
            ? section(`Review · ${w.review.verdict}`, `${w.review.summary}\n\n${bullets(w.review.issues)}`)
            : null}
          <Text accessibilityRole="header" style={{ color: c.foreground, fontWeight: '600' }}>
            Tests exécutés
          </Text>
          {!w.tests.length ? (
            <Text style={{ color: c.foregroundMuted }}>
              {w.allowNoTests ? 'Absence de tests acceptée.' : 'Aucun test exécuté.'}
            </Text>
          ) : null}
          {w.tests.map((result, i) => (
            <TestLog key={`${i}:${result.command}`} result={result} colors={c} />
          ))}
          {navigation
            ? Object.entries(w.agents).map(([role, id]) =>
                button(`Session ${role}`, () => navigation.openAgent({ agentId: id!, serverId: host.id })),
              )
            : null}
          <Text accessibilityRole="header" style={{ color: c.foreground, fontWeight: '600' }}>
            Événements enregistrés
          </Text>
          {w.events.map((event) => {
            const content = renderEvent(event.role, event.text);
            const summary =
              content.kind === 'markdown'
                ? content.text
                : content.kind === 'plan'
                  ? content.plan.summary
                  : content.kind === 'build'
                    ? content.build.summary
                    : content.review.summary;
            return (
              <View
                key={event.id}
                style={{ paddingVertical: 8, gap: 4, borderBottomWidth: 1, borderBottomColor: c.border }}
              >
                <Text style={{ color: c.foregroundMuted }}>
                  {new Date(event.at).toLocaleString()} · {event.role ?? event.kind}
                </Text>
                <Markdown source={summary} colors={c} />
              </View>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}
