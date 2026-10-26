import type { GraphCheckpoint } from '../shared/graph-checkpoint';
import type { Translate } from '../shared/i18n';

/** Bounded native-thread report; identifiers and model output keep their original spelling. */
export function graphStatusReport(states: GraphCheckpoint[], t: Translate) {
  if (!states.length) return t('Aucun graphe admis pour cette conversation.');
  const statuses: Record<GraphCheckpoint['status'], string> = {
    ready: t('Prêt à continuer'),
    running: t('Étape en cours'),
    waiting_human: t('En attente de décision humaine'),
    succeeded: t('Terminé avec succès'),
    failed: t('Échec'),
    exhausted: t('Limite atteinte'),
  };
  const lines = [t('Graphes de cette conversation : {count}', { count: states.length })];
  // Keep every displayed entry complete inside the persisted transcript's 8000 character limit.
  for (const state of states.slice(0, 10)) {
    const active = state.activations.at(-1);
    const step = state.nextStepId ?? active?.stepId;
    const clarification =
      active?.assessment?.status === 'clarification' &&
      active.assessment.request.questions.some((q) => !active.clarificationAnswers?.some((a) => a.questionId === q.id));
    lines.push(
      [
        `${state.source.definition.name.slice(0, 200)} · ${state.id}`,
        t('Version sauvegardée {version} · révision {revision}', {
          version: state.source.revision,
          revision: state.revision,
        }),
        clarification ? t('En attente de réponse') : statuses[state.status],
        t('Étape : {step} · activations : {used}/{max}', {
          step: step ?? '—',
          used: state.activations.length,
          max: state.source.definition.maxTransitions,
        }),
      ].join('\n'),
    );
  }
  if (states.length > 10) lines.push(t('Affichage limité à 10 graphes.'));
  lines.push(t('Lecture seule : aucune continuation ni approbation.'));
  return lines.join('\n\n');
}
