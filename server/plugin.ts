import { TeamError } from '../shared/errors';
import type { PluginServerContext } from '@getpaseo/plugin/server';
import { createPaseoClient, type PaseoClient } from '@getpaseo/client';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRpc, actionRpc, listRpc, historyRpc, catalogRpc, testOutputRpc } from '../shared/contracts';
import { TERMINAL_OR_WAITING } from '../shared/state-machine';
import { Engine } from './engine';
import { Store } from './store';
import { PaseoRuntime } from './runtime';
import { providerProfiles, workflowModes } from './providers';
import { DEFAULT_MODEL } from '../shared/provider-selection';
import { repository, repositoryPreflight } from './git';

export function contributeServer(server: PluginServerContext) {
  const directory = process.env.PASEO_AGENT_TEAMS_DATA_DIR ?? join(homedir(), '.local', 'state', 'paseo-agent-teams');
  const store = new Store(directory);
  let engine: Engine | undefined, recoveryClient: PaseoClient | undefined;
  let connecting: Promise<void> | undefined;
  let disposed = false,
    recovering = false;
  const bind = async () => {
    recoveryClient ??= createPaseoClient({
      url: process.env.PASEO_AGENT_TEAMS_DAEMON_URL ?? 'ws://127.0.0.1:6767/ws',
      password: process.env.PASEO_AGENT_TEAMS_DAEMON_PASSWORD,
      reconnect: { enabled: true },
      connectTimeoutMs: 5000,
    });
    if (recoveryClient.getConnectionState().status !== 'connected') {
      connecting ??= recoveryClient
        .connect()
        .then(() => {})
        .finally(() => {
          connecting = undefined;
        });
      await connecting;
    }
    if (disposed) throw new TeamError('PLUGIN_DISPOSED', 'Plugin disposed');
    engine ??= new Engine(store, new PaseoRuntime(recoveryClient, directory));
    return engine;
  };
  server.handle(createRpc, async (input) => {
    await store.init();
    return (await bind()).create(input.workspaceId, input.task, input.config, input.requestId);
  });
  server.handle(actionRpc, async (input) => {
    await store.authorize(input.id, input.workspaceId);
    return (await bind()).action(input);
  });
  server.handle(listRpc, async ({ workspaceId }) => {
    return (await store.all())
      .filter((w) => w.workspaceId === workspaceId)
      .map((w) => ({
        ...w,
        tests: w.tests.map((t) => ({ ...t, stdout: '', stderr: '' })),
        events: w.events.filter((e) => !e.kind.startsWith('receipt:') && e.kind !== 'tests').slice(-50),
        receipts: undefined,
      }));
  });
  server.handle(catalogRpc, async ({ workspaceId }, { paseo }) => {
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    if (!workspace) throw new TeamError('WORKSPACE_NOT_FOUND', 'Workspace not found');
    const cwd = workspace.workspaceDirectory;
    const catalog = await paseo.providers.waitForReady({ cwd, timeoutMs: 15_000 });
    const profiles = await providerProfiles(paseo);
    const providers = await Promise.all(
      catalog.entries
        .filter((e) => e.status === 'ready')
        .map(async (e) => ({
          id: e.provider,
          family: profiles.families[e.provider] ?? e.provider,
          label: profiles.labels[e.provider] ?? e.provider,
          models: e.models?.length
            ? e.models.map((m) => ({ id: m.id, label: m.label ?? m.id, isDefault: m.isDefault ?? false }))
            : [{ id: DEFAULT_MODEL, label: 'Modèle par défaut du harnais (non annoncé)', isDefault: true }],
          modes: workflowModes(
            profiles.families[e.provider] ?? e.provider,
            ((await paseo.providers.listModes(e.provider, { cwd })).modes ?? []).map((m) => ({
              id: m.id,
              label: m.label,
            })),
          ),
        })),
    );
    const preflight = await repositoryPreflight(cwd);
    const lock = preflight.gitRoot ? (await repository(cwd)).lock : undefined;
    const blocker = lock ? (await store.all()).find((w) => w.repo === lock && w.status !== 'completed') : undefined;
    return {
      cwd,
      providers,
      ...preflight,
      ...(blocker
        ? {
            blockingWorkflow: {
              id: blocker.id,
              workspaceId: blocker.workspaceId,
              task: blocker.task,
              status: blocker.status,
            },
          }
        : {}),
    };
  });
  server.handle(historyRpc, async ({ id, workspaceId }) => (await store.authorize(id, workspaceId)).events);
  server.handle(testOutputRpc, async ({ id, workspaceId }) => (await store.authorize(id, workspaceId)).tests);
  const forAgent = async (agentId: string, handle: (engine: Engine) => Promise<void>) => {
    if (!(await store.forAgent(agentId)).length) return;
    await handle(await bind());
  };
  server.on('agent.permission_requested', async (event) =>
    forAgent(event.agent.id, (engine) => engine.permission(event.agent.id)),
  );
  server.on('agent.permission_resolved', async (event) =>
    forAgent(event.agent.id, (engine) => engine.resolvePermission(event.agent.id)),
  );
  server.on('agent.turn_ended', async (event) =>
    forAgent(event.agent.id, (engine) =>
      engine.receipt(
        event.agent.id,
        event.outcome.kind === 'completed'
          ? { status: 'idle' }
          : {
              status: 'error',
              error: event.outcome.kind === 'failed' ? event.outcome.error.message : event.outcome.reason,
            },
        event.timeline,
      ),
    ),
  );

  const recover = async () => {
    if (disposed || recovering) return;
    recovering = true;
    try {
      if (
        !(await store.all()).some((w) => w.config.recovery === 'automatic' && !TERMINAL_OR_WAITING.includes(w.status))
      )
        return;
      if (!disposed) await (await bind()).recoverAutomatic();
    } catch (e) {
      console.error('Agent Teams recovery:', e);
    } finally {
      recovering = false;
    }
  };
  const timer = setInterval(() => {
    void recover();
  }, 10_000);
  void recover();
  return async () => {
    disposed = true;
    clearInterval(timer);
    engine?.close();
    await recoveryClient?.close();
  };
}
