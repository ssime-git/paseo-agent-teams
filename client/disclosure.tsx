import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { PluginHostProps } from '@getpaseo/plugin/client';
export function Disclosure({
  title,
  count,
  children,
  colors: c,
  initialOpen = false,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  colors: PluginHostProps['theme']['colors'];
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <View style={{ gap: 10, minWidth: 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => setOpen((v) => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9 }}
      >
        <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{open ? '⌄' : '›'}</Text>
        <Text style={{ color: c.foreground, fontSize: 12, fontWeight: '500', flex: 1 }}>{title}</Text>
        {count != null ? <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{count}</Text> : null}
      </Pressable>
      {open ? children : null}
    </View>
  );
}
