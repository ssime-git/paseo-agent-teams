import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRpc } from '@getpaseo/plugin/client';
import { SettingsSelect, TextInput } from '@getpaseo/plugin/client/ui';
import { listDefinitionsRpc, saveDefinitionRpc, type DefinitionRecord } from '../shared/definition-catalog';
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
    save = useRpc(saveDefinitionRpc),
    list = useRpc(listDefinitionsRpc);
  const [base, setBase] = useState(record);
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
          i === index
            ? {
                ...step,
                transitions: step.transitions.map((edge) => ({ ...edge })),
                ...(step.tests ? { tests: step.tests.map((test) => ({ ...test })) } : {}),
              }
            : step,
        ),
      };
      update(next.steps[index]);
      return next;
    });
  };
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: c.foreground }}>
        {base.definition.name} · {t('Révision {revision}', { revision: base.revision })}
      </Text>
      <Text style={{ color: c.foreground }}>
        {t('La sauvegarde crée une nouvelle révision. Les workflows déjà admis conservent leur définition.')}
      </Text>
      {input(t('Nom du workflow'), draft.name, (name) => setDraft((current) => ({ ...current, name })), 200)}
      {input(t('Budget global d’activations'), budget, setBudget, 4)}
      <SettingsSelect
        label={t('Étape de départ')}
        value={draft.entry}
        options={draft.steps.map((step) => ({ value: step.id, label: step.id }))}
        disabled={busy}
        onValueChange={(entry) => setDraft((current) => ({ ...current, entry }))}
      />
      <Text style={{ color: c.foreground }}>
        {t(
          'Une copie conserve le contrat, le modèle, les droits et les tests. Reliez-la au parcours avant de sauvegarder. Pour supprimer une étape, retirez ses références et changez le départ si nécessaire.',
        )}
      </Text>
      {draft.steps.map((step, index) => (
        <View key={step.id} style={{ gap: 12 }}>
          <Text style={{ color: c.foreground }}>
            {step.id} · {step.contract} · {step.selection.provider}
          </Text>
          {button(
            t('Dupliquer l’étape : {step}', { step: step.id }),
            () =>
              setDraft((current) => {
                let suffix = 2;
                let id = `step-${suffix}`;
                while (current.steps.some((candidate) => candidate.id === id)) id = `step-${++suffix}`;
                const source = current.steps[index];
                const copy = {
                  ...source,
                  id,
                  selection: { ...source.selection },
                  transitions: source.transitions.map((edge) => ({ ...edge })),
                  ...(source.tests ? { tests: source.tests.map((test) => ({ ...test })) } : {}),
                };
                return { ...current, steps: [...current.steps, copy] };
              }),
            busy || draft.steps.length >= 100,
          )}
          {button(
            t('Supprimer l’étape : {step}', { step: step.id }),
            () => setDraft((current) => ({ ...current, steps: current.steps.filter((s) => s.id !== step.id) })),
            busy || draft.entry === step.id || draft.steps.some((s) => s.transitions.some((e) => e.target === step.id)),
          )}
          {step.contract !== 'human' ? (
            <SettingsSelect
              label={t('Contrat : {step}', { step: step.id })}
              value={step.contract}
              options={['plan', 'build', 'review'].map((value) => ({ value, label: value }))}
              disabled={busy}
              onValueChange={(value) => {
                if (value !== 'plan' && value !== 'build' && value !== 'review') return;
                updateStep(index, (s) => {
                  s.contract = value;
                  if (value !== 'build') s.access = 'read-only';
                });
              }}
            />
          ) : null}
          <SettingsSelect
            label={t('Accès au dépôt : {step}', { step: step.id })}
            value={step.access}
            options={[
              { value: 'read-only', label: t('Lecture seule') },
              ...(step.contract === 'build' ? [{ value: 'write', label: t('Écriture') }] : []),
            ]}
            disabled={busy || step.contract !== 'build'}
            onValueChange={(value) => {
              if (value !== 'read-only' && value !== 'write') return;
              if (step.contract !== 'build') return;
              updateStep(index, (s) => {
                s.access = value;
              });
            }}
          />
          {input(
            t('Consignes : {step}', { step: step.id }),
            step.instruction,
            (instruction) =>
              updateStep(index, (s) => {
                s.instruction = instruction;
              }),
            16000,
          )}
          {step.transitions.map((edge, edgeIndex) => (
            <SettingsSelect
              key={edge.outcome}
              label={t('Destination : {step} / {outcome}', { step: step.id, outcome: edge.outcome })}
              value={edge.target === null ? 'end' : `step:${edge.target}`}
              options={[
                { value: 'end', label: t('Fin du parcours') },
                ...draft.steps.map((target) => ({ value: `step:${target.id}`, label: target.id })),
              ]}
              disabled={busy}
              onValueChange={(value) =>
                updateStep(index, (s) => {
                  s.transitions[edgeIndex].target = value === 'end' ? null : value.slice(5);
                })
              }
            />
          ))}
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
              {button(t('Supprimer le test : {step} / {index}', { step: step.id, index: testIndex + 1 }), () =>
                updateStep(index, (s) => {
                  s.tests!.splice(testIndex, 1);
                  if (!s.tests!.length) delete s.tests;
                }),
              )}
            </View>
          ))}
          {step.contract !== 'human' ? (
            <>
              {button(
                t('Ajouter un test : {step}', { step: step.id }),
                () =>
                  updateStep(index, (s) => {
                    s.tests = [...(s.tests ?? []), { command: '', timeoutMs: 1000 }];
                  }),
                busy || (step.tests?.length ?? 0) >= 10,
              )}
              {!step.tests?.length && step.contract === 'build' ? (
                <Text style={{ color: c.foreground }}>
                  {t('Sans tests configurés, une décision humaine explicite sera nécessaire à l’exécution.')}
                </Text>
              ) : null}
            </>
          ) : null}
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
            workspaceId: base.workspaceId,
            id: base.id,
            expectedRevision: base.revision,
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
      {error
        ? button(t('Abandonner le brouillon et recharger la dernière révision'), () => {
            if (flight.current) return;
            flight.current = true;
            setBusy(true);
            void list({ workspaceId: base.workspaceId })
              .then((records) => {
                const latest = records.find((item) => item.id === base.id);
                if (!latest) throw new Error(t('Définition introuvable ; le brouillon est conservé.'));
                const definition = workflowDefinitionSchema.parse(latest.definition);
                setBase(latest);
                setDraft(definition);
                setBudget(String(definition.maxTransitions));
                setError('');
              })
              .catch((e) => setError(String(e)))
              .finally(() => {
                flight.current = false;
                setBusy(false);
              });
          })
        : null}
      {button(t('Annuler les modifications'), onCancel)}
    </View>
  );
}
