import { useState, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Modal, TextInput } from '@getpaseo/plugin/client/ui';
import { useRpc, type PluginTimelineItemProps } from '@getpaseo/plugin/client';
import { z } from 'zod';
import type { Workflow } from '../shared/contracts';
import { plannerQuestionReadRpc, plannerQuestionAnswerRpc } from '../shared/planner-question';
import { useT } from './i18n';
import { Markdown } from './markdown';

export const plannerQuestionCardSchema = z
  .object({ id: z.string(), workspaceId: z.string(), clarificationId: z.string(), text: z.string() })
  .strict();

/** A historical request card opens the current persisted question, never a model-inferred answer. */
export function PlannerQuestionCard({
  item: { data },
  agentId,
  theme: { colors: c },
}: PluginTimelineItemProps<z.infer<typeof plannerQuestionCardSchema>>) {
  const t = useT();
  const read = useRpc(plannerQuestionReadRpc),
    answer = useRpc(plannerQuestionAnswerRpc);
  const [open, setOpen] = useState(false),
    [w, setWorkflow] = useState<Workflow>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { choice?: string; text: string }>>({});
  const guard = useRef(false);
  const pending = w?.clarifications?.find((q) => q.id === data.clarificationId && !q.resolvedAt);
  const question = pending?.request.questions.find((q) => !pending.answers.some((a) => a.questionId === q.id));
  const draft = drafts[question?.id ?? ''] ?? { text: '' };
  const scope = { id: data.id, workspaceId: data.workspaceId, ownerAgentId: agentId };
  const run = async (job: () => Promise<void>) => {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError('');
    try {
      await job();
    } catch (e) {
      setError(String(e));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  };
  const refresh = () =>
    run(async () => {
      setWorkflow(await read(scope));
    });
  const button = (label: string, onPress: () => void, disabled = busy, selected = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderWidth: 1,
        borderColor: selected ? c.accent : c.border,
        borderRadius: 8,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: c.foreground }}>{label}</Text>
    </Pressable>
  );
  const change = (value: Partial<typeof draft>) => {
    if (question) setDrafts((all) => ({ ...all, [question.id]: { ...draft, ...value } }));
  };
  return (
    <View style={{ gap: 12, paddingVertical: 8 }}>
      <Text style={{ color: c.foreground, fontWeight: '600' }}>{t('En attente de réponse')}</Text>
      <Markdown source={data.text} colors={c} />
      {button(t('Répondre'), () => {
        setOpen(true);
        void refresh();
      })}
      <Modal open={open} onOpenChange={setOpen} title={t('Répondre au Planner')}>
        <Modal.Content>
          {error ? (
            <Text accessibilityRole="alert" style={{ color: c.foreground }}>
              {error}
            </Text>
          ) : null}
          {button(t('Actualiser les attentes'), () => {
            void refresh();
          })}
          {question && pending && w ? (
            <>
              <Text style={{ color: c.foreground }}>{pending.request.summary}</Text>
              <Text style={{ color: c.foreground, fontWeight: '600' }}>{question.title}</Text>
              {question.options.map((option) => (
                <View key={option.id} style={{ gap: 4 }}>
                  {button(
                    `${option.label}${option.id === question.recommendedOptionId ? ` · ${t('Recommandé')}` : ''}`,
                    () => change({ choice: option.id }),
                    busy,
                    draft.choice === option.id,
                  )}
                  <Text style={{ color: c.foregroundMuted }}>{option.tradeoff}</Text>
                </View>
              ))}
              <TextInput
                accessibilityLabel={t('Votre réponse libre')}
                placeholder={t('Votre réponse libre')}
                multiline
                editable={!busy}
                maxLength={8000}
                value={draft.text}
                onChangeText={(text) => change({ text })}
                style={{
                  minHeight: 100,
                  padding: 12,
                  color: c.foreground,
                  borderWidth: 1,
                  borderColor: c.border,
                  borderRadius: 8,
                }}
              />
              {button(
                t('Envoyer la réponse'),
                () => {
                  void run(async () => {
                    const next = await answer({
                      ...scope,
                      expectedRevision: w.revision,
                      clarificationId: pending.id,
                      answer: {
                        questionId: question.id,
                        ...(draft.choice ? { optionId: draft.choice } : {}),
                        ...(draft.text.trim() ? { text: draft.text.trim() } : {}),
                      },
                    });
                    setWorkflow(next);
                    setDrafts((all) => Object.fromEntries(Object.entries(all).filter(([key]) => key !== question.id)));
                  });
                },
                busy || (!draft.choice && !draft.text.trim()),
              )}
              <Text style={{ color: c.foregroundMuted }}>
                {t('Fermer garde la question en attente. Aucun choix n’est appliqué sans envoi.')}
              </Text>
            </>
          ) : w ? (
            <Text style={{ color: c.foreground }}>
              {t(
                'Ces questions ont reçu une réponse. Le workflow conserve le contexte et suit sa politique de reprise.',
              )}
            </Text>
          ) : null}
        </Modal.Content>
      </Modal>
    </View>
  );
}
