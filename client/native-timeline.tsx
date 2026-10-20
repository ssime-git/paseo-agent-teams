import type { PluginClientContext, PluginTimelineItemProps } from '@getpaseo/plugin/client';
import { Text, View } from 'react-native';
import type { z } from 'zod';
import { nativeArtifactSchema, nativeArtifactsRpc, nativeBriefSchema } from '../shared/contracts';
import { roleLabel } from './events';
import { StageResult } from './stage-result';
import { Disclosure } from './disclosure';
import { Markdown } from './markdown';
import { LiveWorkflowAction } from './workflow-action';
import { showTeamWorkflow } from './drafts';

import { nativeMessageIndex, projectNativeReport } from './native-projection';
type Artifact = z.infer<typeof nativeArtifactSchema>;
function NativeReport(props: PluginTimelineItemProps<Artifact> & { onOpen(): void }) {
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
        <Text style={{ color: c.foreground, fontSize: 13, fontWeight: '600' }}>{roleLabel[data.role]}</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 11, marginLeft: 'auto' }}>AGENT TEAMS</Text>
      </View>
      <StageResult role={data.role} text={data.text} colors={c} />
      <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12 }}>
        <LiveWorkflowAction
          eventId={data.eventId}
          workflowId={data.workflowId}
          workspaceId={data.workspaceId}
          colors={c}
          hostId={props.host.id}
          onOpen={props.onOpen}
        />
      </View>
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
      kind: 'agent-teams-report',
      version: 1,
      schema: nativeArtifactSchema,
      Component: (props) => (
        <NativeReport
          {...props}
          onOpen={() => {
            showTeamWorkflow(`${props.host.id}:${props.item.data.workspaceId}`, props.item.data.workflowId);
            client.openPanel('agent-teams', { workspaceId: props.item.data.workspaceId });
          }}
        />
      ),
    }),
    client.addTimelineRenderer({
      kind: 'agent-teams-brief',
      version: 1,
      schema: nativeBriefSchema,
      Component: ({ item, theme: { colors: c } }) => (
        <View style={{ paddingVertical: 8 }}>
          <Disclosure title="Contexte transmis à l’agent" colors={c}>
            <Markdown source={item.data.text} colors={c} />
          </Disclosure>
        </View>
      ),
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
