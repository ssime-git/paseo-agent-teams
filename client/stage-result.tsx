import { useState } from 'react';
import { useT } from './i18n';
import { Pressable, Text, View } from 'react-native';
import type { PluginHostProps } from '@getpaseo/plugin/client';
import type { Role } from '../shared/contracts';
import { eventMarkdown, renderEvent } from './events';
import { Markdown } from './markdown';
import { Disclosure } from './disclosure';
/** The same readable artifact in Team, history and the native assistant message. */
export function StageResult({
  role,
  text,
  colors: c,
}: {
  role?: Role;
  text: string;
  colors: PluginHostProps['theme']['colors'];
}) {
  const t = useT();
  const result = renderEvent(role, text, t);
  const [expanded, setExpanded] = useState(false);
  if (result.kind === 'markdown') return <Markdown source={eventMarkdown(result, t)} colors={c} />;
  const value = result.kind === 'plan' ? result.plan : result.kind === 'build' ? result.build : result.review;
  const summary = value.summary;
  const long = summary.length > 420;
  const bullets = (items: string[]) => (
    <View style={{ gap: 10 }}>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{i + 1}.</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Markdown source={item} colors={c} />
          </View>
        </View>
      ))}
    </View>
  );
  return (
    <View style={{ gap: 8, minWidth: 0 }}>
      {result.kind === 'review' ? (
        <View
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: 10,
            paddingVertical: 5,
            backgroundColor: c.surface2,
            borderRadius: 6,
          }}
        >
          <Text
            style={{
              color: result.review.verdict === 'pass' ? c.statusSuccess : c.statusWarning,
              fontWeight: '600',
              fontSize: 12,
            }}
          >
            {result.review.verdict === 'pass' ? t('✓ Revue validée') : t('↻ Corrections demandées')}
          </Text>
        </View>
      ) : null}
      <Markdown source={long && !expanded ? summary.slice(0, 420).trimEnd() + '…' : summary} colors={c} />
      {long ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? t('Réduire le résumé') : t('Lire le résumé complet')}
          onPress={() => setExpanded((v) => !v)}
        >
          <Text style={{ color: c.accent, fontSize: 12, paddingVertical: 5 }}>
            {expanded ? t('Réduire') : t('Lire la suite')}
          </Text>
        </Pressable>
      ) : null}
      <View style={{ gap: 0 }}>
        {result.kind === 'plan' ? (
          <>
            <Disclosure title={t('Tâches')} count={result.plan.tasks.length} colors={c}>
              {bullets(result.plan.tasks)}
            </Disclosure>
            <Disclosure title={t('Critères d’acceptation')} count={result.plan.acceptance.length} colors={c}>
              {bullets(result.plan.acceptance)}
            </Disclosure>
            <Disclosure title={t('Commandes de test')} count={result.plan.tests.length} colors={c}>
              {bullets(result.plan.tests.map((test) => '`' + test.command + '`'))}
            </Disclosure>
          </>
        ) : result.kind === 'build' ? (
          <>
            <Disclosure title={t('Changements')} count={result.build.changes.length} colors={c}>
              {bullets(result.build.changes)}
            </Disclosure>
            {result.build.remaining.length ? (
              <Disclosure title={t('Reste à faire')} count={result.build.remaining.length} colors={c}>
                {bullets(result.build.remaining)}
              </Disclosure>
            ) : null}
          </>
        ) : result.review.issues.length ? (
          <Disclosure title={t('Points à corriger')} count={result.review.issues.length} colors={c}>
            {bullets(result.review.issues)}
          </Disclosure>
        ) : null}
      </View>
    </View>
  );
}
