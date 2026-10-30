import { Text, View } from 'react-native';
import type { WorkflowDefinition } from '../shared/workflow-definition';
import { useT } from './i18n';

/** Readable projection of the exact preview, never a separately reconstructed graph. */
export function GraphDefinition({
  definition,
  colors: c,
}: {
  definition: WorkflowDefinition;
  colors: { foreground: string; border: string };
}) {
  const t = useT();
  const contracts = {
    plan: t('Planification'),
    build: t('Construction'),
    review: t('Revue'),
    human: t('Décision humaine'),
  };
  const outcomes = { success: t('Réussite'), failure: t('Échec'), approve: t('Approbation'), reject: t('Refus') };
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: c.foreground }}>{t('Parcours et limites')}</Text>
      <Text style={{ color: c.foreground }}>{t('Entrée : {entry}', { entry: definition.entry })}</Text>
      <Text style={{ color: c.foreground }}>
        {t('Budget global : {count} activations, étapes humaines et répétitions comprises.', {
          count: definition.maxTransitions,
        })}
      </Text>
      {definition.steps.map((step) => (
        <View
          key={step.id}
          style={{ gap: 8, padding: 12, borderWidth: 1, borderColor: c.border, borderRadius: 8, minWidth: 0 }}
        >
          <Text selectable style={{ color: c.foreground }}>
            {step.id} · {contracts[step.contract]}
          </Text>
          <Text style={{ color: c.foreground }}>
            {step.access === 'read-only' ? t('Lecture seule') : t('Écriture autorisée')}
          </Text>
          <Text selectable style={{ color: c.foreground }}>
            {step.selection.provider} · {step.selection.modeId}
          </Text>
          <Text selectable style={{ color: c.foreground }}>
            {step.instruction}
          </Text>
          {step.tests?.length ? (
            step.tests.map((test, index) => (
              <View key={index} style={{ gap: 4 }}>
                <Text selectable style={{ color: c.foreground }}>
                  {test.command}
                </Text>
                <Text style={{ color: c.foreground }}>{t('Délai du test : {ms} ms', { ms: test.timeoutMs })}</Text>
              </View>
            ))
          ) : (
            <Text style={{ color: c.foreground }}>{t('Aucun test configuré pour cette étape.')}</Text>
          )}
          {step.transitions.map((edge) => (
            <Text key={edge.outcome} selectable style={{ color: c.foreground }}>
              {outcomes[edge.outcome]} → {edge.target ?? t('Fin du parcours')}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}
