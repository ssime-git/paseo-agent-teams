import type { PluginButtonContentProps } from '@getpaseo/plugin/client';
import { useRpc } from '@getpaseo/plugin/client';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { z } from 'zod';
import { catalogRpc, createRpc, listRpc, roles, type Config, type Role } from '../shared/contracts';
import { parseProvider, INSTRUCTION_READ_ONLY } from '../shared/provider-selection';
import { configurationIssue, defaultRoles, isReadOnly, scopedLaunchConfig } from './configuration';
import { CompactSelect, CompactSwitch } from './controls';
import { RepositoryPicker } from './repository-picker';
import { useTeamDraft } from './drafts';
import { errorMessage } from './errors';
import { TeamRoster } from './team-roster';
import type { Workflow } from '../shared/contracts';
import { LockNotice } from './lock-notice';

/** Compact, configurable team composer; all choices come from the connected host. */
export function QuickStart(
  props: PluginButtonContentProps & { openPanel(workspaceId?: string): void; openHistory?(): void },
) {
  const { theme, host, workspaceId, layout, close, openPanel, openHistory } = props;
  const agentId = props.context === 'agent' ? props.agentId : undefined;
  const c = theme.colors;
  const catalogCall = useRpc(catalogRpc),
    createCall = useRpc(createRpc),
    listCall = useRpc(listRpc);
  const { config, setConfig, task, setTask, setView } = useTeamDraft(`${host.id}:${workspaceId}`);
  const [catalog, setCatalog] = useState<z.infer<typeof catalogRpc.output>>();
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [liveWorkflow, setLiveWorkflow] = useState<Workflow>();
  const [inspectNew, setInspectNew] = useState(false);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const list = await listCall({ workspaceId });
        if (live && Array.isArray(list)) {
          const visible = list.filter((w) => !w.events?.some((e) => e.kind === 'closed'));
          const owned = agentId
            ? visible.find(
                (w) =>
                  Object.values(w.agents ?? {}).includes(agentId) ||
                  Object.keys(w.requests ?? {}).some((key) => key.startsWith(`create:team:${agentId}:`)),
              )
            : undefined;
          setLiveWorkflow(
            owned ??
              visible.sort((a, b) => (a.events.at(-1)?.at ?? '').localeCompare(b.events.at(-1)?.at ?? '')).at(-1),
          );
        }
      } catch (e) {
        if (live) setError(errorMessage(e));
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [workspaceId, agentId]);
  const pending = useRef<{ key: string; id: string } | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setCatalog(undefined);
    catalogCall({ workspaceId, repositoryPaths: config.repositoryPaths })
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
  }, [workspaceId, refresh, JSON.stringify(config.repositoryPaths)]);
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
    const launchConfig = scopedLaunchConfig(config, catalog);
    const key = JSON.stringify({ workspaceId, task, config: launchConfig });
    if (pending.current?.key !== key)
      pending.current = { key, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
    try {
      const workflow = await createCall({ workspaceId, task, config: launchConfig, requestId: pending.current.id });
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
  const section = { padding: 18, gap: 12, borderBottomWidth: 1, borderBottomColor: c.border };
  const roleColors = { planner: '#a78bfa', builder: '#3291ff', reviewer: '#f5a623' };
  const showingLive = liveWorkflow && !inspectNew;
  return (
    <ScrollView
      testID="agent-teams-quick-start"
      style={{
        height: layout.compact ? 560 : undefined,
        maxHeight: layout.compact ? 560 : 760,
        backgroundColor: c.surface1,
      }}
      contentContainerStyle={{ width: layout.compact ? 320 : 460, maxWidth: '100%' }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={section}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              backgroundColor: c.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: c.accentForeground, fontWeight: '700', fontSize: 19 }}>✦</Text>
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: c.foreground, fontWeight: '600', fontSize: 18 }}>Team Auto</Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Plusieurs modèles. Un seul objectif.</Text>
          </View>
          {openHistory ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Historique des workflows"
              onPress={() => {
                close();
                openHistory();
              }}
              style={{ padding: 8 }}
            >
              <Text style={{ color: c.foregroundMuted }}>Historique ↗</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {showingLive ? (
        <View style={section}>
          <Text numberOfLines={3} style={{ color: c.foregroundMuted, fontSize: 13, lineHeight: 20 }}>
            {liveWorkflow.task}
          </Text>
          <TeamRoster
            config={liveWorkflow.config}
            workflow={liveWorkflow}
            providers={catalog?.providers}
            colors={c}
            compact={layout.compact}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ouvrir l’équipe active"
            onPress={() => {
              setView({ selected: liveWorkflow.id, showNew: false });
              close();
              openPanel();
            }}
            style={{ padding: 13, borderRadius: 12, backgroundColor: c.accent, alignItems: 'center' }}
          >
            <Text style={{ color: c.accentForeground, fontWeight: '600' }}>Ouvrir l’équipe →</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Préparer une nouvelle mission"
            onPress={() => setInspectNew(true)}
            style={{ padding: 10, alignItems: 'center' }}
          >
            <Text style={{ color: c.foregroundMuted }}>Préparer une nouvelle mission</Text>
          </Pressable>
        </View>
      ) : (
        <>
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
            <Text style={{ color: c.foreground, fontWeight: '600', fontSize: 15 }}>Que voulez-vous accomplir ?</Text>
            <TextInput
              accessibilityLabel="Tâche pour l’équipe"
              placeholder="Construire une fonctionnalité, corriger un bug…"
              placeholderTextColor={c.foregroundMuted}
              multiline
              value={task}
              onChangeText={setTask}
              editable={!busy}
              style={{
                color: c.foreground,
                backgroundColor: c.surface0,
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: 14,
                padding: 14,
                minHeight: 92,
                fontSize: 14,
                textAlignVertical: 'top',
              }}
            />
            <Text style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
              L’équipe prépare le plan, développe, teste et relit. Les modèles se passent la main automatiquement.
            </Text>
            <TeamRoster config={config} providers={catalog?.providers} colors={c} compact={layout.compact} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Personnaliser les modèles et réglages"
              accessibilityState={{ expanded: advanced }}
              onPress={() => setAdvanced((v) => !v)}
              style={{ paddingVertical: 8 }}
            >
              <Text style={{ color: c.accent, fontSize: 12 }}>
                {advanced ? 'Masquer les réglages ⌃' : 'Personnaliser les modèles et réglages ⌄'}
              </Text>
            </Pressable>
            <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
              {config.mode === 'manual' ? 'Relais manuel' : 'Relais automatique'} ·{' '}
              {config.validation === 'plan'
                ? 'Vous validez le plan'
                : config.validation === 'final'
                  ? 'Vous validez le résultat'
                  : 'Validation autonome configurée'}{' '}
              · {config.maxCorrections} corrections maximum
            </Text>
          </View>
          {advanced ? (
            <>
              <View style={section}>
                {catalog ? (
                  <RepositoryPicker
                    paths={config.repositoryPaths}
                    defaults={catalog.gitRoot ? [catalog.gitRoot] : (catalog.repositories ?? [])}
                    candidates={catalog.repositories ?? []}
                    truncated={catalog.searchTruncated}
                    colors={c}
                    onChange={(repositoryPaths) => setConfig((cur) => ({ ...cur, repositoryPaths }))}
                  />
                ) : null}
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
                  label="Poursuivre jusqu’à l’objectif"
                  value={config.goalMode ?? false}
                  onValueChange={(goalMode) =>
                    setConfig((cur) => ({
                      ...cur,
                      goalMode,
                      ...(goalMode
                        ? { autoFix: true, recovery: 'automatic' as const, freshSessionPerCycle: true }
                        : {}),
                    }))
                  }
                />
                {config.goalMode ? (
                  <>
                    <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
                      Développer et tester, corriger, puis revoir le plan si nécessaire. Après la première approbation,
                      les commandes peuvent évoluer automatiquement. Les permissions et blocages externes restent
                      visibles. Budget de 2 h ; pause possible à tout moment.
                    </Text>
                    <CompactSelect
                      colors={c}
                      label="Budget de tours d’agents"
                      value={String(config.goalMaxTurns ?? 30)}
                      options={[10, 20, 30, 50, 100].map((n) => ({ label: String(n), value: String(n) }))}
                      onValueChange={(v) => setConfig((cur) => ({ ...cur, goalMaxTurns: Number(v) }))}
                    />
                  </>
                ) : null}
                <CompactSwitch
                  colors={c}
                  label="Auto-accept du Builder"
                  value={config.builderAutoAccept}
                  onValueChange={(builderAutoAccept) => setConfig((cur) => ({ ...cur, builderAutoAccept }))}
                />
                <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>
                  Mode autonome natif du Builder ; les autres rôles restent en lecture seule. Désactivez pour valider
                  ses demandes dans Team.
                </Text>
                <CompactSwitch
                  colors={c}
                  label="Corrections automatiques"
                  value={config.autoFix}
                  onValueChange={(v) => setConfig((cur) => ({ ...cur, autoFix: v }))}
                />
                {config.autoFix ? (
                  <CompactSelect
                    colors={c}
                    label={config.goalMode ? 'Corrections avant retour au Planner' : 'Cycles maximum'}
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
            </>
          ) : null}
          <View style={section}>
            {error || issue ? (
              <Text
                accessibilityRole="alert"
                style={{ color: error ? c.statusDanger : c.foregroundMuted, fontSize: 12 }}
              >
                {error || issue}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Lancer l’équipe"
              disabled={busy || !!issue}
              onPress={() => void start()}
              style={{
                alignItems: 'center',
                backgroundColor: c.accent,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 14,
                opacity: busy || issue ? 0.4 : 1,
              }}
            >
              <Text style={{ color: c.accentForeground, fontSize: 14, fontWeight: '500' }}>
                {busy ? 'Lancement…' : 'Lancer l’équipe'}
              </Text>
            </Pressable>
          </View>
        </>
      )}
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
