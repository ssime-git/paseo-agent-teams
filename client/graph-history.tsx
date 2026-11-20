import { Text, View } from 'react-native';
import type { PluginHostProps } from '@getpaseo/plugin/client';
import type { GraphCheckpoint } from '../shared/graph-checkpoint';
import { Disclosure } from './disclosure';
import { StageResult } from './stage-result';
import { useT } from './i18n';

/** Structured results and human decisions stay readable after a graph resumes. */
export function GraphHistory({
  state,
  colors: c,
}: {
  state: GraphCheckpoint;
  colors: PluginHostProps['theme']['colors'];
}) {
  const t = useT();
  const latest = state.activations.findLast((a) => a.result?.artifact)?.result?.artifact;
  const artifact = (value: NonNullable<typeof latest>) => (
    <StageResult
      role={value.contract === 'plan' ? 'planner' : value.contract === 'build' ? 'builder' : 'reviewer'}
      text={JSON.stringify(value.value)}
      colors={c}
    />
  );
  return (
    <View style={{ gap: 12, minWidth: 0 }}>
      {latest ? artifact(latest) : null}
      <Disclosure title={t('Historique des étapes')} count={state.activations.length} colors={c}>
        {state.activations.map((activation, index) => (
          <View key={activation.operationId} style={{ gap: 8, paddingVertical: 8, minWidth: 0 }}>
            <Text style={{ color: c.foreground, fontWeight: '600' }}>
              {index + 1}. {activation.stepId}
            </Text>
            <Text style={{ color: c.foregroundMuted }}>
              {state.source.definition.steps.find((s) => s.id === activation.stepId)?.selection.provider}
            </Text>
            {activation.result?.artifact ? (
              artifact(activation.result.artifact)
            ) : activation.result ? (
              <Text style={{ color: c.foreground }}>{activation.result.summary}</Text>
            ) : null}
            {activation.assessment?.status === 'clarification' ? (
              <>
                <Text style={{ color: c.foreground }}>{activation.assessment.request.summary}</Text>
                {activation.assessment.request.questions.map((question) => {
                  const answer = activation.clarificationAnswers?.find((a) => a.questionId === question.id);
                  return (
                    <Text key={question.id} style={{ color: c.foreground }}>
                      {question.title}
                      {answer
                        ? ` : ${[question.options.find((o) => o.id === answer.optionId)?.label, answer.text].filter(Boolean).join(' — ')}`
                        : ''}
                    </Text>
                  );
                })}
              </>
            ) : null}
            {activation.humanDecision ? (
              <Text style={{ color: c.foreground }}>
                {t('Décision humaine : {decision}', {
                  decision: activation.humanDecision.outcome === 'approve' ? t('Approuvé') : t('Refusé'),
                })}
                {'\n'}
                {activation.humanDecision.summary}
              </Text>
            ) : null}
            {activation.assessment &&
            activation.assessment.status !== 'valid' &&
            activation.assessment.status !== 'clarification' ? (
              <Text style={{ color: c.foreground }}>{activation.assessment.reason}</Text>
            ) : null}
            {activation.testRun?.completion?.error ? (
              <Text style={{ color: c.foreground }}>{activation.testRun.completion.error}</Text>
            ) : null}
            {activation.testRun?.completion?.results.map((test, index) => (
              <View key={index} style={{ gap: 4, minWidth: 0 }}>
                <Text style={{ color: c.foreground }}>{test.command}</Text>
                <Text style={{ color: c.foregroundMuted }}>
                  {t('Code de sortie : {code}', { code: String(test.exitCode) })}
                </Text>
                {test.stdout || test.stderr ? (
                  <Disclosure title={t('Sortie des tests')} colors={c}>
                    <Text style={{ color: c.foreground }}>
                      {test.stdout}
                      {test.stderr}
                    </Text>
                  </Disclosure>
                ) : null}
              </View>
            ))}
          </View>
        ))}
      </Disclosure>
    </View>
  );
}
