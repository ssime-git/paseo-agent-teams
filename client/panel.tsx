import type { PluginWorkspacePanelProps, PluginTimelineItemProps } from '@getpaseo/plugin/client';
import { useRpc } from '@getpaseo/plugin/client';
import { SettingsSelect, SettingsSwitch } from '@getpaseo/plugin/client/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { actionRpc, catalogRpc, createRpc, listRpc, roles, type Action, type Config, type Workflow } from '../shared/contracts';
import { initialConfig, exportConfig, importConfig, commandsFromText, configurationIssue, isReadOnly } from './configuration';
import { copyConfiguration } from './web';
import { INSTRUCTION_READ_ONLY } from '../shared/provider-selection';

const requestId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function ProgressCard({ item, theme, layout }: PluginTimelineItemProps<{ workflowId: string; status: string; detail: string; cycle: number }>) {
  return <View style={{ padding: layout.compact ? 8 : 16, backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border }}>
    <Text style={{ color: theme.colors.foreground }}>Agent Teams · {item.data.status} · correction {item.data.cycle}</Text>
    <Text selectable style={{ color: theme.colors.foregroundMuted }}>{item.data.detail}</Text>
  </View>;
}
export function TeamsPanel(props: PluginWorkspacePanelProps) {
  const { workspaceId, theme, layout, navigation } = props;
  const catalogCall = useRpc(catalogRpc), listCall = useRpc(listRpc), createCall = useRpc(createRpc), actionCall = useRpc(actionRpc);
  const catalog = useQuery({ queryKey: ['agent-teams-catalog', props.host.id, workspaceId], queryFn: () => catalogCall({ workspaceId }), refetchInterval: 30_000 });
  const workflows = useQuery({ queryKey: ['agent-teams-workflows', props.host.id, workspaceId], queryFn: () => listCall({ workspaceId }), refetchInterval: 2000 });
  const [config, setConfig] = useState<Config>(initialConfig), [task, setTask] = useState(''), [selected, setSelected] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [configText, setConfigText] = useState(''), [message, setMessage] = useState('');
  const [launchTestText, setLaunchTestText] = useState(''), [testText, setTestText] = useState(''), [allowNoTests, setAllowNoTests] = useState(false);
  const workflow = workflows.data?.find(w => w.id === selected) ?? workflows.data?.at(-1);
  useEffect(() => { setTestText(workflow?.plan?.tests.map(t => t.command).join('\n') ?? ''); setAllowNoTests(workflow?.allowNoTests ?? false); }, [workflow?.id, workflow?.plan?.summary]);
  useEffect(() => {
    if (!catalog.data) return;
    setConfig(current => {
      const next = { ...current, roles: { ...current.roles } };
      for (const role of roles) {
        if (current.roles[role].provider) continue;
        const preferred = role === 'builder' ? 'codex' : 'claude';
        const provider = catalog.data.providers.find(p => p.id === preferred) ?? catalog.data.providers[0];
        const model = provider?.models.find(m => m.isDefault) ?? provider?.models[0];
        const mode = provider?.modes.find(m => role === 'builder' || isReadOnly(provider.family, m.id));
        if (provider && model && mode) next.roles[role] = { provider: `${provider.id}/${model.id}`, modeId: mode.id };
      }
      return next;
    });
  }, [catalog.data]);
  const text = { color: theme.colors.foreground };
  const startIssue = configurationIssue(config, catalog.data?.providers) ?? (!task.trim() ? 'Décrivez la tâche pour démarrer.' : undefined);
  const input = { color: theme.colors.foreground, backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1, padding: 10, minHeight: 44 };
  const run = async (job: () => Promise<unknown>) => { setBusy(true); setError(''); try { await job(); await workflows.refetch(); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  const act = (action: Action['action'], extra: Partial<Action> = {}) => workflow && run(async () => {
    await actionCall({ id: workflow.id, requestId: requestId(), expectedRevision: workflow.revision, action, ...extra });
  });
  const button = (label: string, onPress: () => void, disabled = false) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} disabled={busy || disabled} onPress={onPress} style={{ padding: 12, backgroundColor: disabled ? theme.colors.surface2 : theme.colors.accent, opacity: busy ? 0.5 : 1 }}><Text style={{ color: disabled ? theme.colors.foregroundMuted : theme.colors.accentForeground }}>{label}</Text></Pressable>;
  const updateRole = (role: typeof roles[number], providerId: string, modelId?: string) => {
    const provider = catalog.data?.providers.find(p => p.id === providerId), model = provider?.models.find(m => m.id === modelId) ?? provider?.models.find(m => m.isDefault) ?? provider?.models[0];
    const mode = provider?.modes.find(m => role === 'builder' || isReadOnly(provider?.family ?? providerId, m.id));
    setConfig(c => ({ ...c, roles: { ...c.roles, [role]: { provider: `${providerId}/${model?.id ?? ''}`, modeId: mode?.id ?? '' } } }));
  };
  return <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: layout.compact ? 12 : 24, gap: 12 }}>
    <Text accessibilityRole="header" style={{ ...text, fontSize: 24 }}>Agent Teams</Text>
    {error || catalog.error || workflows.error ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>{error || String(catalog.error ?? workflows.error)}</Text> : null}
    <Text style={text}>{catalog.data?.cwd ?? 'Chargement des providers…'}</Text>
    <SettingsSelect label="Mode" value={config.mode} options={[{ label: 'Auto Workflow', value: 'auto' }, { label: 'Manual Switch', value: 'manual' }]} onValueChange={mode => setConfig(c => ({ ...c, mode: mode as Config['mode'] }))} />
    {roles.map(role => {
      const selection = config.roles[role], separator = selection.provider.indexOf('/'), harness = selection.provider.slice(0, separator), model = selection.provider.slice(separator + 1);
      const provider = catalog.data?.providers.find(p => p.id === harness);
      return <View key={role} style={{ gap: 8, padding: 12, backgroundColor: theme.colors.surface1 }}>
        <Text style={text}>{role}</Text>
        <SettingsSelect label={`${role} · harnais`} value={harness} options={(catalog.data?.providers ?? []).map(p => ({ label: p.label, value: p.id }))} onValueChange={id => updateRole(role, id)} />
        <SettingsSelect label={`${role} · modèle`} value={model} options={(provider?.models ?? []).map(m => ({ label: m.label, value: m.id }))} onValueChange={id => updateRole(role, harness, id)} />
        <SettingsSelect label={`${role} · permissions`} value={selection.modeId} options={(provider?.modes ?? []).filter(m => role === 'builder' || isReadOnly(provider?.family ?? harness, m.id)).map(m => ({ label: m.label, value: m.id }))} onValueChange={modeId => setConfig(c => ({ ...c, roles: { ...c.roles, [role]: { ...c.roles[role], modeId } } }))} />
        {selection.modeId === INSTRUCTION_READ_ONLY ? <Text style={{ color: theme.colors.foregroundMuted }}>Ce harnais reçoit une consigne de lecture seule, sans sandbox garantie. Toute modification du dépôt pendant ce tour suspend le workflow pour intervention ; les fichiers sont conservés.</Text> : null}
      </View>;
    })}
    <SettingsSelect label="Validation humaine" value={config.validation} options={[{ label: 'Après le plan', value: 'plan' }, { label: 'À la fin', value: 'final' }, { label: 'Autonome', value: 'autonomous' }]} onValueChange={v => setConfig(c => ({ ...c, validation: v as Config['validation'] }))} />
    <SettingsSwitch label="Corrections automatiques" value={config.autoFix} onValueChange={autoFix => setConfig(c => ({ ...c, autoFix }))} />
    <SettingsSelect label="Cycles maximum" value={String(config.maxCorrections)} options={Array.from({ length: 11 }, (_, i) => ({ label: String(i), value: String(i) }))} onValueChange={v => setConfig(c => ({ ...c, maxCorrections: Number(v) }))} />
    <SettingsSelect label="Reprise après redémarrage" value={config.recovery} options={[{ label: 'Explicite', value: 'explicit' }, { label: 'Automatique', value: 'automatic' }]} onValueChange={v => setConfig(c => ({ ...c, recovery: v as Config['recovery'] }))} />
    {config.validation !== 'plan' && config.mode === 'auto' ? <>
      <Text style={text}>Commandes de test autorisées au lancement, une par ligne. Les commandes proposées ultérieurement par le planner ne seront pas exécutées.</Text>
      <TextInput accessibilityLabel="Commandes de test au lancement" multiline style={input} value={launchTestText} onChangeText={v => { setLaunchTestText(v); setConfig(c => ({ ...c, testCommands: commandsFromText(v) })); }} />
      <SettingsSwitch label="Accepter explicitement l’absence de tests" value={config.allowNoTests} onValueChange={v => setConfig(c => ({ ...c, allowNoTests: v }))} />
    </> : null}
    <TextInput accessibilityLabel="Tâche" placeholder="Décrire la tâche" placeholderTextColor={theme.colors.foregroundMuted} multiline style={input} value={task} onChangeText={setTask} />
    {startIssue ? <Text accessibilityRole="alert" style={{ color: theme.colors.foregroundMuted }}>{startIssue}</Text> : null}
    {button('Démarrer le workflow', () => { void run(async () => { const w = await createCall({ workspaceId, task, config, requestId: requestId() }); setSelected(w.id); }); }, !!startIssue)}
    {button('Exporter la configuration', () => { void run(async () => { const value = exportConfig(config); setConfigText(value); if (Platform.OS === 'web') await copyConfiguration(value); }); })}
    <TextInput accessibilityLabel="Configuration JSON à copier ou importer" multiline style={input} value={configText} onChangeText={setConfigText} />
    {button('Importer la configuration', () => { void run(async () => { const imported = importConfig(configText); setConfig(imported); setLaunchTestText(imported.testCommands.map(t => t.command).join('\n')); }); }, !configText.trim())}
    {(workflows.data?.length ?? 0) > 0 ? <SettingsSelect label="Conversation" value={workflow?.id ?? ''} options={(workflows.data ?? []).map(w => ({ value: w.id, label: `${w.task.slice(0, 50)} · ${w.status}` }))} onValueChange={setSelected} /> : null}
    {workflow ? <>
      <Text accessibilityRole="header" style={{ ...text, fontSize: 20 }}>{workflow.phase} · {workflow.status} · correction {workflow.cycle}/{workflow.config.maxCorrections}</Text>
      {workflow.error ? <Text style={{ color: theme.colors.statusDanger }}>{workflow.error}</Text> : null}
      {workflow.plan ? <Text selectable style={text}>{JSON.stringify(workflow.plan, null, 2)}</Text> : null}
      {workflow.status === 'awaiting_plan' ? <>
        <TextInput accessibilityLabel="Commandes de test à approuver" multiline value={testText} onChangeText={setTestText} style={input} />
        <SettingsSwitch label="Accepter l’absence de tests pour ce plan" value={allowNoTests} onValueChange={setAllowNoTests} />
        {button('Approuver le plan et les tests', () => { void act('approve', { tests: commandsFromText(testText), allowNoTests }); })}
      </> : null}
      {workflow.status === 'awaiting_final' ? button('Valider le résultat final', () => { void act('approve'); }) : null}
      {workflow.status !== 'completed' ? <View style={{ flexDirection: layout.compact ? 'column' : 'row', gap: 8, flexWrap: 'wrap' }}>
        {button('Mettre en pause', () => { void act('pause'); })}
        {button('Reprendre', () => { void act('resume'); })}
        {button('Clore en conservant les fichiers', () => { void act('finish'); })}
      </View> : null}
      {roles.map(role => workflow.agents[role] && navigation ? button(`Ouvrir ${role}`, () => navigation.openAgent({ agentId: workflow.agents[role]! })) : null)}
      {workflow.config.mode === 'manual' && workflow.status !== 'completed' ? <View style={{ gap: 8 }}>{roles.map(role => button(`Passer le relais à ${role}`, () => { void act('handoff', { role }); }))}</View> : null}
      {workflow.status !== 'completed' ? <>
        <TextInput accessibilityLabel="Message à l’équipe" multiline style={input} value={message} onChangeText={setMessage} />
        {button('Envoyer le message', () => { void act('message', { message }); setMessage(''); }, !message.trim())}
      </> : null}
      <Text style={text}>Tests : {workflow.tests.length ? workflow.tests.map(t => `${t.command} → ${t.exitCode ?? 'interrompu'}`).join(' ; ') : workflow.allowNoTests ? 'Absence de tests acceptée' : 'Pas encore exécutés'}</Text>
      {workflow.events.filter(e => !e.kind.startsWith('receipt:')).map(event => <View key={event.id} style={{ padding: 10, gap: 4, backgroundColor: theme.colors.surface1 }}>
        <Text style={{ color: theme.colors.foregroundMuted }}>{event.at} · {event.role ?? event.kind}</Text>
        <Text selectable style={text}>{event.text}</Text>
      </View>)}
    </> : null}
  </ScrollView>;
}
