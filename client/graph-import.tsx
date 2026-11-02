import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRpc } from '@getpaseo/plugin/client';
import { TextInput } from '@getpaseo/plugin/client/ui';
import { saveDefinitionRpc, type DefinitionRecord } from '../shared/definition-catalog';
import { workflowDefinitionSchema, type WorkflowDefinition } from '../shared/workflow-definition';
import { GraphDefinition } from './graph-definition';
import { useT } from './i18n';

/** Import saves a new definition; repository admission stays separate. */
export function GraphImport({
  workspaceId,
  colors: c,
  onSaved,
}: {
  workspaceId: string;
  colors: { foreground: string; border: string };
  onSaved: (record: DefinitionRecord) => void;
}) {
  const t = useT(),
    save = useRpc(saveDefinitionRpc);
  const [opened, setOpened] = useState(false),
    [json, setJson] = useState('');
  const [preview, setPreview] = useState<WorkflowDefinition>();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const flight = useRef(false);
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
      {button(t('Importer un workflow (JSON)'), () => setOpened(true))}
      {opened ? (
        <>
          <Text style={{ color: c.foreground }}>
            {t('Collez une définition portable. La confirmation crée une nouvelle identité sans lancer le workflow.')}
          </Text>
          <TextInput
            accessibilityLabel={t('Définition à importer (JSON)')}
            multiline
            value={json}
            editable={!busy}
            onChangeText={(value) => {
              setJson(value);
              setPreview(undefined);
              setError('');
            }}
            style={{
              height: 160,
              padding: 12,
              color: c.foreground,
              borderColor: c.border,
              borderWidth: 1,
              borderRadius: 8,
            }}
          />
          {button(
            t('Valider et prévisualiser l’import'),
            () => {
              setPreview(undefined);
              setError('');
              try {
                setPreview(workflowDefinitionSchema.parse(JSON.parse(json)));
              } catch (e) {
                setError(String(e));
              }
            },
            busy || !json.trim(),
          )}
          {error ? (
            <Text accessibilityRole="alert" style={{ color: c.foreground }}>
              {error}
            </Text>
          ) : null}
          {preview ? (
            <>
              <Text style={{ color: c.foreground }}>{preview.name}</Text>
              <GraphDefinition definition={preview} colors={c} />
              {button(t('Confirmer l’import comme nouveau workflow'), () => {
                if (flight.current) return;
                flight.current = true;
                setBusy(true);
                setError('');
                void save({ workspaceId, expectedRevision: 0, definition: preview })
                  .then((record) => {
                    setOpened(false);
                    setJson('');
                    setPreview(undefined);
                    onSaved(record);
                  })
                  .catch((e: unknown) => setError(String(e)))
                  .finally(() => {
                    flight.current = false;
                    setBusy(false);
                  });
              })}
            </>
          ) : null}
          {button(t('Annuler l’import'), () => {
            setOpened(false);
            setJson('');
            setPreview(undefined);
            setError('');
          })}
        </>
      ) : null}
    </View>
  );
}
