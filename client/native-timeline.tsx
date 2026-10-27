import { PlannerQuestionCard, plannerQuestionCardSchema } from './planner-question';
import type { PluginClientContext, PluginTimelineItemProps } from '@getpaseo/plugin/client';
import { GraphInbox, graphInboxSchema } from './graph-inbox';
import { useT } from './i18n';
import { Text, View } from 'react-native';
import type { z } from 'zod';
import { cardSchema, nativeArtifactSchema, nativeArtifactsRpc, nativeBriefSchema } from '../shared/contracts';
import { roleLabel } from './events';
import { StageResult } from './stage-result';
import { Disclosure } from './disclosure';
import { Markdown } from './markdown';

import { nativeMessageIndex, projectNativeReport } from './native-projection';
type Artifact = z.infer<typeof nativeArtifactSchema>;
function Brief({ item, theme: { colors: c } }: PluginTimelineItemProps<{ text: string }>) {
  const t = useT();
  return (
    <View style={{ paddingVertical: 8 }}>
      <Disclosure title={t('Contexte transmis à l’agent')} colors={c}>
        <Markdown source={item.data.text} colors={c} />
      </Disclosure>
    </View>
  );
}
/** A role's structured result, shown in that role's own session. */
function NativeReport(props: PluginTimelineItemProps<Artifact>) {
  const t = useT();
  const {
    item: { data },
    theme: { colors: c },
  } = props;
  return (
    <View
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface1,
        padding: props.layout.compact ? 14 : 18,
        gap: 16,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.accent }} />
        <Text style={{ color: c.foreground, fontSize: 13, fontWeight: '600' }}>{t(roleLabel[data.role])}</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 11, marginLeft: 'auto' }}>AGENT TEAMS</Text>
      </View>
      <StageResult role={data.role} text={data.text} colors={c} />
    </View>
  );
}
/** Progress cards written by earlier versions remain readable in existing threads. */
function LegacyProgress({ item: { data }, theme: { colors: c } }: PluginTimelineItemProps<z.infer<typeof cardSchema>>) {
  const t = useT();
  return (
    <View
      style={{
        padding: 12,
        gap: 6,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 8,
        backgroundColor: c.surface1,
      }}
    >
      <Text style={{ color: c.foreground, fontWeight: '600' }}>Agent Teams</Text>
      {data.artifact ? (
        <Disclosure title={t('Voir le compte rendu de l’étape')} colors={c}>
          <StageResult role={data.artifact.role} text={data.artifact.text} colors={c} />
        </Disclosure>
      ) : data.detail ? (
        <Markdown source={data.detail} colors={c} />
      ) : null}
    </View>
  );
}
export function addNativeTimeline(client: PluginClientContext) {
  let disposed = false,
    refreshing = false,
    signature = '';
  let removeReport: (() => void | Promise<void>) | undefined;
  const cleanups = [
    client.addTimelineRenderer({
      kind: 'agent-teams-question',
      version: 1,
      schema: plannerQuestionCardSchema,
      Component: PlannerQuestionCard,
    }),
    client.addTimelineRenderer({
      kind: 'agent-teams-graphs',
      version: 1,
      schema: graphInboxSchema,
      Component: GraphInbox,
    }),
    client.addTimelineRenderer({
      kind: 'agent-teams-report',
      version: 1,
      schema: nativeArtifactSchema,
      Component: NativeReport,
    }),
    client.addTimelineRenderer({
      kind: 'agent-teams-progress',
      version: 1,
      schema: cardSchema,
      Component: LegacyProgress,
    }),
    client.addTimelineRenderer({
      kind: 'agent-teams-brief',
      version: 1,
      schema: nativeBriefSchema,
      Component: Brief,
    }),
    client.addTimelineTransformer({
      id: 'team-operation-brief',
      query: { itemType: 'user_message' },
      transform: ({ item }) =>
        /^\[agent-teams-operation:[a-f0-9-]{36}\]\n/.test(item.text)
          ? {
              items: [
                {
                  type: 'plugin',
                  pluginId: 'paseo-agent-teams',
                  id: `brief-${item.messageId ?? item.text.slice(1, 59)}`,
                  kind: 'agent-teams-brief',
                  version: 1,
                  data: { text: item.text.replace(/^\[agent-teams-operation:[^\]]+\]\n/, '') },
                },
              ],
            }
          : undefined,
    }),
  ];
  const refresh = async () => {
    if (disposed || refreshing) return;
    refreshing = true;
    try {
      const response = await client.rpc(nativeArtifactsRpc, { revision: signature || undefined });
      if (disposed || !response.records) return;
      const index = nativeMessageIndex(response.records);
      await removeReport?.();
      if (disposed) return;
      removeReport = client.addTimelineTransformer({
        id: 'team-saved-reports',
        query: { itemType: 'assistant_message' },
        transform: ({ item, phase }) => {
          if (phase !== 'complete') return;
          const projection = projectNativeReport(item.text, index);
          if (projection?.kind === 'continuation') return { items: [] };
          const record = projection?.record;
          return record
            ? {
                items: [
                  {
                    type: 'plugin',
                    id: `report-${item.messageId ?? record.eventId}`,
                    pluginId: 'paseo-agent-teams',
                    kind: 'agent-teams-report',
                    version: 1,
                    data: record,
                  },
                ],
              }
            : undefined;
        },
      });
      signature = response.revision;
    } catch {
      /* The plugin may be reloading. Keep native content available and retry metadata discovery. */
    } finally {
      refreshing = false;
    }
  };
  const timer = setInterval(() => void refresh(), 3000);
  void refresh();
  return () => {
    disposed = true;
    clearInterval(timer);
    void removeReport?.();
    for (const cleanup of cleanups) void cleanup();
  };
}
