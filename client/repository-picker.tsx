import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { PluginHostProps } from '@getpaseo/plugin/client';
export function RepositoryPicker({
  paths,
  defaults,
  candidates,
  colors: c,
  onChange,
  truncated,
}: {
  paths?: string[];
  defaults: string[];
  candidates: string[];
  colors: PluginHostProps['theme']['colors'];
  onChange(paths: string[] | undefined): void;
  truncated?: boolean;
}) {
  const selected = paths ?? defaults ?? [];
  const key = JSON.stringify(selected);
  const [text, setText] = useState(selected.join('\n'));
  useEffect(() => {
    setText(JSON.parse(key).join('\n'));
  }, [key]);
  return (
    <View style={{ gap: 8, padding: 10, borderWidth: 1, borderColor: c.border, borderRadius: 6 }}>
      <Text accessibilityRole="header" style={{ color: c.foreground, fontWeight: '600' }}>
        Dépôts du workflow
      </Text>
      <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
        Un seul workflow peut coordonner plusieurs dépôts depuis ce dossier. Les dépôts cochés sont suivis et
        verrouillés ensemble.
      </Text>
      {[...new Set([...candidates, ...selected])].map((path) => (
        <Pressable
          key={path}
          accessibilityRole="checkbox"
          accessibilityLabel={`Inclure le dépôt ${path}`}
          accessibilityState={{ checked: selected.includes(path) }}
          aria-checked={selected.includes(path)}
          onPress={() => onChange(selected.includes(path) ? selected.filter((p) => p !== path) : [...selected, path])}
          style={{ flexDirection: 'row', gap: 8, paddingVertical: 5 }}
        >
          <Text style={{ color: c.accent }}>{selected.includes(path) ? '☑' : '☐'}</Text>
          <Text style={{ color: c.foreground, fontSize: 12, flex: 1 }}>{path}</Text>
        </Pressable>
      ))}
      {truncated ? (
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
          La recherche automatique est limitée en profondeur et en taille. Ajoutez les chemins manquants ci-dessous.
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel="Chemins des dépôts"
        multiline
        value={text}
        onChangeText={setText}
        placeholder="Un chemin de dépôt par ligne, absolu ou relatif à ce dossier"
        placeholderTextColor={c.foregroundMuted}
        style={{
          color: c.foreground,
          borderWidth: 1,
          borderColor: c.border,
          padding: 8,
          borderRadius: 6,
          minHeight: 52,
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Appliquer les dépôts"
        onPress={() =>
          onChange(
            text
              .split('\n')
              .map((p) => p.trim())
              .filter(Boolean),
          )
        }
        style={{ padding: 8, borderWidth: 1, borderColor: c.border, borderRadius: 6 }}
      >
        <Text style={{ color: c.foreground }}>Appliquer les dépôts</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Redécouvrir les dépôts"
        onPress={() => onChange(undefined)}
        style={{ padding: 8 }}
      >
        <Text style={{ color: c.foregroundMuted }}>Redécouvrir les dépôts</Text>
      </Pressable>
    </View>
  );
}
