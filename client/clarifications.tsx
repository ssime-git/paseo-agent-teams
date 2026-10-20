import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { PluginHostProps } from '@getpaseo/plugin/client';
import type { Action, Workflow } from '../shared/contracts';

export function Clarifications({
  workflow,
  colors: c,
  busy,
  onAnswer,
}: {
  workflow: Workflow;
  colors: PluginHostProps['theme']['colors'];
  busy: boolean;
  onAnswer(extra: Partial<Action>): void;
}) {
  const pending = workflow.clarifications?.find((v) => !v.resolvedAt);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!pending || workflow.status === 'completed') return null;
  return (
    <View style={{ gap: 14, padding: 12, borderWidth: 1, borderColor: c.border, borderRadius: 8 }}>
      <Text style={{ color: c.foreground, fontWeight: '600' }}>En attente de réponse</Text>
      <Text style={{ color: c.foregroundMuted }}>{pending.request.summary}</Text>
      <Text style={{ color: c.foregroundMuted }}>
        Aucun choix n’est appliqué automatiquement. Le Planner reprendra après toutes les réponses.
      </Text>
      {pending.request.questions.map((q) => {
        const answer = pending.answers.find((a) => a.questionId === q.id);
        const key = `${pending.id}:${q.id}`;
        const send = (optionId?: string, text?: string) =>
          onAnswer({
            clarificationId: pending.id,
            answers: [{ questionId: q.id, ...(optionId ? { optionId } : { text }) }],
          });
        return (
          <View key={q.id} style={{ gap: 8 }}>
            <Text style={{ color: c.foreground, fontWeight: '600' }}>{q.title}</Text>
            {answer ? (
              <Text style={{ color: c.statusSuccess }}>
                Réponse enregistrée : {q.options.find((o) => o.id === answer.optionId)?.label ?? answer.text}
              </Text>
            ) : (
              <>
                {q.options.map((o) => (
                  <Pressable
                    key={o.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${q.title} : ${o.label}`}
                    disabled={busy}
                    onPress={() => send(o.id)}
                    style={{
                      padding: 12,
                      minHeight: 44,
                      borderWidth: 1,
                      borderColor: c.border,
                      borderRadius: 6,
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    <Text style={{ color: c.foreground }}>
                      {o.label}
                      {o.id === q.recommendedOptionId && !/\((?:recommandé|recommended)\)/i.test(o.label)
                        ? ' (recommandé)'
                        : ''}
                    </Text>
                    <Text style={{ color: c.foregroundMuted }}>{o.tradeoff}</Text>
                  </Pressable>
                ))}
                <TextInput
                  accessibilityLabel={`Réponse libre : ${q.title}`}
                  placeholder="Réponse libre"
                  placeholderTextColor={c.foregroundMuted}
                  multiline
                  editable={!busy}
                  value={drafts[key] ?? ''}
                  onChangeText={(text) => setDrafts((v) => ({ ...v, [key]: text }))}
                  style={{
                    color: c.foreground,
                    padding: 12,
                    minHeight: 44,
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: 6,
                  }}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Envoyer la réponse : ${q.title}`}
                  disabled={busy || !drafts[key]?.trim()}
                  onPress={() => send(undefined, drafts[key].trim())}
                  style={{ padding: 12, minHeight: 44, opacity: busy || !drafts[key]?.trim() ? 0.5 : 1 }}
                >
                  <Text style={{ color: c.accent }}>Envoyer la réponse</Text>
                </Pressable>
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}
