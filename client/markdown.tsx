import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { parseBlocks } from './blocks';

export interface MarkdownColors {
  foreground: string;
  foregroundMuted: string;
  surface2: string;
  border: string;
  accent: string;
}
/** Inline `code`, **bold**, *italic* and [label](url) (links render as their label). */
function inline(text: string, colors: MarkdownColors, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${n++}`;
    if (token.startsWith('`'))
      out.push(
        <Text key={key} style={{ fontFamily: 'monospace', backgroundColor: colors.surface2, fontSize: 12 }}>
          {` ${token.slice(1, -1)} `}
        </Text>,
      );
    else if (token.startsWith('**'))
      out.push(
        <Text key={key} style={{ fontWeight: '600' }}>
          {token.slice(2, -2)}
        </Text>,
      );
    else if (token.startsWith('['))
      out.push(
        <Text key={key} style={{ color: colors.accent }}>
          {token.slice(1, token.indexOf(']'))}
        </Text>,
      );
    else
      out.push(
        <Text key={key} style={{ fontStyle: 'italic' }}>
          {token.slice(1, -1)}
        </Text>,
      );
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, colors }: { source: string; colors: MarkdownColors }) {
  const base = { color: colors.foreground, fontSize: 13, lineHeight: 20 };
  return (
    <View style={{ gap: 6 }}>
      {parseBlocks(source).map((block, index) => {
        const key = `b${index}`;
        if (block.kind === 'heading')
          return (
            <Text
              key={key}
              accessibilityRole="header"
              style={{ ...base, fontWeight: '600', fontSize: block.level <= 2 ? 15 : 13, marginTop: 4 }}
            >
              {inline(block.text, colors, key)}
            </Text>
          );
        if (block.kind === 'code')
          return (
            <View
              key={key}
              style={{ backgroundColor: colors.surface2, borderColor: colors.border, borderWidth: 1, padding: 8 }}
            >
              <Text selectable style={{ ...base, fontFamily: 'monospace', fontSize: 12 }}>
                {block.text}
              </Text>
            </View>
          );
        if (block.kind === 'list')
          return (
            <View key={key} style={{ gap: 2 }}>
              {block.items.map((item, i) => (
                <View key={`${key}-${i}`} style={{ flexDirection: 'row', gap: 6 }}>
                  <Text style={{ ...base, color: colors.foregroundMuted }}>{block.ordered ? `${i + 1}.` : '•'}</Text>
                  <Text selectable style={{ ...base, flex: 1 }}>
                    {inline(item, colors, `${key}-${i}`)}
                  </Text>
                </View>
              ))}
            </View>
          );
        if (block.kind === 'quote')
          return (
            <View key={key} style={{ borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: 8 }}>
              <Text selectable style={{ ...base, color: colors.foregroundMuted }}>
                {inline(block.text, colors, key)}
              </Text>
            </View>
          );
        return (
          <Text key={key} selectable style={base}>
            {inline(block.text, colors, key)}
          </Text>
        );
      })}
    </View>
  );
}
