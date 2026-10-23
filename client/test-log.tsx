import { useState } from 'react';
import { useT } from './i18n';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { PluginHostProps } from '@getpaseo/plugin/client';
import type { TestResult } from '../shared/contracts';

export function TestLog({
  result,
  colors: c,
  loading = false,
}: {
  result: TestResult;
  colors: PluginHostProps['theme']['colors'];
  loading?: boolean;
}) {
  const t = useT();
  const failed = result.exitCode !== 0 || result.timedOut;
  const [open, setOpen] = useState(failed);
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 6,
        overflow: 'hidden',
        backgroundColor: c.surface0,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('Sortie du test {command}', { command: result.command })}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={{ padding: 10, gap: 6, flexDirection: 'row', alignItems: 'center' }}
      >
        <Text style={{ color: failed ? c.statusDanger : c.statusSuccess, fontSize: 11 }}>{open ? '▾' : '▸'}</Text>
        <Text numberOfLines={2} style={{ flex: 1, color: c.foreground, fontSize: 12, fontFamily: 'monospace' }}>
          $ {result.command}
        </Text>
        <Text style={{ color: failed ? c.statusDanger : c.foregroundMuted, fontSize: 11 }}>
          {result.timedOut ? 'Timeout' : `exit ${result.exitCode ?? '—'}`} · {(result.durationMs / 1000).toFixed(1)} s
        </Text>
      </Pressable>
      {open ? (
        <ScrollView
          nestedScrollEnabled
          style={{ maxHeight: 220, borderTopWidth: 1, borderTopColor: c.border }}
          contentContainerStyle={{ padding: 10 }}
        >
          <Text selectable style={{ color: c.foregroundMuted, fontSize: 11, lineHeight: 17, fontFamily: 'monospace' }}>
            {loading
              ? t('Chargement des sorties…')
              : `${result.stdout}\n${result.stderr}`.trim() || t('Aucune sortie.')}
          </Text>
          {result.truncated ? (
            <Text style={{ color: c.statusWarning, fontSize: 11 }}>{t('Sortie tronquée à la limite de capture.')}</Text>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}
