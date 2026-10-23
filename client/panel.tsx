import { TeamRoster } from './team-roster';
import { useT } from './i18n';
import { Clarifications } from './clarifications';
import { Disclosure } from './disclosure';
import { LiveWorkflowAction, GoalAction } from './workflow-action';
import { errorMessage } from './errors';
import type { PluginWorkspacePanelProps, PluginTimelineItemProps } from '@getpaseo/plugin/client';
import { useRpc } from '@getpaseo/plugin/client';
import { CompactSelect as SettingsSelect, CompactSwitch as SettingsSwitch } from './controls';
import { HANDOFF_BUDGET } from '../shared/context';
import { useTeamDraft } from './drafts';
import { LockNotice } from './lock-notice';
import { TeamPermissions } from './permissions';
import { WorkflowRecovery } from './recovery';
import { RepositoryPicker } from './repository-picker';
import { StageResult } from './stage-result';
import { CompletionSummary } from './completion';
import { TestLog } from './test-log';
import type { z } from 'zod';
import { cardSchema } from '../shared/contracts';
import { useQuery } from '@tanstack/react-query';
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  actionRpc,
  catalogRpc,
  createRpc,
  listRpc,
  testOutputRpc,
  roles,
  type Action,
  type Config,
} from '../shared/contracts';
import {
  exportConfig,
  importConfig,
  commandsFromText,
  configurationIssue,
  scopedLaunchConfig,
  defaultRoles,
  isReadOnly,
} from './configuration';
import { copyConfiguration } from './web';
import { INSTRUCTION_READ_ONLY, parseProvider } from '../shared/provider-selection';
import { Markdown } from './markdown';
import { renderEvent, roleLabel, steps } from './events';

const requestId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function ProgressCard({
  item,
  theme,
  layout,
  host,
  onOpenWorkflow,
}: PluginTimelineItemProps<z.infer<typeof cardSchema>> & { onOpenWorkflow?: () => void }) {
  const { colors } = theme;
  const t = useT();
  const [phase, status] = item.data.status.split(' · ');
  const phaseName =
    status === 'awaiting_plan'
      ? t('Plan à valider')
      : status === 'awaiting_final'
        ? t('Résultat à valider')
        : (steps.find((step) => step.phase === phase)?.label ??
          (phase === 'followup' ? t('Suivi') : ['done', 'completed'].includes(phase) ? t('Terminé') : phase));
  const tone =
    status === 'attention'
      ? colors.statusDanger
      : status === 'completed'
        ? colors.statusSuccess
        : ['awaiting_plan', 'awaiting_final', 'paused', 'permission'].includes(status)
          ? colors.statusWarning
          : colors.accent;
  return (
    <View
      style={{
        padding: layout.compact ? 10 : 14,
        gap: 4,
        backgroundColor: colors.surface1,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
      }}
    >
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Text style={{ color: colors.foreground, fontWeight: '600' }}>Agent Teams</Text>
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 99,
            paddingHorizontal: 8,
            paddingVertical: 2,
            flexDirection: 'row',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tone }} />
          <Text style={{ color: tone, fontSize: 11 }}>{phaseName}</Text>
        </View>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          correction {item.data.cycle}
          {item.data.maxCorrections != null ? `/${item.data.maxCorrections}` : ''}
        </Text>
      </View>
      {item.data.artifact ? (
        <Disclosure title={t('Voir le compte rendu de l’étape')} colors={colors}>
          <StageResult role={item.data.artifact.role} text={item.data.artifact.text} colors={colors} />
        </Disclosure>
      ) : (
        <Markdown
          source={item.data.detail.length > 280 ? item.data.detail.slice(0, 280) + '…' : item.data.detail}
          colors={colors}
        />
      )}
      {item.data.handoffTokens != null ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
          Handoff ≈ {(item.data.handoffTokens / 1000).toFixed(1)}k tokens
        </Text>
      ) : null}
      {onOpenWorkflow && item.data.workspaceId ? (
        <LiveWorkflowAction
          snapshot={{ phase, cycle: item.data.cycle }}
          workflowId={item.data.workflowId}
          workspaceId={item.data.workspaceId}
          colors={colors}
          hostId={host.id}
          onOpen={onOpenWorkflow}
        />
      ) : onOpenWorkflow ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Ouvrir le workflow Agent Teams')}
          onPress={onOpenWorkflow}
        >
          <Text style={{ color: colors.accent, fontSize: 12 }}>{t('Ouvrir l’équipe ↗')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
export function TeamsPanel(
  props: PluginWorkspacePanelProps & {
    onChooseRepository?: (path: string) => Promise<void>;
    onOpenWorkspace?: (workspaceId: string) => void;
    onOpenHistory?: () => void;
  },
) {
  const { workspaceId, theme, layout, navigation } = props;
  const t = useT();
  const thread = useRef<ScrollView>(null);
  const testsPosition = useRef(0);
  const [showContext, setShowContext] = useState(false);
  const pendingRequests = useRef(new Map<string, string>());
  const intentionId = (key: string) => {
    const id = pendingRequests.current.get(key) ?? requestId();
    pendingRequests.current.set(key, id);
    return id;
  };
  const catalogCall = useRpc(catalogRpc),
    listCall = useRpc(listRpc),
    createCall = useRpc(createRpc),
    actionCall = useRpc(actionRpc),
    testOutputCall = useRpc(testOutputRpc);
  const { config, setConfig, task, setTask, view, setView } = useTeamDraft(`${props.host.id}:${workspaceId}`);
  const catalog = useQuery({
    queryKey: ['agent-teams-catalog', props.host.id, workspaceId, config.repositoryPaths],
    queryFn: () => catalogCall({ workspaceId, repositoryPaths: config.repositoryPaths }),
    refetchInterval: 30_000,
  });
  const workflows = useQuery({
    queryKey: ['agent-teams-workflows', props.host.id, workspaceId],
    queryFn: () => listCall({ workspaceId }),
    refetchInterval: 5000,
  });
  const { selected, showConfig, showNew } = view;
  const setSelected = (selected: string) => setView({ selected });
  const setShowNew = (showNew: boolean) => setView({ showNew });
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [configText, setConfigText] = useState(''),
    [message, setMessage] = useState(''),
    [recipient, setRecipient] = useState<(typeof roles)[number]>('planner'),
    [notice, setNotice] = useState('');
  const [launchTestText, setLaunchTestText] = useState(''),
    [testText, setTestText] = useState(''),
    [allowNoTests, setAllowNoTests] = useState(false);
  const workflow = workflows.data?.find((w) => w.id === selected) ?? workflows.data?.at(-1);
  useEffect(() => {
    if (workflow)
      setRecipient(workflow.phase === 'done' ? 'builder' : (workflow.operation?.role ?? workflow.activeRole));
  }, [workflow?.id, workflow?.phase, workflow?.cycle, workflow?.operation?.role]);
  useEffect(() => {
    setNotice('');
  }, [workflow?.id]);
  const testOutput = useQuery({
    queryKey: [
      'agent-teams-test-output',
      props.host.id,
      workflow?.id,
      workflow?.cycle,
      workflow?.tests.map((test) => [test.command, test.exitCode, test.durationMs]),
    ],
    queryFn: () => testOutputCall({ id: workflow!.id, workspaceId }),
    enabled: !!workflow?.tests.length && !showNew,
  });
  useEffect(() => {
    setTestText(workflow?.plan?.tests.map((t) => t.command).join('\n') ?? '');
    setAllowNoTests(workflow?.allowNoTests ?? false);
  }, [workflow?.id, workflow?.plan?.summary, workflow?.planVersions?.at(-1)?.version]);
  useEffect(() => {
    if (!catalog.data) return;
    setConfig((current) => ({ ...current, roles: defaultRoles(catalog.data.providers, current.roles) }));
  }, [catalog.data]);
  const text = { color: theme.colors.foreground };
  const startIssue = !catalog.data
    ? t('Vérification du workspace…')
    : ((catalog.data.launchIssue || undefined) ??
      (catalog.data.blockingWorkflow ? t('Un workflow conserve le verrou de ce dépôt.') : undefined) ??
      configurationIssue(config, catalog.data.providers, t) ??
      (!task.trim() ? t('Décrivez la tâche pour démarrer.') : undefined));
  const input = {
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    minHeight: 44,
  };
  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await job();
      await workflows.refetch();
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };
  const act = (action: Action['action'], extra: Partial<Action> = {}) =>
    workflow &&
    run(async () => {
      const key = JSON.stringify({ workspaceId, id: workflow.id, action, ...extra });
      await actionCall({
        id: workflow.id,
        workspaceId,
        requestId: intentionId(key),
        expectedRevision: workflow.revision,
        action,
        ...extra,
      });
      pendingRequests.current.delete(key);
      if (action === 'import_planner_answers')
        setNotice(
          t('Réponses natives importées. Le Plan reprend après résolution de toutes les questions, sauf en pause.'),
        );
      if (action === 'import_reviewer_plan')
        setNotice(
          t(
            'Réponse native récupérée. Le plan courant reste conservé ; toute proposition doit être adoptée explicitement.',
          ),
        );
      if (action === 'message' || action === 'followup') {
        setMessage((current) => (current === extra.message ? '' : current));
        setNotice(
          action === 'followup'
            ? t('Message transmis à {role}. Réponse à suivre dans la timeline.', {
                role: t(
                  roleLabel[
                    extra.purpose === 'plan_revision'
                      ? 'reviewer'
                      : extra.purpose === 'pull_request'
                        ? 'builder'
                        : (extra.role ?? 'planner')
                  ],
                ),
              })
            : t(
                'Message enregistré. Sa transmission est indiquée dans la timeline ; une pause ou une permission doit être résolue pour continuer.',
              ),
        );
      }
    });
  const c = theme.colors;
  const radius = 8;
  const button = (
    label: string,
    onPress: () => void,
    disabled = false,
    variant: 'primary' | 'secondary' | 'ghost' = 'primary',
  ) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy || disabled}
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: radius,
        borderWidth: variant === 'ghost' ? 0 : 1,
        borderColor: variant === 'primary' ? c.accent : c.border,
        backgroundColor: disabled ? c.surface2 : variant === 'primary' ? c.accent : 'transparent',
        opacity: busy || disabled ? 0.5 : 1,
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: '500',
          color: variant === 'primary' && !disabled ? c.accentForeground : c.foregroundMuted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
  const badge = (label: string, tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' = 'neutral') => {
    const color = {
      neutral: c.foregroundMuted,
      success: c.statusSuccess,
      warning: c.statusWarning,
      danger: c.statusDanger,
      info: c.accent,
    }[tone];
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: 99,
          paddingHorizontal: 8,
          paddingVertical: 2,
        }}
      >
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
        <Text style={{ fontSize: 11, color }}>{label}</Text>
      </View>
    );
  };
  const card = (children: React.ReactNode, key?: string, tone?: string) => (
    <View
      key={key}
      style={{
        borderWidth: 1,
        borderColor: tone ?? c.border,
        backgroundColor: c.surface1,
        borderRadius: 8,
        padding: 12,
        gap: 8,
      }}
    >
      {children}
    </View>
  );
  const caption = (label: string) => (
    <Text style={{ fontSize: 11, color: c.foregroundMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>
      {label}
    </Text>
  );
  const updateRole = (role: (typeof roles)[number], providerId: string, modelId?: string) => {
    const provider = catalog.data?.providers.find((p) => p.id === providerId),
      model =
        provider?.models.find((m) => m.id === modelId) ??
        provider?.models.find((m) => m.isDefault) ??
        provider?.models[0];
    const mode = provider?.modes.find((m) => role === 'builder' || isReadOnly(provider?.family ?? providerId, m.id));
    setConfig((c) => ({
      ...c,
      roles: { ...c.roles, [role]: { provider: `${providerId}/${model?.id ?? ''}`, modeId: mode?.id ?? '' } },
    }));
  };
  const configOpen = showConfig;
  const repositoryPicker = catalog.data ? (
    <RepositoryPicker
      paths={config.repositoryPaths}
      defaults={catalog.data.gitRoot ? [catalog.data.gitRoot] : (catalog.data.repositories ?? [])}
      candidates={catalog.data.repositories ?? []}
      truncated={catalog.data.searchTruncated}
      colors={c}
      onChange={(repositoryPaths) => setConfig((cur) => ({ ...cur, repositoryPaths }))}
    />
  ) : null;
  const configForm = () => (
    <View style={{ gap: 12 }}>
      <SettingsSelect
        colors={c}
        label="Mode"
        value={config.mode}
        options={[
          { label: 'Auto Workflow', value: 'auto' },
          { label: 'Manual Switch', value: 'manual' },
        ]}
        onValueChange={(mode) => setConfig((cur) => ({ ...cur, mode: mode as Config['mode'] }))}
      />
      {roles.map((role) => {
        const selection = config.roles[role];
        const { harness, model } = selection.provider ? parseProvider(selection.provider) : { harness: '', model: '' };
        const provider = catalog.data?.providers.find((p) => p.id === harness);
        return card(
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: roleColor[role] }} />
              <Text style={{ color: c.foreground, fontWeight: '600' }}>{t(roleLabel[role])}</Text>
            </View>
            <SettingsSelect
              colors={c}
              label={`${t(roleLabel[role])} · ${t('harnais')}`}
              value={harness}
              options={(catalog.data?.providers ?? []).map((p) => ({ label: p.label, value: p.id }))}
              onValueChange={(id) => updateRole(role, id)}
            />
            <SettingsSelect
              colors={c}
              label={`${t(roleLabel[role])} · ${t('modèle')}`}
              value={model}
              options={(provider?.models ?? []).map((m) => ({ label: m.label, value: m.id }))}
              onValueChange={(id) => updateRole(role, harness, id)}
            />
            <SettingsSelect
              colors={c}
              label={`${t(roleLabel[role])} · ${t('permissions')}`}
              value={selection.modeId}
              options={(provider?.modes ?? [])
                .filter((m) => role === 'builder' || isReadOnly(provider?.family ?? harness, m.id))
                .map((m) => ({ label: m.label, value: m.id }))}
              onValueChange={(modeId) =>
                setConfig((cur) => ({ ...cur, roles: { ...cur.roles, [role]: { ...cur.roles[role], modeId } } }))
              }
            />
            {selection.modeId === INSTRUCTION_READ_ONLY ? (
              <Text style={{ color: c.foregroundMuted }}>
                {t(
                  'Ce harnais reçoit une consigne de lecture seule, sans sandbox garantie. Toute modification du dépôt pendant ce tour suspend le workflow pour intervention ; les fichiers sont conservés.',
                )}
              </Text>
            ) : null}
          </>,
          role,
        );
      })}
      <SettingsSelect
        colors={c}
        label={t('Validation humaine')}
        value={config.validation}
        options={[
          { label: t('Après le plan'), value: 'plan' },
          { label: t('À la fin'), value: 'final' },
          { label: t('Autonome'), value: 'autonomous' },
        ]}
        onValueChange={(v) => setConfig((cur) => ({ ...cur, validation: v as Config['validation'] }))}
      />
      <SettingsSwitch
        colors={c}
        label={t('Poursuivre jusqu’à l’objectif')}
        value={config.goalMode ?? false}
        onValueChange={(goalMode) =>
          setConfig((cur) => ({
            ...cur,
            goalMode,
            ...(goalMode ? { autoFix: true, recovery: 'automatic' as const, freshSessionPerCycle: true } : {}),
          }))
        }
      />
      {config.goalMode ? (
        <>
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
            {t(
              'Développer et tester, corriger, puis revoir le plan si nécessaire. Après la première approbation, les commandes peuvent évoluer automatiquement. Les permissions et blocages externes restent visibles. Budget de 2 h ; pause possible à tout moment.',
            )}
          </Text>
          <SettingsSelect
            colors={c}
            label={t('Budget de tours d’agents')}
            value={String(config.goalMaxTurns ?? 30)}
            options={[10, 20, 30, 50, 100].map((n) => ({ label: String(n), value: String(n) }))}
            onValueChange={(v) => setConfig((cur) => ({ ...cur, goalMaxTurns: Number(v) }))}
          />
        </>
      ) : null}
      <SettingsSwitch
        colors={c}
        label={t('Auto-accept du Code')}
        value={config.builderAutoAccept}
        onValueChange={(builderAutoAccept) => setConfig((cur) => ({ ...cur, builderAutoAccept }))}
      />
      <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
        {t(
          'Active le mode autonome natif du Code lorsqu’il est disponible. Désactivez pour valider ses demandes dans l’équipe.',
        )}
      </Text>
      <SettingsSwitch
        colors={c}
        label={t('Corrections automatiques')}
        value={config.autoFix}
        onValueChange={(autoFix) => setConfig((cur) => ({ ...cur, autoFix }))}
      />
      <SettingsSwitch
        colors={c}
        label={t('Session neuve à chaque correction (moins de tokens)')}
        value={config.freshSessionPerCycle}
        onValueChange={(freshSessionPerCycle) => setConfig((cur) => ({ ...cur, freshSessionPerCycle }))}
      />
      <SettingsSelect
        colors={c}
        label={config.goalMode ? t('Corrections avant retour au Plan') : t('Cycles maximum')}
        value={String(config.maxCorrections)}
        options={Array.from({ length: 11 }, (_, i) => ({ label: String(i), value: String(i) }))}
        onValueChange={(v) => setConfig((cur) => ({ ...cur, maxCorrections: Number(v) }))}
      />
      <SettingsSelect
        colors={c}
        label={t('Reprise après redémarrage')}
        value={config.recovery}
        options={[
          { label: t('Explicite'), value: 'explicit' },
          { label: t('Automatique'), value: 'automatic' },
        ]}
        onValueChange={(v) => setConfig((cur) => ({ ...cur, recovery: v as Config['recovery'] }))}
      />
      {config.validation !== 'plan' && config.mode === 'auto' ? (
        <>
          <Text style={text}>
            {t(
              'Le Plan choisit les commandes de test, qui seront exécutées automatiquement. Facultatif : indiquez ci-dessous des commandes à utiliser à la place, une par ligne.',
            )}
          </Text>
          <TextInput
            accessibilityLabel={t('Commandes de test au lancement')}
            multiline
            style={input}
            value={launchTestText}
            onChangeText={(v) => {
              setLaunchTestText(v);
              setConfig((cur) => ({ ...cur, testCommands: commandsFromText(v) }));
            }}
          />
          <SettingsSwitch
            colors={c}
            label={t('Accepter explicitement l’absence de tests')}
            value={config.allowNoTests}
            onValueChange={(v) => setConfig((cur) => ({ ...cur, allowNoTests: v }))}
          />
        </>
      ) : null}
      {button(
        t('Exporter la configuration'),
        () => {
          void run(async () => {
            const value = exportConfig(config);
            setConfigText(value);
            if (Platform.OS === 'web') await copyConfiguration(value);
          });
        },
        false,
        'secondary',
      )}
      <TextInput
        accessibilityLabel={t('Configuration JSON à copier ou importer')}
        multiline
        style={input}
        value={configText}
        onChangeText={setConfigText}
      />
      {button(
        t('Importer la configuration'),
        () => {
          void run(async () => {
            const imported = importConfig(configText);
            setConfig(imported);
            setLaunchTestText(imported.testCommands.map((t) => t.command).join('\n'));
          });
        },
        !configText.trim(),
        'secondary',
      )}
    </View>
  );
  const statusTone = (status: string) =>
    status === 'completed' ? 'success' : status === 'attention' ? 'danger' : status === 'running' ? 'info' : 'warning';
  const statusLabel: Record<string, string> = {
    ready: t('Prêt'),
    running: t('En cours'),
    awaiting_plan: t('Approbation du plan'),
    awaiting_final: t('Validation finale'),
    paused: t('En pause'),
    permission: t('Permission requise'),
    attention: t('Intervention requise'),
    completed: t('Terminé'),
  };
  const creating = !workflow || showNew;
  const startedRole = (role: (typeof roles)[number]) =>
    !!workflow &&
    (workflow.operation?.role === role ||
      !!workflow[{ planner: 'plan', builder: 'build', reviewer: 'review' }[role] as 'plan' | 'build' | 'review'] ||
      workflow.events.some((event) => event.kind === 'dispatch' && event.role === role));
  const stepState = (phase: (typeof steps)[number]['phase']) => {
    if (!workflow) return 'todo';
    const current = workflow.status === 'awaiting_plan' ? 'planning' : workflow.phase;
    if (current === phase && workflow.status !== 'completed') return 'now';
    if (phase === 'planning') return workflow.plan ? 'done' : 'todo';
    if (phase === 'building') return workflow.build ? 'done' : 'todo';
    if (phase === 'testing')
      return workflow.tests.length
        ? workflow.tests.every((test) => test.exitCode === 0 && !test.timedOut)
          ? 'done'
          : 'failed'
        : 'todo';
    return workflow.review ? (workflow.review.verdict === 'pass' ? 'done' : 'failed') : 'todo';
  };
  const openRole = (role: (typeof roles)[number], label: string, small = true) =>
    workflow?.agents[role] && navigation ? (
      <Pressable
        key={label}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => navigation.openAgent({ agentId: workflow.agents[role]! })}
        style={{
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: 99,
          paddingHorizontal: 8,
          paddingVertical: small ? 2 : 6,
        }}
      >
        <Text style={{ fontSize: 11, color: c.foreground }}>{t('Ouvrir le thread ↗')}</Text>
      </Pressable>
    ) : null;
  const roleColor = { planner: '#a78bfa', builder: '#3291ff', reviewer: '#f5a623' } as const;
  const roleHeader = (role: (typeof roles)[number], right?: React.ReactNode) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: roleColor[role] }} />
      <Text style={{ color: c.foreground, fontWeight: '600' }}>{t(roleLabel[role])}</Text>
      <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 11, flexShrink: 1 }}>
        {(() => {
          const selection = workflow?.config.roles?.[role]?.provider;
          if (!selection) return '';
          const { harness, model } = parseProvider(selection);
          return (
            catalog.data?.providers.find((p) => p.id === harness)?.models.find((m) => m.id === model)?.label ?? model
          );
        })()}
      </Text>
      <View style={{ marginLeft: 'auto', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        {right}
        {openRole(role, t('Ouvrir le thread {role}', { role: t(roleLabel[role]) }))}
      </View>
    </View>
  );
  const list = (title: string, items: string[]) =>
    items.length ? (
      <View style={{ gap: 4 }}>
        {caption(title)}
        {items.map((item, i) => (
          <Text key={i} selectable style={{ color: c.foreground, fontSize: 13 }}>
            {`• ${item}`}
          </Text>
        ))}
      </View>
    ) : null;
  const eventBody = (role: (typeof roles)[number] | undefined, text: string) => (
    <StageResult role={role} text={text} colors={c} />
  );
  const metaEvents = [
    'dispatch',
    'approved',
    'paused',
    'resumed',
    'closed',
    'handoff',
    'created',
    'tests',
    'message_accepted',
  ];
  const failedTests = workflow?.tests.filter((t) => t.exitCode !== 0 || t.timedOut) ?? [];
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.surface0 }}
      behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}
      >
        <Text accessibilityRole="header" style={{ ...text, fontSize: 18, fontWeight: '600' }}>
          Agent Teams
        </Text>
        {props.onOpenHistory ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Historique des workflows')}
            onPress={props.onOpenHistory}
          >
            <Text style={{ color: c.foregroundMuted }}>{t('Historique ↗')}</Text>
          </Pressable>
        ) : null}
        {workflow && !creating
          ? badge(statusLabel[workflow.status] ?? workflow.status, statusTone(workflow.status))
          : null}
        <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 11, marginLeft: 'auto' }}>
          {catalog.data?.cwd ?? t('Chargement des providers…')}
        </Text>
      </View>
      {workflow && !creating && !layout.compact ? (
        <View
          style={{
            padding: layout.compact ? 14 : 20,
            backgroundColor: c.surface1,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
          }}
        >
          <TeamRoster
            t={t}
            config={workflow.config}
            workflow={workflow}
            providers={catalog.data?.providers}
            colors={c}
            compact={layout.compact}
            onRole={
              navigation
                ? (role) => {
                    const agentId = workflow.agents[role];
                    if (agentId) navigation.openAgent({ agentId });
                  }
                : undefined
            }
          />
        </View>
      ) : null}
      {workflow && !creating ? (
        <View
          style={{
            flexDirection: 'row',
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          {steps.map((step, i) => {
            const state = stepState(step.phase);
            const agentId = step.role ? workflow.agents[step.role] : undefined;
            const enabled =
              step.phase === 'testing'
                ? !!workflow.plan
                : !!agentId && !!navigation && !!step.role && startedRole(step.role);
            return (
              <Pressable
                key={step.phase}
                accessibilityRole="button"
                accessibilityLabel={`Phase ${t(step.label)}`}
                disabled={!enabled}
                onPress={() =>
                  step.phase === 'testing'
                    ? thread.current?.scrollTo({ y: testsPosition.current, animated: true })
                    : step.role && navigation?.openAgent({ agentId: agentId! })
                }
                style={{
                  flex: 1,
                  padding: 10,
                  borderLeftWidth: i ? 1 : 0,
                  borderLeftColor: c.border,
                  backgroundColor: state === 'now' ? c.surface2 : 'transparent',
                  borderBottomWidth: 2,
                  borderBottomColor: state === 'now' ? c.foreground : 'transparent',
                  opacity: state === 'todo' ? 0.5 : 1,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    color: state === 'done' ? c.statusSuccess : state === 'failed' ? c.statusDanger : c.foregroundMuted,
                  }}
                >
                  {`0${i + 1} · ${state === 'done' ? '✓' : state === 'failed' ? '✕' : state === 'now' ? (statusLabel[workflow.status] ?? t('en cours')) : '—'}`}
                </Text>
                <Text style={{ color: c.foreground, fontWeight: '500' }}>
                  {enabled ? `${t(step.label)} ${step.phase === 'testing' ? '▤' : '↗'}` : t(step.label)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {workflow && !creating && ['attention', 'paused', 'permission', 'running', 'ready'].includes(workflow.status) ? (
        <View
          style={{
            paddingHorizontal: layout.compact ? 14 : 20,
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderBottomColor: c.border,
            backgroundColor: c.surface1,
          }}
        >
          <GoalAction
            workflow={workflow}
            colors={c}
            busy={busy}
            onContinue={() => void act(workflow.operation ? 'resume' : 'start_goal')}
          />
        </View>
      ) : null}
      <ScrollView
        ref={thread}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: layout.compact ? 12 : 20, gap: 12 }}
      >
        {workflow && !creating && layout.compact ? (
          <View
            style={{
              padding: layout.compact ? 14 : 20,
              backgroundColor: c.surface1,
              borderBottomWidth: 1,
              borderBottomColor: c.border,
            }}
          >
            <TeamRoster
              t={t}
              config={workflow.config}
              workflow={workflow}
              providers={catalog.data?.providers}
              colors={c}
              compact={layout.compact}
              onRole={
                navigation
                  ? (role) => {
                      const agentId = workflow.agents[role];
                      if (agentId) navigation.openAgent({ agentId });
                    }
                  : undefined
              }
            />
          </View>
        ) : null}
        {error || catalog.error || workflows.error ? (
          <Text accessibilityRole="alert" style={{ color: c.statusDanger }}>
            {error || errorMessage(catalog.error ?? workflows.error, t)}
          </Text>
        ) : null}
        {workflow && !creating ? (
          <Clarifications
            key={workflow.id}
            workflow={workflow}
            colors={c}
            busy={busy}
            onAnswer={(extra) => void act('answer_clarification', extra)}
            onImport={() => void act('import_planner_answers')}
            onOpenPlanner={
              navigation && workflow.agents.planner
                ? () => navigation.openAgent({ agentId: workflow.agents.planner! })
                : undefined
            }
          />
        ) : null}
        {creating ? (
          <LockNotice
            blocker={catalog.data?.blockingWorkflow}
            theme={theme}
            host={props.host}
            onOpen={props.onOpenWorkspace}
            onRefresh={() => {
              void catalog.refetch();
            }}
          />
        ) : null}
        {catalog.data?.launchIssue ? (
          <View style={{ gap: 8 }}>
            <Text accessibilityRole="alert" style={{ color: c.statusDanger }}>
              {errorMessage(catalog.data.launchIssue, t)}
            </Text>
            {props.onChooseRepository
              ? catalog.data.repositories.map((path) =>
                  button(t('Ouvrir Agent Teams dans {path}', { path }), () => {
                    void run(() => props.onChooseRepository!(path));
                  }),
                )
              : null}
          </View>
        ) : null}

        {workflow && !creating ? (
          <>
            {workflow.repositoryTargets?.length ? (
              <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>
                {workflow.repositoryTargets.length > 1
                  ? t('{count} dépôts · travail conservé dans le workspace', {
                      count: workflow.repositoryTargets.length,
                    })
                  : t('1 dépôt · travail conservé dans le workspace')}
              </Text>
            ) : null}
            {workflow.planProposal
              ? card(
                  <>
                    {caption(t('Proposition Revue · plan v{version}', { version: workflow.planProposal.baseVersion }))}
                    <Text style={{ color: c.foregroundMuted }}>
                      {t('Le plan courant reste inchangé jusqu’à l’adoption.')}
                    </Text>
                    <Markdown source={workflow.planProposal.summary} colors={c} />
                    <StageResult role="planner" text={JSON.stringify(workflow.planProposal.plan)} colors={c} />
                    {button(
                      t('Adopter ce plan'),
                      () => void act('adopt_plan'),
                      !!workflow.operation ||
                        workflow.phase === 'followup' ||
                        !['paused', 'attention', 'awaiting_plan', 'awaiting_final'].includes(workflow.status),
                    )}
                  </>,
                  'plan-proposal',
                )
              : null}
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
                {workflow.config.goalMode
                  ? `Objectif · ${workflow.goal?.turns ?? 0}/${workflow.config.goalMaxTurns ?? 30} tours · ${workflow.goal?.replans ?? 0} replanifications`
                  : `correction ${workflow.cycle}/${workflow.config.maxCorrections}`}
              </Text>
              {workflow.handoffTokens ? badge(`Handoff ≈ ${(workflow.handoffTokens / 1000).toFixed(1)}k tokens`) : null}
              <View style={{ marginLeft: 'auto' }}>
                {button(
                  showContext ? t('Masquer le contexte') : t('Contexte'),
                  () => setShowContext((v) => !v),
                  false,
                  'ghost',
                )}
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {roles.map((role, index) => {
                const { harness, model } = parseProvider(workflow.config.roles?.[role]?.provider ?? 'unknown/default');
                const provider = catalog.data?.providers.find((p) => p.id === harness);
                const label = provider?.models.find((m) => m.id === model)?.label ?? model;
                const enabled = !!workflow.agents[role] && !!navigation && startedRole(role);
                return (
                  <Pressable
                    key={role}
                    accessibilityRole="button"
                    accessibilityLabel={`Ouvrir ${role}`}
                    disabled={!enabled}
                    onPress={() => navigation?.openAgent({ agentId: workflow.agents[role]! })}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28 }}
                  >
                    {index ? <Text style={{ color: c.foregroundMuted }}>→</Text> : null}
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: roleColor[role] }} />
                    <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
                      {label}
                      {enabled ? ' ↗' : ''}
                    </Text>
                  </Pressable>
                );
              })}
              <View style={{ marginLeft: 'auto' }}>
                {button(t('Nouveau workflow'), () => setShowNew(true), false, 'ghost')}
              </View>
            </View>
            {showContext
              ? card(
                  <>
                    {caption(t('Contexte entre les phases'))}
                    <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
                      {t(
                        'Artefacts par rôle · diff borné · 30 dernières lignes des tests en échec. Les objectifs ci-dessous concernent chaque handoff, pas l’historique total des sessions.',
                      )}
                    </Text>
                    {roles.map((role) => (
                      <View
                        key={role}
                        style={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 4 }}
                      >
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: roleColor[role] }} />
                        <Text style={{ flex: 1, color: c.foreground, fontSize: 12 }}>{t(roleLabel[role])}</Text>
                        <Text style={{ color: c.foregroundMuted, fontSize: 12, fontFamily: 'monospace' }}>
                          {t('Objectif {count}k tokens', { count: HANDOFF_BUDGET[role] / 1000 })}
                        </Text>
                      </View>
                    ))}
                    <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>
                      {t('Dernier handoff :')}{' '}
                      {workflow.handoffTokens != null
                        ? t('≈ {count} tokens (estimation UTF-8 / 4)', {
                            count: workflow.handoffTokens.toLocaleString(),
                          })
                        : t('pas encore mesuré')}
                      .
                    </Text>
                    <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>
                      {t('Sessions par correction :')}{' '}
                      {workflow.config.freshSessionPerCycle
                        ? t('nouvelles sessions activées')
                        : t('sessions persistantes')}
                      .
                    </Text>
                  </>,
                  'context',
                )
              : null}
            {(workflows.data?.length ?? 0) > 1 ? (
              <SettingsSelect
                colors={c}
                label="Conversation"
                value={workflow.id}
                options={(workflows.data ?? []).map((w) => ({
                  value: w.id,
                  label: `${w.task.slice(0, 50)} · ${w.status} · ${w.id.slice(0, 6)}`,
                }))}
                onValueChange={setSelected}
              />
            ) : null}

            <Disclosure title={t('Demande initiale')} colors={c}>
              <Markdown source={workflow.task} colors={c} />
            </Disclosure>
            {workflow.events
              .filter((e) => !e.kind.startsWith('receipt:'))
              .map((event) => {
                if (!['assistant', 'user', 'correction', 'goal_replan', 'verification_failed'].includes(event.kind))
                  return null;
                if (
                  event.kind === 'assistant' &&
                  event.role &&
                  workflow.events.filter((e) => e.kind === 'assistant' && e.role === event.role).at(-1)?.id !== event.id
                )
                  return (
                    <Disclosure
                      key={event.id}
                      title={t('{role} · étape précédente', { role: t(roleLabel[event.role]) })}
                      colors={c}
                    >
                      <StageResult role={event.role} text={event.text} colors={c} />
                    </Disclosure>
                  );
                if (
                  workflow.status === 'awaiting_plan' &&
                  event.kind === 'assistant' &&
                  event.role === 'planner' &&
                  renderEvent(event.role, event.text).kind === 'plan'
                )
                  return null;
                if (event.kind === 'dispatch' && event.role)
                  return (
                    <View key={event.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
                      <Text
                        style={{ color: c.foregroundMuted, fontSize: 11 }}
                      >{`Phase · ${t(roleLabel[event.role])}`}</Text>
                      <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
                    </View>
                  );
                if (event.kind === 'tests') return null;
                if (metaEvents.includes(event.kind))
                  return (
                    <Text key={event.id} style={{ color: c.foregroundMuted, fontSize: 11, textAlign: 'center' }}>
                      {event.text}
                    </Text>
                  );
                const danger = ['error', 'invalid', 'permission', 'attention'].includes(event.kind);
                return (
                  <View key={event.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        backgroundColor: event.role ? roleColor[event.role] : c.surface2,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text
                        style={{ color: event.role ? c.surface0 : c.foregroundMuted, fontWeight: '600', fontSize: 11 }}
                      >
                        {event.role ? event.role[0].toUpperCase() : danger ? '!' : 'T'}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      {card(
                        <>
                          {event.role ? (
                            roleHeader(event.role)
                          ) : (
                            <Text style={{ color: c.foreground, fontWeight: '600' }}>
                              {event.kind === 'user' ? t('Vous') : event.kind}
                            </Text>
                          )}
                          {eventBody(event.role, event.text)}
                        </>,
                        event.id,
                        danger ? c.statusWarning : undefined,
                      )}
                    </View>
                  </View>
                );
              })}
            {workflow.status === 'awaiting_plan'
              ? card(
                  <>
                    {caption(
                      `Plan à approuver${workflow.planVersions?.length ? ` · v${workflow.planVersions.at(-1)!.version} · ${workflow.planVersions.at(-1)!.source}` : ''}`,
                    )}
                    {workflow.plan ? (
                      <>
                        <Markdown source={workflow.plan.summary} colors={c} />
                        {list(t('Tâches'), workflow.plan.tasks ?? [])}
                        {list(t('Critères d’acceptation'), workflow.plan.acceptance ?? [])}
                      </>
                    ) : null}
                    <TextInput
                      accessibilityLabel={t('Commandes de test à approuver')}
                      multiline
                      value={testText}
                      onChangeText={setTestText}
                      style={input}
                    />
                    <SettingsSwitch
                      colors={c}
                      label={t('Accepter l’absence de tests pour ce plan')}
                      value={allowNoTests}
                      onValueChange={setAllowNoTests}
                    />
                    {button(t('Approuver le plan et les tests'), () => {
                      void act('approve', { tests: commandsFromText(testText), allowNoTests });
                    })}
                  </>,
                  'approve',
                  c.statusWarning,
                )
              : null}
            {workflow.status === 'awaiting_final'
              ? card(
                  <>
                    {caption(t('Résultat final'))}
                    {button(t('Valider le résultat final'), () => {
                      void act('approve');
                    })}
                  </>,
                  'final',
                  c.statusWarning,
                )
              : null}
            {workflow.status === 'permission' ? (
              <TeamPermissions {...props} workflow={workflow} busy={busy} onAction={act} />
            ) : null}
            {['completed', 'awaiting_final'].includes(workflow.status) ? (
              <CompletionSummary workflow={workflow} colors={c} busy={busy} onAction={act} />
            ) : null}
            {['attention', 'paused'].includes(workflow.status) && !workflow.operation ? (
              <Disclosure title={t('Changer de phase ou de modèle')} colors={c}>
                <WorkflowRecovery
                  key={workflow.id}
                  workflow={workflow}
                  providers={catalog.data?.providers ?? []}
                  colors={c}
                  busy={busy}
                  onAction={act}
                />
              </Disclosure>
            ) : null}
            <Disclosure title={t('Journal technique')} colors={c}>
              {workflow.error ? (
                <Text selectable style={{ color: c.foregroundMuted, fontSize: 12 }}>
                  {workflow.error}
                </Text>
              ) : null}
              {workflow.events
                .filter((e) => !['assistant', 'user', 'created'].includes(e.kind))
                .map((e) => (
                  <Text key={e.id} style={{ color: c.foregroundMuted, fontSize: 11 }}>
                    {e.text}
                  </Text>
                ))}
            </Disclosure>
            <View
              onLayout={(event) => {
                testsPosition.current = event.nativeEvent.layout.y;
              }}
            >
              {card(
                <>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    {caption('Tests')}
                    {workflow.tests.length
                      ? badge(
                          failedTests.length ? `${failedTests.length} en échec` : t('Tous validés'),
                          failedTests.length ? 'danger' : 'success',
                        )
                      : badge(workflow.allowNoTests ? t('Absence acceptée') : t('Pas encore exécutés'))}
                  </View>
                  {workflow.tests.map((test, i) => (
                    <TestLog key={i} result={testOutput.data?.[i] ?? test} loading={testOutput.isPending} colors={c} />
                  ))}
                  {testOutput.error ? (
                    <Text accessibilityRole="alert" style={{ color: c.statusDanger }}>
                      {errorMessage(testOutput.error, t)}
                    </Text>
                  ) : null}
                </>,
                'tests',
              )}
            </View>
            {workflow.config.mode === 'manual' && workflow.status !== 'completed' ? (
              <View style={{ gap: 8 }}>
                {roles.map((role) =>
                  button(
                    t('Passer le relais à {role}', { role: t(roleLabel[role]) }),
                    () => {
                      void act('handoff', { role });
                    },
                    false,
                    'secondary',
                  ),
                )}
              </View>
            ) : null}
          </>
        ) : (
          <>
            {workflow ? button(t('Retour au workflow'), () => setShowNew(false), false, 'ghost') : null}
            {card(
              <>
                <Text style={{ color: c.foreground, fontSize: 24, fontWeight: '600' }}>
                  {t('Une mission. Toute une équipe.')}
                </Text>
                <Text style={{ color: c.foregroundMuted, fontSize: 13, lineHeight: 20 }}>
                  {t(
                    'Team Auto combine vos modèles pour planifier, développer et vérifier. Décrivez le résultat attendu, l’équipe s’occupe des relais.',
                  )}
                </Text>
                <TextInput
                  accessibilityLabel={t('Tâche')}
                  placeholder={t('Décrire la tâche')}
                  placeholderTextColor={c.foregroundMuted}
                  multiline
                  style={input}
                  value={task}
                  onChangeText={setTask}
                />
                <TeamRoster
                  t={t}
                  config={config}
                  providers={catalog.data?.providers}
                  colors={c}
                  compact={layout.compact}
                />
                {repositoryPicker}
                {startIssue ? (
                  <Text accessibilityRole="alert" style={{ color: c.foregroundMuted }}>
                    {startIssue}
                  </Text>
                ) : null}
                {button(
                  t('Démarrer le workflow'),
                  () => {
                    void run(async () => {
                      const launchConfig = scopedLaunchConfig(config, catalog.data);
                      const key = JSON.stringify({ workspaceId, task, config: launchConfig });
                      const w = await createCall({
                        workspaceId,
                        task,
                        config: launchConfig,
                        requestId: intentionId(key),
                      });
                      pendingRequests.current.delete(key);
                      setSelected(w.id);
                      setShowNew(false);
                    });
                  },
                  !!startIssue,
                )}
              </>,
              'new',
            )}
            {card(
              <>
                {button(
                  showConfig ? t('Masquer les réglages') : t('Personnaliser les modèles et réglages'),
                  () => setView({ showConfig: !showConfig }),
                  false,
                  'ghost',
                )}
                <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
                  {config.mode === 'auto' ? t('Relais automatique') : t('Relais manuel')} ·{' '}
                  {config.validation === 'plan'
                    ? t('Vous validez le plan')
                    : config.validation === 'final'
                      ? t('Vous validez le résultat')
                      : t('Validation autonome configurée')}{' '}
                  · {config.maxCorrections} corrections maximum
                </Text>
              </>,
              'summary',
            )}
            {configOpen ? configForm() : null}
          </>
        )}
        {workflow && !creating ? (
          <Disclosure title={t('Options du message et actions')} colors={c}>
            {!workflow.operation &&
            ['completed', 'paused', 'attention', 'awaiting_plan', 'awaiting_final'].includes(workflow.status) &&
            workflow.phase !== 'followup' ? (
              <SettingsSelect
                colors={c}
                label={t('Destinataire du message')}
                value={recipient}
                disabled={busy}
                options={roles.map((role) => ({
                  label: `${t(roleLabel[role])} · ${workflow.config.roles?.[role]?.provider ?? role}`,
                  value: role,
                }))}
                onValueChange={(role) => setRecipient(role as (typeof roles)[number])}
              />
            ) : (
              <Text style={{ color: c.foregroundMuted }}>
                {workflow.phase === 'followup'
                  ? `${t('Réponse en cours')} · ${t(roleLabel[workflow.activeRole])} · ${workflow.config.roles?.[workflow.activeRole]?.provider ?? ''}`
                  : workflow.config.mode === 'manual'
                    ? t('Message transmis à {role} après le tour courant.', { role: t(roleLabel[workflow.activeRole]) })
                    : t('Message transmis au Plan après le tour courant.')}
              </Text>
            )}
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {workflow.config.mode === 'auto' &&
              workflow.plan &&
              !workflow.operation &&
              workflow.phase !== 'followup' &&
              ['paused', 'attention', 'awaiting_plan', 'awaiting_final'].includes(workflow.status)
                ? button(
                    t('Réviser le plan avec la Revue'),
                    () => void act('followup', { purpose: 'plan_revision', message, role: 'reviewer' }),
                    !message.trim(),
                    'secondary',
                  )
                : null}
              {workflow.config.mode === 'auto' &&
              workflow.plan &&
              workflow.agents.reviewer &&
              !workflow.operation &&
              workflow.phase !== 'followup' &&
              ['paused', 'attention', 'awaiting_plan', 'awaiting_final'].includes(workflow.status)
                ? button(
                    t('Récupérer le plan du thread Revue'),
                    () => void act('import_reviewer_plan'),
                    false,
                    'secondary',
                  )
                : null}
              {workflow.config.mode === 'auto' && workflow.plan && workflow.agents.reviewer && !workflow.operation ? (
                <Text selectable style={{ color: c.foregroundMuted, flexBasis: '100%' }}>
                  {t(
                    'Pour récupérer une réponse native : demander un JSON discussion/proposal avec workflowId « {id} » et baseVersion {version}. La récupération ne remplace pas le plan ; adopter ensuite la proposition affichée.',
                    { id: workflow.id, version: workflow.planVersions?.at(-1)?.version ?? 1 },
                  )}
                </Text>
              ) : null}
              {workflow.status !== 'completed' ? (
                <>
                  {!['paused', 'attention'].includes(workflow.status)
                    ? button(t('Mettre en pause'), () => void act('pause'), false, 'ghost')
                    : null}
                  {['paused', 'permission', 'attention'].includes(workflow.status) && workflow.operation
                    ? button(t('Réconcilier l’étape'), () => void act('resume'), false, 'ghost')
                    : null}
                  {button(t('Clore en conservant les fichiers'), () => void act('finish'), false, 'ghost')}
                </>
              ) : null}
            </View>
          </Disclosure>
        ) : null}
      </ScrollView>
      {workflow && !creating ? (
        <View style={{ borderTopWidth: 1, borderTopColor: c.border, padding: 12, gap: 8, backgroundColor: c.surface1 }}>
          <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>
            {t('Message à {role} · destinataire modifiable dans les options', { role: t(roleLabel[recipient]) })}
          </Text>
          {notice ? (
            <Text accessibilityLiveRegion="polite" style={{ color: c.foregroundMuted }}>
              {notice}
            </Text>
          ) : null}
          <TextInput
            accessibilityLabel={t('Message à l’équipe')}
            placeholder={t('Message à l’équipe…')}
            placeholderTextColor={c.foregroundMuted}
            multiline
            style={input}
            value={message}
            onChangeText={setMessage}
          />
          <View style={{ marginLeft: 'auto' }}>
            {button(
              t('Envoyer le message'),
              () =>
                void act(
                  !workflow.operation &&
                    ['completed', 'paused', 'attention', 'awaiting_plan', 'awaiting_final'].includes(workflow.status)
                    ? 'followup'
                    : 'message',
                  { message, role: recipient },
                ),
              !message.trim() || workflow.phase === 'followup',
            )}
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
