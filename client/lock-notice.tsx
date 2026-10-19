import { Pressable, Text, View } from 'react-native';
import type { PluginHostProps } from '@getpaseo/plugin/client';
import type { z } from 'zod';
import type { catalogRpc } from '../shared/contracts';
import { showTeamWorkflow } from './drafts';

export function LockNotice({
  blocker,
  host,
  theme,
  onOpen,
  onRefresh,
}: Pick<PluginHostProps, 'host' | 'theme'> & {
  blocker: z.infer<typeof catalogRpc.output>['blockingWorkflow'];
  onOpen?(workspaceId: string): void;
  onRefresh(): void;
}) {
  if (!blocker) return null;
  const c = theme.colors;
  return (
    <View style={{ padding: 12, gap: 8, borderWidth: 1, borderColor: c.statusWarning, borderRadius: 8 }}>
      <Text style={{ color: c.foreground }}>Un workflow conserve le verrou de ce dépôt.</Text>
      <Text selectable style={{ color: c.foregroundMuted }}>
        {blocker.task} · {blocker.status} · {blocker.id.slice(0, 8)}
      </Text>
      {blocker.workspaceId && onOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ouvrir le workflow bloquant"
          onPress={() => {
            showTeamWorkflow(`${host.id}:${blocker.workspaceId}`, blocker.id);
            onOpen(blocker.workspaceId!);
          }}
        >
          <Text style={{ color: c.foreground }}>Ouvrir le workflow bloquant ↗</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Actualiser le verrou" onPress={onRefresh}>
        <Text style={{ color: c.foregroundMuted }}>Actualiser</Text>
      </Pressable>
    </View>
  );
}
