import { Pressable, Text, View } from 'react-native';
import type { PluginHostProps } from '@getpaseo/plugin/client';
import type { Workflow, Action } from '../shared/contracts';
import { Markdown } from './markdown';
import { StageResult } from './stage-result';
export const PR_REQUEST =
  'Crée une pull request brouillon pour ce travail validé si une PR est pertinente. Vérifie le dépôt, la branche et une éventuelle PR existante. Donne son lien, ou explique précisément le blocage et les prochaines étapes. Préserve mes autres modifications.';
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
  const closed = w.events.some((e) => e.kind === 'closed');
  const testsPassed =
    w.testsApproved && (w.tests.length > 0 ? w.tests.every((t) => t.exitCode === 0 && !t.timedOut) : w.allowNoTests);
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
        Bilan et prochaines étapes
      </Text>
      <Text style={{ color: c.foreground }}>
        {closed
          ? 'Workflow fermé par l’utilisateur.'
          : validated
            ? 'Travail validé par la review et les vérifications enregistrées.'
            : 'Validation à terminer avant publication.'}
      </Text>
      {w.build ? <StageResult role="builder" text={JSON.stringify(w.build)} colors={c} /> : null}
      {w.review ? <StageResult role="reviewer" text={JSON.stringify(w.review)} colors={c} /> : null}
      <Text style={{ color: c.foregroundMuted }}>
        {w.tests.length
          ? `${w.tests.filter((t) => t.exitCode === 0 && !t.timedOut).length}/${w.tests.length} tests réussis.`
          : w.allowNoTests
            ? 'Absence de tests explicitement acceptée.'
            : 'Aucun test exécuté.'}
      </Text>
      <Text style={{ color: c.foregroundMuted }}>
        {w.status === 'awaiting_final'
          ? 'Prochaine étape : approuver la validation finale ci-dessous.'
          : validated
            ? 'Prochaine étape : créer une PR si ce travail doit être intégré à une autre branche, ou demander les étapes de livraison à l’équipe. Le dépôt sera revérifié avant création.'
            : 'Prochaine étape : consulter les résultats et reprendre le travail si nécessaire.'}
      </Text>
      {w.status === 'completed'
        ? button('Demander les prochaines étapes', () => {
            void onAction('followup', {
              role: 'planner',
              message:
                'Résume le résultat de ce workflow, ce qui reste à faire et les prochaines étapes concrètes. Dis si une PR est utile ou si une autre action de livraison est nécessaire.',
            });
          })
        : null}
      {w.status === 'completed' && validated
        ? button((w.repositoryTargets?.length ?? 1) > 1 ? 'Créer les PR brouillons' : 'Créer une PR brouillon', () => {
            void onAction('followup', { purpose: 'pull_request', message: PR_REQUEST });
          })
        : null}
      {w.followupResult ? (
        <>
          <Text accessibilityRole="header" style={{ color: c.foreground, fontWeight: '600' }}>
            Dernière réponse de l’équipe
          </Text>
          <Markdown source={w.followupResult} colors={c} />
        </>
      ) : null}
    </View>
  );
}
