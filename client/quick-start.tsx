import type { PluginButtonContentProps } from '@getpaseo/plugin/client';
import { useRpc } from '@getpaseo/plugin/client';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { z } from 'zod';
import { catalogRpc, createRpc, roles, type Config, type Role } from '../shared/contracts';
import { parseProvider, INSTRUCTION_READ_ONLY } from '../shared/provider-selection';
import { configurationIssue, defaultRoles, isReadOnly } from './configuration';
import { CompactSelect, CompactSwitch } from './controls';
import { useTeamDraft } from './drafts';
import { errorMessage } from './errors';
import { LockNotice } from './lock-notice';

/** Compact, configurable team composer; all choices come from the connected host. */
export function QuickStart({
  theme,
  host,
  workspaceId,
  layout,
  close,
  openPanel,
  openHistory,
}: PluginButtonContentProps & { openPanel(workspaceId?: string): void; openHistory?(): void }) {
  const c = theme.colors;
  const catalogCall = useRpc(catalogRpc),
    createCall = useRpc(createRpc);
  const { config, setConfig, task, setTask, setView } = useTeamDraft(`${host.id}:${workspaceId}`);
  const [catalog, setCatalog] = useState<z.infer<typeof catalogRpc.output>>();
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef<{ key: string; id: string } | undefined>(undefined);
  useEffect(() => {
    let live = true;
    catalogCall({ workspaceId })
      .then((value) => {
        if (!live) return;
        setCatalog(value);
        setConfig((cur) => ({ ...cur, roles: defaultRoles(value.providers, cur.roles) }));
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [workspaceId, refresh]);
  const issue = !catalog
    ? 'Chargement…'
    : ((catalog.launchIssue || undefined) ??
      (catalog.blockingWorkflow ? 'Un workflow conserve le verrou de ce dépôt.' : undefined) ??
      configurationIssue(config, catalog.providers) ??
      (!task.trim() ? 'Décrivez la tâche.' : undefined));
  const updateRole = (role: Role, harness: string, modelId?: string) => {
    const provider = catalog?.providers.find((p) => p.id === harness);
    const model =
      provider?.models.find((m) => m.id === modelId) ??
      provider?.models.find((m) => m.isDefault) ??
      provider?.models[0];
    const mode = provider?.modes.find((m) => role === 'builder' || isReadOnly(provider.family, m.id));
    setConfig((cur) => ({
      ...cur,
      roles: { ...cur.roles, [role]: { provider: `${harness}/${model?.id ?? ''}`, modeId: mode?.id ?? '' } },
    }));
  };
  const start = async () => {
    if (busy || issue) return;
    setBusy(true);
    setError('');
    const key = JSON.stringify({ workspaceId, task, config });
    if (pending.current?.key !== key)
      pending.current = { key, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
    try {
      const workflow = await createCall({ workspaceId, task, config, requestId: pending.current.id });
      setView({ selected: workflow.id, showNew: false });
      pending.current = undefined;
      close();
      openPanel();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const section = { padding: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: c.border };
  const roleColors = { planner: '#a78bfa', builder: '#3291ff', reviewer: '#f5a623' };
  return (
    <ScrollView
      testID="agent-teams-quick-start"
      style={{ maxHeight: layout.compact ? 620 : 680, backgroundColor: c.surface1 }}
      contentContainerStyle={{ width: layout.compact ? 300 : 400, maxWidth: '100%' }}
      keyboardShouldPersistTaps="handled"
    >
      <LockNotice
        blocker={catalog?.blockingWorkflow}
        theme={theme}
        host={host}
        onOpen={(target) => {
          close();
          openPanel(target);
        }}
        onRefresh={() => setRefresh((value) => value + 1)}
      />
      <View style={section}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.statusSuccess }} />
          <Text style={{ color: c.foreground, fontWeight: '600', fontSize: 13 }}>Mode agent</Text>
          {openHistory ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Historique des workflows"
              onPress={() => {
                close();
                openHistory();
              }}
            >
              <Text style={{ color: c.foregroundMuted }}>Historique ↗</Text>
            </Pressable>
          ) : null}
          <Text style={{ marginLeft: 'auto', color: c.foregroundMuted, fontSize: 11 }}>
            Plan → Build → Tests → Review
          </Text>
        </View>
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Une tâche, trois rôles, une conversation.</Text>
      </View>
      <View style={section}>
        {roles.map((role) => {
          const selection = config.roles[role];
          const { harness, model } = selection.provider
            ? parseProvider(selection.provider)
            : { harness: '', model: '' };
          const provider = catalog?.providers.find((p) => p.id === harness);
          return (
            <View key={role} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                <View style={{ width: 76, minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: roleColors[role] }} />
                  <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
                    {role[0].toUpperCase() + role.slice(1)}
                  </Text>
                </View>
                <CompactSelect
                  hideLabel
                  colors={c}
                  label={`${role} · harnais`}
                  value={harness}
                  options={(catalog?.providers ?? []).map((p) => ({ label: p.label, value: p.id }))}
                  onValueChange={(id) => updateRole(role, id)}
                  disabled={busy}
                />
                <CompactSelect
                  hideLabel
                  colors={c}
                  label={`${role} · modèle`}
                  value={model}
                  options={(provider?.models ?? []).map((m) => ({ label: m.label, value: m.id }))}
                  onValueChange={(id) => updateRole(role, harness, id)}
                  disabled={busy}
                />
              </View>
              {selection.modeId === INSTRUCTION_READ_ONLY ? (
                <Text style={{ color: c.statusWarning, fontSize: 11 }}>
                  Lecture seule par consigne, sans sandbox garantie.
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
      <View style={section}>
        <CompactSelect
          colors={c}
          label="Mode"
          value={config.mode}
          options={[
            { label: 'Auto Workflow', value: 'auto' },
            { label: 'Manual Switch', value: 'manual' },
          ]}
          onValueChange={(v) => setConfig((cur) => ({ ...cur, mode: v as Config['mode'] }))}
        />
        <CompactSelect
          colors={c}
          label="Validation humaine"
          value={config.validation}
          options={[
            { label: 'Après le plan', value: 'plan' },
            { label: 'À la fin', value: 'final' },
            { label: 'Autonome', value: 'autonomous' },
          ]}
          onValueChange={(v) => setConfig((cur) => ({ ...cur, validation: v as Config['validation'] }))}
        />
        <CompactSwitch
          colors={c}
          label="Corrections automatiques"
          value={config.autoFix}
          onValueChange={(v) => setConfig((cur) => ({ ...cur, autoFix: v }))}
        />
        {config.autoFix ? (
          <CompactSelect
            colors={c}
            label="Cycles maximum"
            value={String(config.maxCorrections)}
            options={Array.from({ length: 11 }, (_, i) => ({ label: String(i), value: String(i) }))}
            onValueChange={(v) => setConfig((cur) => ({ ...cur, maxCorrections: Number(v) }))}
          />
        ) : null}
        <CompactSwitch
          colors={c}
          label="Session neuve à chaque correction"
          value={config.freshSessionPerCycle}
          onValueChange={(v) => setConfig((cur) => ({ ...cur, freshSessionPerCycle: v }))}
        />
      </View>
      <View style={section}>
        <TextInput
          accessibilityLabel="Tâche pour l’équipe"
          placeholder="Décris la tâche pour l’équipe…"
          placeholderTextColor={c.foregroundMuted}
          multiline
          value={task}
          onChangeText={setTask}
          style={{
            color: c.foreground,
            borderColor: c.border,
            borderWidth: 1,
            borderRadius: 8,
            padding: 10,
            minHeight: 60,
            backgroundColor: c.surface0,
            fontSize: 13,
          }}
        />
        {error || issue ? (
          <Text accessibilityRole="alert" style={{ color: error ? c.statusDanger : c.foregroundMuted, fontSize: 12 }}>
            {error || issue}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Lancer l’équipe"
          disabled={busy || !!issue}
          onPress={() => void start()}
          style={{
            alignSelf: 'flex-end',
            backgroundColor: c.foreground,
            borderRadius: 6,
            paddingHorizontal: 12,
            paddingVertical: 8,
            opacity: busy || issue ? 0.4 : 1,
          }}
        >
          <Text style={{ color: c.surface0, fontSize: 12, fontWeight: '500' }}>
            {busy ? 'Lancement…' : 'Lancer l’équipe'}
          </Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ouvrir le panneau complet"
        onPress={() => {
          setView({ showNew: true, showConfig: true });
          close();
          openPanel();
        }}
        style={{ padding: 12 }}
      >
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Ouvrir le panneau complet ↗</Text>
      </Pressable>
    </ScrollView>
  );
}
