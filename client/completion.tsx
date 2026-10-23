import { Pressable, Text, View } from 'react-native';
import { useT } from './i18n';
import { PR_REQUEST } from './texts';
import type { PluginHostProps } from '@getpaseo/plugin/client';
import type { Workflow, Action } from '../shared/contracts';
import { Markdown } from './markdown';
import { StageResult } from './stage-result';
export function CompletionSummary({
  workflow: w,
  colors: c,
  busy,
  onAction,
}: {
  workflow: Workflow;
  colors: PluginHostProps['theme']['colors'];
  busy: boolean;
  onAction(action: Action['action'], extra?: Partial<Action>): Promise<void> | undefined;
}) {
  const t = useT();
  const closed = w.events.some((e) => e.kind === 'closed');
  const testsPassed =
    w.testsApproved &&
    (w.tests.length > 0 ? w.tests.every((test) => test.exitCode === 0 && !test.timedOut) : w.allowNoTests);
  const validated = !closed && w.review?.verdict === 'pass' && testsPassed;
  const button = (label: string, action: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={action}
      style={{ padding: 10, borderWidth: 1, borderColor: c.border, borderRadius: 6, opacity: busy ? 0.5 : 1 }}
    >
      <Text style={{ color: c.foreground }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ padding: 12, gap: 12, borderWidth: 1, borderColor: c.border, borderRadius: 8 }}>
      <Text accessibilityRole="header" style={{ color: c.foreground, fontWeight: '600' }}>
        {t('Bilan et prochaines étapes')}
      </Text>
      <Text style={{ color: c.foreground }}>
        {closed
          ? t('Workflow fermé par l’utilisateur.')
          : validated
            ? t('Travail validé par la revue et les vérifications enregistrées.')
            : t('Validation à terminer avant publication.')}
      </Text>
      {w.build ? <StageResult role="builder" text={JSON.stringify(w.build)} colors={c} /> : null}
      {w.review ? <StageResult role="reviewer" text={JSON.stringify(w.review)} colors={c} /> : null}
      <Text style={{ color: c.foregroundMuted }}>
        {w.tests.length
          ? t('{passed}/{total} tests réussis.', {
              passed: w.tests.filter((test) => test.exitCode === 0 && !test.timedOut).length,
              total: w.tests.length,
            })
          : w.allowNoTests
            ? t('Absence de tests explicitement acceptée.')
            : t('Aucun test exécuté.')}
      </Text>
      <Text style={{ color: c.foregroundMuted }}>
        {w.status === 'awaiting_final'
          ? t('Prochaine étape : approuver la validation finale ci-dessous.')
          : validated
            ? t(
                'Prochaine étape : créer une PR si ce travail doit être intégré à une autre branche, ou demander les étapes de livraison à l’équipe. Le dépôt sera revérifié avant création.',
              )
            : t('Prochaine étape : consulter les résultats et reprendre le travail si nécessaire.')}
      </Text>
      {w.status === 'completed'
        ? button(t('Demander les prochaines étapes'), () => {
            void onAction('followup', {
              role: 'planner',
              message: t(
                'Résume le résultat de ce workflow, ce qui reste à faire et les prochaines étapes concrètes. Dis si une PR est utile ou si une autre action de livraison est nécessaire.',
              ),
            });
          })
        : null}
      {w.status === 'completed' && validated
        ? button(
            (w.repositoryTargets?.length ?? 1) > 1 ? t('Créer les PR brouillons') : t('Créer une PR brouillon'),
            () => {
              void onAction('followup', { purpose: 'pull_request', message: t(PR_REQUEST) });
            },
          )
        : null}
      {w.followupResult ? (
        <>
          <Text accessibilityRole="header" style={{ color: c.foreground, fontWeight: '600' }}>
            {t('Dernière réponse de l’équipe')}
          </Text>
          <Markdown source={w.followupResult} colors={c} />
        </>
      ) : null}
    </View>
  );
}
