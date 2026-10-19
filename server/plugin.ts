import type { PluginServerContext } from '@getpaseo/plugin/server';
import { createPaseoClient, type PaseoApi, type PaseoClient } from '@getpaseo/client';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRpc, actionRpc, listRpc, historyRpc, catalogRpc } from '../shared/contracts';
import { Engine } from './engine';
import { Store } from './store';
import { PaseoRuntime } from './runtime';
import { providerProfiles } from './providers';

export function contributeServer(server: PluginServerContext) {
  const directory = process.env.PASEO_AGENT_TEAMS_DATA_DIR ?? join(homedir(), '.local', 'state', 'paseo-agent-teams');
  const store = new Store(directory);
  let engine: Engine | undefined, nativeApi: PaseoApi | undefined, recoveryClient: PaseoClient | undefined;
  let disposed = false, recovering = false;
  const bind = (api: PaseoApi, native = true) => {
    if (native) nativeApi = api;
    const runtime = new PaseoRuntime(api, directory, () => nativeApi);
    if (!engine) engine = new Engine(store, runtime); else engine.setRuntime(runtime);
    return engine;
  };
  server.handle(createRpc, async (input, { paseo }) => { await store.init(); return bind(paseo).create(input.workspaceId, input.task, input.config, input.requestId); });
  server.handle(actionRpc, (input, { paseo }) => bind(paseo).action(input));
  server.handle(listRpc, async ({ workspaceId }, { paseo }) => {
    const engine = bind(paseo); await engine.recoverAutomatic(); return engine.list(workspaceId);
  });
  server.handle(catalogRpc, async ({ workspaceId }, { paseo }) => {
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    if (!workspace) throw new Error('Workspace not found');
    const cwd = workspace.workspaceDirectory;
    const catalog = await paseo.providers.waitForReady({ cwd, timeoutMs: 15_000 });
    const profiles = await providerProfiles(paseo);
    const providers = await Promise.all(catalog.entries.filter(e => e.status === 'ready' && !!profiles.families[e.provider]).map(async e => ({
      id: e.provider, family: profiles.families[e.provider], label: profiles.labels[e.provider] ?? e.provider,
      models: (e.models ?? []).map(m => ({ id: m.id, label: m.label ?? m.id, isDefault: m.isDefault ?? false })),
      modes: ((await paseo.providers.listModes(e.provider, { cwd })).modes ?? []).map(m => ({ id: m.id, label: m.label })),
    })));
    return { cwd, providers };
  });
  server.handle(historyRpc, async ({ id }) => (await store.get(id)).events);
  server.on('agent.permission_requested', (event, { paseo }) => bind(paseo).permission(event.agent.id));
  server.on('agent.permission_resolved', (event, { paseo }) => bind(paseo).resolvePermission(event.agent.id));
  server.on('agent.turn_ended', (event, { paseo }) => bind(paseo).receipt(event.agent.id,
    event.outcome.kind === 'completed' ? { status: 'idle' } : { status: 'error', error: event.outcome.kind === 'failed' ? event.outcome.error.message : event.outcome.reason }, event.timeline));

  const recover = async () => {
    if (disposed || recovering) return;
    recovering = true;
    try {
      if (!(await store.all()).some(w => w.config.recovery === 'automatic' && !['completed', 'paused', 'attention', 'awaiting_plan', 'awaiting_final'].includes(w.status))) return;
      if (!recoveryClient) recoveryClient = createPaseoClient({
        url: process.env.PASEO_AGENT_TEAMS_DAEMON_URL ?? 'ws://127.0.0.1:6767/ws',
        password: process.env.PASEO_AGENT_TEAMS_DAEMON_PASSWORD,
        reconnect: { enabled: true }, connectTimeoutMs: 5000,
      });
      if (recoveryClient.getConnectionState().status !== 'connected') await recoveryClient.connect();
      if (!disposed) await bind(recoveryClient, false).recoverAutomatic();
    } catch (e) { console.error('Agent Teams recovery:', e); }
    finally { recovering = false; }
  };
  const timer = setInterval(() => { void recover(); }, 10_000);
  void recover();
  return async () => { disposed = true; clearInterval(timer); engine?.close(); await recoveryClient?.close(); };
}
