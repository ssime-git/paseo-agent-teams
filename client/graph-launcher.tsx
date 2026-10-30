import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRpc } from '@getpaseo/plugin/client';
import { TextInput } from '@getpaseo/plugin/client/ui';
import type { z } from 'zod';
import { listDefinitionsRpc, type DefinitionRecord } from '../shared/definition-catalog';
import { graphPreviewRpc, graphConfirmRpc } from '../shared/graph-actions';
import type { GraphCheckpoint } from '../shared/graph-checkpoint';
import { useT } from './i18n';

type Preview = z.infer<typeof graphPreviewRpc.output>;
// An idempotency identity, not a security token; works on native hosts without Web Crypto.
const launchId = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });

/** Explicit admission only. Continuing a run remains a separate inbox action. */
export function GraphLauncher({
  workspaceId,
  ownerAgentId,
  colors: c,
  onAdmitted,
}: {
  workspaceId: string;
  ownerAgentId: string;
  colors: { foreground: string; border: string };
  onAdmitted: (state: GraphCheckpoint) => void;
}) {
  const t = useT();
  const list = useRpc(listDefinitionsRpc),
    preview = useRpc(graphPreviewRpc),
    confirm = useRpc(graphConfirmRpc);
  const [opened, setOpened] = useState(false),
    [busy, setBusy] = useState(false);
  const [records, setRecords] = useState<DefinitionRecord[]>([]),
    [selected, setSelected] = useState<DefinitionRecord>();
  const [task, setTask] = useState(''),
    [error, setError] = useState('');
  const [pending, setPending] = useState<{ value: Preview; id: string }>();
  const flight = useRef(false);
  const run = async (job: () => Promise<void>) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      await job();
    } catch (e) {
      setError(String(e));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };
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
  return (
    <View style={{ gap: 12 }}>
      {button(t('Lancer un workflow sauvegardé'), () => {
        void run(async () => {
          setRecords(await list({ workspaceId }));
          setOpened(true);
          setPending(undefined);
          setSelected(undefined);
        });
      })}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: c.foreground }}>
          {error}
        </Text>
      ) : null}
      {opened ? (
        <>
          {!records.length ? (
            <Text style={{ color: c.foreground }}>{t('Aucun workflow sauvegardé dans cet espace.')}</Text>
          ) : null}
          {records.map((record) => (
            <View key={record.id}>
              {button(`${record.definition.name} · ${t('Révision {revision}', { revision: record.revision })}`, () => {
                setSelected(record);
                setPending(undefined);
              })}
            </View>
          ))}
          <TextInput
            accessibilityLabel={t('Objectif du workflow')}
            placeholder={t('Objectif du workflow')}
            multiline
            value={task}
            editable={!busy}
            maxLength={16000}
            onChangeText={(value) => {
              setTask(value);
              setPending(undefined);
            }}
            style={{
              minHeight: 100,
              padding: 12,
              color: c.foreground,
              borderColor: c.border,
              borderWidth: 1,
              borderRadius: 8,
            }}
          />
          {button(
            t('Prévisualiser ce workflow'),
            () => {
              void run(async () => {
                if (!selected) return;
                setPending(undefined);
                const value = await preview({
                  workspaceId,
                  ownerAgentId,
                  definitionId: selected.id,
                  definitionRevision: selected.revision,
                  task: task.trim(),
                });
                setPending({ value, id: launchId() });
              });
            },
            busy || !selected || !task.trim(),
          )}
          {pending ? (
            <View style={{ gap: 12 }}>
              <Text style={{ color: c.foreground }}>{t('Définition exacte à confirmer')}</Text>
              <Text style={{ color: c.foreground }}>
                {pending.value.source.definition.name} ·{' '}
                {t('Révision {revision}', { revision: pending.value.source.revision })}
              </Text>
              <Text style={{ color: c.foreground }}>{pending.value.repository.root}</Text>
              <Text style={{ color: c.foreground }}>{pending.value.task}</Text>
              <Text selectable style={{ color: c.foreground, flexShrink: 1 }}>
                {JSON.stringify(pending.value.source.definition, null, 2)}
              </Text>
              <Text style={{ color: c.foreground }}>
                {t('La confirmation réserve le dépôt. Elle ne démarre aucune étape.')}
              </Text>
              {button(t('Confirmer cette définition et réserver le dépôt'), () => {
                void run(async () => {
                  const state = await confirm({
                    workspaceId,
                    ownerAgentId,
                    id: pending.id,
                    definitionId: pending.value.source.id,
                    definitionRevision: pending.value.source.revision,
                    task: pending.value.task,
                    confirmation: pending.value.confirmation,
                    approveDefinition: true,
                  });
                  setPending(undefined);
                  setOpened(false);
                  onAdmitted(state);
                });
              })}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
