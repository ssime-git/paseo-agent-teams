import { Pressable, Text, View } from 'react-native';
import { useT } from './i18n';
import { useRpc, type PluginHostProps } from '@getpaseo/plugin/client';
import { useRef, useState } from 'react';
import type { z } from 'zod';
import { actionRpc, type catalogRpc } from '../shared/contracts';
import { showTeamWorkflow } from './drafts';
import { errorMessage } from './errors';

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
  const t = useT();
  const actionCall = useRpc(actionRpc);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef<{ key: string; id: string } | undefined>(undefined);
  if (!blocker) return null;
  const c = theme.colors;
  const close = async () => {
    if (busy || !blocker.workspaceId) return;
    setBusy(true);
    setError('');
    const key = `${blocker.id}:${blocker.revision}`;
    if (pending.current?.key !== key)
      pending.current = { key, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
    try {
      await actionCall({
        id: blocker.id,
        workspaceId: blocker.workspaceId,
        expectedRevision: blocker.revision,
        requestId: pending.current.id,
        action: 'finish',
      });
      pending.current = undefined;
      onRefresh();
    } catch (error) {
      setError(errorMessage(error, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ padding: 12, gap: 8, borderWidth: 1, borderColor: c.statusWarning, borderRadius: 8 }}>
      <Text style={{ color: c.foreground }}>{t('Un workflow conserve le verrou de ce dépôt.')}</Text>
      <Text selectable style={{ color: c.foregroundMuted }}>
        {blocker.task} · {blocker.status} · {blocker.id.slice(0, 8)}
      </Text>
      {blocker.workspaceId && onOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Ouvrir le workflow bloquant')}
          onPress={() => {
            try {
              showTeamWorkflow(`${host.id}:${blocker.workspaceId}`, blocker.id);
              onOpen(blocker.workspaceId!);
            } catch (error) {
              setError(errorMessage(error, t));
            }
          }}
        >
          <Text style={{ color: c.foreground }}>{t('Ouvrir le workflow bloquant ↗')}</Text>
        </Pressable>
      ) : null}
      {blocker.workspaceId ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Clore le workflow bloquant en conservant les fichiers')}
          disabled={busy}
          onPress={() => void close()}
        >
          <Text style={{ color: c.foreground }}>{busy ? t('Fermeture…') : t('Clore en conservant les fichiers')}</Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: c.statusDanger }}>
          {error}
        </Text>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel={t('Actualiser le verrou')} onPress={onRefresh}>
        <Text style={{ color: c.foregroundMuted }}>{t('Actualiser')}</Text>
      </Pressable>
    </View>
  );
}
