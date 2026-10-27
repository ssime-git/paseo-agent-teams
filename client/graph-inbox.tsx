import { useState, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRpc, type PluginTimelineItemProps } from '@getpaseo/plugin/client';
import { Modal, TextInput } from '@getpaseo/plugin/client/ui';
import { z } from 'zod';
import { graphListRpc, graphResponseRpc, graphAdvanceRpc } from '../shared/graph-actions';
import type { GraphCheckpoint } from '../shared/graph-checkpoint';
import { useT } from './i18n';

export const graphInboxSchema = z
  .object({ workspaceId: z.string().min(1), text: z.string(), graphId: z.uuid().optional() })
  .strict();

/** Persisted report plus live, explicitly opened actions for this native conversation. */
export function GraphInbox({
  item: { data },
  agentId,
  theme: { colors: c },
}: PluginTimelineItemProps<z.infer<typeof graphInboxSchema>>) {
  const t = useT();
  const list = useRpc(graphListRpc),
    respond = useRpc(graphResponseRpc),
    advance = useRpc(graphAdvanceRpc);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [states, setStates] = useState<GraphCheckpoint[]>([]),
    [selected, setSelected] = useState<string | undefined>(data.graphId);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { choice?: string; text: string }>>({});
  const inFlight = useRef(false);
  const scope = { workspaceId: data.workspaceId, ownerAgentId: agentId };
  const state = states.find((s) => s.id === selected);
  const active = state?.activations.at(-1);
  const question =
    active?.assessment?.status === 'clarification'
      ? active.assessment.request.questions.find(
          (q) => !active.clarificationAnswers?.some((a) => a.questionId === q.id),
        )
      : undefined;
  const human = state?.status === 'waiting_human';
  const draftKey = `${state?.id}:${active?.operationId}:${question?.id ?? 'decision'}`;
  const draft = drafts[draftKey] ?? { text: '' };
  const change = (value: Partial<typeof draft>) => setDrafts((all) => ({ ...all, [draftKey]: { ...draft, ...value } }));
  const run = async (job: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await job();
    } catch (e) {
      setError(String(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const refresh = () =>
    run(async () => {
      setStates((await list(scope)).filter((s) => !data.graphId || s.id === data.graphId));
      setLoaded(true);
    });
  const replace = (next: GraphCheckpoint) => setStates((all) => all.map((s) => (s.id === next.id ? next : s)));
  const button = (label: string, onPress: () => void, disabled = busy, chosen = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: chosen }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderWidth: 1,
        borderColor: chosen ? c.accent : c.border,
        borderRadius: 8,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: c.foreground }}>{label}</Text>
    </Pressable>
  );
  const submit = () =>
    run(async () => {
      if (!state || !active || (!question && !human)) return;
      const next = await respond({
        ...scope,
        id: state.id,
        expectedRevision: state.revision,
        operationId: active.operationId,
        submission: question
          ? {
              action: 'answer',
              answer: {
                questionId: question.id,
                ...(draft.choice ? { optionId: draft.choice } : {}),
                ...(draft.text.trim() ? { text: draft.text.trim() } : {}),
              },
            }
          : {
              action: 'decide',
              decision: {
                id: active.operationId,
                outcome: draft.choice as 'approve' | 'reject',
                summary: draft.text.trim(),
              },
            },
      });
      replace(next);
      setDrafts((all) => {
        return Object.fromEntries(Object.entries(all).filter(([key]) => key !== draftKey));
      });
      setNotice(t('Réponse enregistrée. La continuation reste une action distincte.'));
    });
  return (
    <View style={{ gap: 12, paddingVertical: 8 }}>
      <Text style={{ color: c.foreground, lineHeight: 20 }}>{data.text}</Text>
      {button(data.graphId ? t('Répondre') : t('Ouvrir les actions du workflow'), () => {
        setOpen(true);
        void refresh();
      })}
      <Modal open={open} onOpenChange={setOpen} title={t('Répondre au workflow')}>
        <Modal.Content>
          <Text style={{ color: c.foregroundMuted }}>
            {t('Choisissez le workflow par son nom. Aucun identifiant à recopier.')}
          </Text>
          {button(t('Actualiser les attentes'), () => {
            void refresh();
          })}
          {error ? (
            <Text accessibilityRole="alert" style={{ color: c.foreground }}>
              {error}
            </Text>
          ) : null}
          {notice ? <Text style={{ color: c.foreground }}>{notice}</Text> : null}
          {loaded && !states.length ? (
            <Text style={{ color: c.foreground }}>{t('Aucun graphe admis pour cette conversation.')}</Text>
          ) : null}
          {states.map((s) => (
            <View key={s.id}>
              {button(
                `${s.source.definition.name} · ${t('Révision {revision}', { revision: s.revision })}`,
                () => setSelected(s.id),
                busy,
                selected === s.id,
              )}
            </View>
          ))}
          {state ? (
            <View style={{ gap: 12 }}>
              <Text style={{ color: c.foreground }}>{state.task}</Text>
              <Text style={{ color: c.foreground }}>
                {
                  {
                    ready: t('Prêt à continuer'),
                    running: t('Étape en cours'),
                    waiting_human: t('En attente de décision humaine'),
                    succeeded: t('Terminé avec succès'),
                    failed: t('Échec'),
                    exhausted: t('Limite atteinte'),
                  }[state.status]
                }
              </Text>
              <Text style={{ color: c.foreground }}>
                {t('Étape : {step}', { step: state.nextStepId ?? active?.stepId ?? '—' })}
              </Text>
              {human || question ? (
                <>
                  <Text style={{ color: c.foreground, fontWeight: '600' }}>{t('En attente de réponse')}</Text>
                  <Text style={{ color: c.foreground }}>
                    {question?.title ?? state.source.definition.steps.find((s) => s.id === active?.stepId)?.instruction}
                  </Text>
                  {question ? (
                    question.options.map((option) => (
                      <View key={option.id} style={{ gap: 4 }}>
                        {button(
                          `${option.label}${option.id === question.recommendedOptionId ? ` · ${t('Recommandé')}` : ''}`,
                          () => change({ choice: option.id }),
                          busy,
                          draft.choice === option.id,
                        )}
                        <Text style={{ color: c.foregroundMuted }}>{option.tradeoff}</Text>
                      </View>
                    ))
                  ) : (
                    <View style={{ gap: 8 }}>
                      {button(
                        t('Approuver cette étape'),
                        () => change({ choice: 'approve' }),
                        busy,
                        draft.choice === 'approve',
                      )}
                      {button(
                        t('Refuser cette étape'),
                        () => change({ choice: 'reject' }),
                        busy,
                        draft.choice === 'reject',
                      )}
                    </View>
                  )}
                  <TextInput
                    accessibilityLabel={t('Votre réponse libre')}
                    placeholder={t('Votre réponse libre')}
                    multiline
                    value={draft.text}
                    onChangeText={(text) => change({ text })}
                    editable={!busy}
                    maxLength={question ? 8000 : 4000}
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
                      void submit();
                    },
                    busy || (question ? !draft.choice && !draft.text.trim() : !draft.choice || !draft.text.trim()),
                  )}
                  <Text style={{ color: c.foregroundMuted }}>
                    {t('Fermer garde la question en attente. Aucun choix n’est appliqué sans envoi.')}
                  </Text>
                </>
              ) : (
                <Text style={{ color: c.foregroundMuted }}>{t('Aucune réponse humaine attendue à cette étape.')}</Text>
              )}
              {button(
                t('Continuer cette étape'),
                () => {
                  void run(async () => {
                    const result = await advance({ ...scope, id: state.id, expectedRevision: state.revision });
                    replace(result.state);
                    setNotice(
                      result.status === 'stale'
                        ? t('Révision périmée : aucune continuation')
                        : t('Un seul avancement demandé. Aucune décision humaine ni approbation implicite.'),
                    );
                  });
                },
                busy || human || !!question || ['succeeded', 'failed', 'exhausted'].includes(state.status),
              )}
            </View>
          ) : null}
        </Modal.Content>
      </Modal>
    </View>
  );
}
