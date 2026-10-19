import { Text, View } from 'react-native';
import type { PluginHostProps } from '@getpaseo/plugin/client';
import type { Role } from '../shared/contracts';
import { eventMarkdown, renderEvent } from './events';
import { Markdown } from './markdown';
/** Shared rendering for Team, saved history and plugin cards in native sessions. */
export function StageResult({
  role,
  text,
  colors: c,
}: {
  role?: Role;
  text: string;
  colors: PluginHostProps['theme']['colors'];
}) {
  const result = renderEvent(role, text);
  return (
    <View style={{ gap: 10, minWidth: 0 }}>
      {result.kind === 'review' ? (
        <Text
          accessibilityRole="header"
          style={{ color: result.review.verdict === 'pass' ? c.statusSuccess : c.statusDanger, fontWeight: '600' }}
        >
          {result.review.verdict === 'pass' ? 'Review validée' : 'Corrections demandées'}
        </Text>
      ) : null}
      <Markdown source={eventMarkdown(result)} colors={c} />
    </View>
  );
}
