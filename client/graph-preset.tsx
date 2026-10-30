import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRpc } from '@getpaseo/plugin/client';
import { SettingsSelect, TextInput } from '@getpaseo/plugin/client/ui';
import { catalogRpc } from '../shared/contracts';
import { saveDefinitionRpc, type DefinitionRecord } from '../shared/definition-catalog';
import { codeReviewPreset, workflowDefinitionSchema } from '../shared/workflow-definition';
import { type TeamProviderChoice } from '../shared/team-composition';
import { readOnlyMode } from '../shared/provider-selection';
import { useT } from './i18n';

/** Saves a portable definition only; admission and execution remain explicit. */
export function GraphPreset({
  workspaceId,
  colors: c,
  onSaved,
}: {
  workspaceId: string;
  colors: { foreground: string; border: string };
  onSaved: (record: DefinitionRecord) => void;
}) {
  const t = useT();
  const choicesCall = useRpc(catalogRpc),
    save = useRpc(saveDefinitionRpc);
  const [providers, setProviders] = useState<TeamProviderChoice[]>();
  const [name, setName] = useState('Code ↔ Review'),
    [command, setCommand] = useState('');
  const [code, setCode] = useState(''),
    [review, setReview] = useState('');
  const [corrections, setCorrections] = useState('3'),
    [timeout, setTimeout] = useState('30000');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const flight = useRef(false);
  const options = (analysis: boolean) =>
    (providers ?? []).flatMap((p) => {
      if (p.id === 'agent-teams') return [];
      const mode = p.modes.find((m) =>
        analysis
          ? (p.family === 'codex' && m.id === 'read-only') || (p.family === 'claude' && m.id === 'plan')
          : !readOnlyMode(p.family, m.id),
      );
      return mode
        ? p.models.map((m) => ({
            value: JSON.stringify({ provider: `${p.id}/${m.id}`, modeId: mode.id }),
            label: `${p.label ?? p.id} · ${m.label ?? m.id} · ${mode.label ?? mode.id}`,
          }))
        : [];
    });
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
  return (
    <View style={{ gap: 12 }}>
      {button(
        t('Créer Code ↔ Review'),
        () =>
          void run(async () => {
            setProviders((await choicesCall({ workspaceId })).providers);
            setCode('');
            setReview('');
          }),
      )}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: c.foreground }}>
          {error}
        </Text>
      ) : null}
      {providers ? (
        <>
          {input(t('Nom du workflow'), name, setName, 200)}
          <SettingsSelect
            label={t('Code')}
            value={code}
            options={options(false)}
            disabled={busy}
            onValueChange={setCode}
          />
          <SettingsSelect
            label={t('Revue')}
            value={review}
            options={options(true)}
            disabled={busy}
            onValueChange={setReview}
          />
          <Text style={{ color: c.foreground }}>
            {t('La revue utilise uniquement les permissions natives de lecture seule vérifiées.')}
          </Text>
          <SettingsSelect
            label={t('Corrections automatiques')}
            value={corrections}
            disabled={busy}
            options={[0, 1, 2, 3, 4, 5, 10, 20, 50, 100].map((n) => ({ value: String(n), label: String(n) }))}
            onValueChange={setCorrections}
          />
          <Text style={{ color: c.foreground }}>
            {t('Budget global : {count} activations, code et revues inclus.', { count: 2 * (Number(corrections) + 1) })}
          </Text>
          {input(t('Commande de test explicite'), command, setCommand, 8000)}
          <SettingsSelect
            label={t('Délai de test')}
            value={timeout}
            disabled={busy}
            options={[1000, 5000, 10000, 30000].map((n) => ({ value: String(n), label: `${n / 1000} s` }))}
            onValueChange={setTimeout}
          />
          <Text style={{ color: c.foreground }}>
            {t('Une commande est requise ici. Elle sera exécutée après chaque étape Code, avant la revue.')}
          </Text>
          {button(
            t('Sauvegarder ce preset'),
            () =>
              void run(async () => {
                const definition = workflowDefinitionSchema.parse({
                  ...codeReviewPreset({ code: JSON.parse(code), review: JSON.parse(review) }, Number(corrections)),
                  name: name.trim(),
                });
                definition.steps[0].tests = [{ command: command.trim(), timeoutMs: Number(timeout) }];
                const record = await save({ workspaceId, expectedRevision: 0, definition });
                setProviders(undefined);
                onSaved(record);
              }),
            busy || !name.trim() || !command.trim() || !code || !review,
          )}
        </>
      ) : null}
    </View>
  );
}
