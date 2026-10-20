import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { PluginHostProps } from '@getpaseo/plugin/client';
import type { z } from 'zod';
import { catalogRpc, type Action, type Config, type Role, type Workflow, roles } from '../shared/contracts';
import { parseProvider, readOnlyMode } from '../shared/provider-selection';
import { CompactSelect } from './controls';

type Props = {
  workflow: Workflow;
  providers: z.infer<typeof catalogRpc.output>['providers'];
  colors: PluginHostProps['theme']['colors'];
  busy: boolean;
  onAction(action: Action['action'], extra?: Partial<Action>): Promise<void> | undefined;
};
export function WorkflowRecovery({ workflow, providers, colors: c, busy, onAction }: Props) {
  const [role, setRole] = useState<Role>('builder');
  const [selection, setSelection] = useState<Config['roles'][Role]>(workflow.config.roles.builder);
  const [extraCorrections, setExtra] = useState('2');
  const [message, setMessage] = useState('');
  const { harness, model } = parseProvider(selection.provider);
  const provider = providers.find((p) => p.id === harness);
  const modes = provider?.modes.filter((m) => role === 'builder' || readOnlyMode(provider.family, m.id)) ?? [];
  const valid = provider?.models.some((m) => m.id === model) && modes.some((m) => m.id === selection.modeId);
  const changed = JSON.stringify(selection) !== JSON.stringify(workflow.config.roles[role]);
  const button = (label: string, press: () => void, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy || disabled}
      onPress={press}
      style={{
        padding: 10,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: 6,
        opacity: busy || disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: c.foreground }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ padding: 12, gap: 12, borderWidth: 1, borderColor: c.border, borderRadius: 8 }}>
      <Text accessibilityRole="header" style={{ color: c.foreground, fontWeight: '600' }}>
        Continuer le workflow
      </Text>
      <Text style={{ color: c.foregroundMuted }}>
        Conserve le contexte, les fichiers et les résultats. Un changement de harnais ou modèle crée une nouvelle
        session pour la phase concernée.
      </Text>
      {workflow.config.mode === 'auto'
        ? button('Poursuivre jusqu’à l’objectif', () => {
            void onAction('start_goal');
          })
        : null}
      <Text style={{ color: c.foregroundMuted }}>
        La poursuite repart du Planner avec le contexte actuel : budget renouvelé de{' '}
        {workflow.config.goalMaxTurns ?? 30} tours, replanification et commandes de test automatiques après approbation
        initiale.
      </Text>
      <CompactSelect
        colors={c}
        label="Phase à modifier ou reprendre"
        value={role}
        disabled={busy}
        options={roles.map((r) => ({ label: r, value: r }))}
        onValueChange={(value) => {
          const r = value as Role;
          setRole(r);
          setSelection(workflow.config.roles[r]);
        }}
      />
      <CompactSelect
        colors={c}
        label="Reprise · harnais"
        value={harness}
        disabled={busy}
        options={providers.map((p) => ({ label: p.label, value: p.id }))}
        onValueChange={(id) => {
          const p = providers.find((p) => p.id === id),
            m = p?.models.find((m) => m.isDefault) ?? p?.models[0];
          const mode = p?.modes.find((m) => role === 'builder' || readOnlyMode(p.family, m.id));
          if (m && mode) setSelection({ provider: `${id}/${m.id}`, modeId: mode.id });
        }}
      />
      <CompactSelect
        colors={c}
        label="Reprise · modèle"
        value={model}
        disabled={busy}
        options={(provider?.models ?? []).map((m) => ({ label: m.label, value: m.id }))}
        onValueChange={(id) => setSelection((s) => ({ ...s, provider: `${harness}/${id}` }))}
      />
      <CompactSelect
        colors={c}
        label="Reprise · permissions"
        value={selection.modeId}
        disabled={busy}
        options={modes.map((m) => ({ label: m.label, value: m.id }))}
        onValueChange={(modeId) => setSelection((s) => ({ ...s, modeId }))}
      />
      {button(
        'Appliquer le harnais et le modèle',
        () => {
          void onAction('reconfigure', { role, selection });
        },
        !valid || !changed,
      )}
      <CompactSelect
        colors={c}
        label="Cycles supplémentaires"
        value={extraCorrections}
        disabled={busy}
        options={[1, 2, 3, 4, 5, 10].map((n) => ({ label: String(n), value: String(n) }))}
        onValueChange={setExtra}
      />
      <TextInput
        accessibilityLabel="Instructions de reprise"
        placeholder="Instructions pour la reprise (facultatif)"
        placeholderTextColor={c.foregroundMuted}
        multiline
        editable={!busy}
        value={message}
        onChangeText={setMessage}
        style={{ color: c.foreground, borderWidth: 1, borderColor: c.border, borderRadius: 6, padding: 10 }}
      />
      {changed ? (
        <Text style={{ color: c.foregroundMuted }}>
          Appliquez le changement de modèle avant de reprendre cette phase.
        </Text>
      ) : null}
      {button(
        'Repasser par le Planner',
        () => {
          void onAction('continue', { role: 'planner', extraCorrections: Number(extraCorrections), message });
        },
        changed,
      )}
      {button(
        'Continuer depuis cette phase',
        () => {
          void onAction('continue', { role, extraCorrections: Number(extraCorrections), message });
        },
        changed,
      )}
    </View>
  );
}
