import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRpc } from '@getpaseo/plugin/client';
import { TextInput } from '@getpaseo/plugin/client/ui';
import { saveDefinitionRpc, type DefinitionRecord } from '../shared/definition-catalog';
import { workflowDefinitionSchema, type WorkflowDefinition } from '../shared/workflow-definition';
import { GraphDefinition } from './graph-definition';
import { useT } from './i18n';

/** Edits a saved revision only. Already admitted runs retain their definition snapshot. */
export function GraphEditor({
  record,
  colors: c,
  onSaved,
  onCancel,
}: {
  record: DefinitionRecord;
  colors: { foreground: string; border: string };
  onSaved: (record: DefinitionRecord) => void;
  onCancel: () => void;
}) {
  const t = useT(),
    save = useRpc(saveDefinitionRpc);
  const [draft, setDraft] = useState<WorkflowDefinition>(() => workflowDefinitionSchema.parse(record.definition));
  const [budget, setBudget] = useState(String(record.definition.maxTransitions));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const flight = useRef(false);
  const parsed = workflowDefinitionSchema.safeParse({ ...draft, maxTransitions: Number(budget) });
  const button = (label: string, action: () => void, disabled = busy) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={action}
      style={{ padding: 12, borderWidth: 1, borderColor: c.border, borderRadius: 8, opacity: disabled ? 0.5 : 1 }}
    >
      <Text style={{ color: c.foreground }}>{label}</Text>
    </Pressable>
  );
  const input = (label: string, value: string, update: (value: string) => void, maxLength: number) => (
    <TextInput
      accessibilityLabel={label}
      placeholder={label}
      value={value}
      onChangeText={update}
      editable={!busy}
      maxLength={maxLength}
      multiline
      style={{ padding: 12, color: c.foreground, borderColor: c.border, borderWidth: 1, borderRadius: 8 }}
    />
  );
  const updateStep = (index: number, update: (step: WorkflowDefinition['steps'][number]) => void) => {
    setDraft((current) => {
      const next = {
        ...current,
        steps: current.steps.map((step, i) =>
          i === index ? { ...step, ...(step.tests ? { tests: step.tests.map((test) => ({ ...test })) } : {}) } : step,
        ),
      };
      update(next.steps[index]);
      return next;
    });
  };
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: c.foreground }}>
        {record.definition.name} · {t('Révision {revision}', { revision: record.revision })}
      </Text>
      <Text style={{ color: c.foreground }}>
        {t('La sauvegarde crée une nouvelle révision. Les workflows déjà admis conservent leur définition.')}
      </Text>
      {input(t('Nom du workflow'), draft.name, (name) => setDraft((current) => ({ ...current, name })), 200)}
      {input(t('Budget global d’activations'), budget, setBudget, 4)}
      {draft.steps.map((step, index) => (
        <View key={step.id} style={{ gap: 12 }}>
          <Text style={{ color: c.foreground }}>
            {step.id} · {step.contract} · {step.selection.provider}
          </Text>
          {input(
            t('Consignes : {step}', { step: step.id }),
            step.instruction,
            (instruction) =>
              updateStep(index, (s) => {
                s.instruction = instruction;
              }),
            16000,
          )}
          {step.tests?.map((test, testIndex) => (
            <View key={testIndex} style={{ gap: 8 }}>
              {input(
                t('Commande : {step} / {index}', { step: step.id, index: testIndex + 1 }),
                test.command,
                (command) =>
                  updateStep(index, (s) => {
                    s.tests![testIndex].command = command;
                  }),
                8000,
              )}
              {input(
                t('Délai en ms : {step} / {index}', { step: step.id, index: testIndex + 1 }),
                String(test.timeoutMs),
                (value) =>
                  updateStep(index, (s) => {
                    s.tests![testIndex].timeoutMs = Number(value);
                  }),
                6,
              )}
            </View>
          ))}
        </View>
      ))}
      {parsed.success ? (
        <GraphDefinition definition={parsed.data} colors={c} />
      ) : (
        <Text accessibilityRole="alert" style={{ color: c.foreground }}>
          {t('Définition invalide : vérifiez les champs et les limites.')}
        </Text>
      )}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: c.foreground }}>
          {error}
        </Text>
      ) : null}
      {button(
        t('Sauvegarder une nouvelle révision'),
        () => {
          if (flight.current || !parsed.success) return;
          flight.current = true;
          setBusy(true);
          setError('');
          void save({
            workspaceId: record.workspaceId,
            id: record.id,
            expectedRevision: record.revision,
            definition: parsed.data,
          })
            .then(onSaved)
            .catch((e) => setError(String(e)))
            .finally(() => {
              flight.current = false;
              setBusy(false);
            });
        },
        busy || !parsed.success,
      )}
      {button(t('Annuler les modifications'), onCancel)}
    </View>
  );
}
