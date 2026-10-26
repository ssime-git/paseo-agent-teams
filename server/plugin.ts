import { createHash } from 'node:crypto';
import { TeamError } from '../shared/errors';
import type { PluginServerContext } from '@getpaseo/plugin/server';
import { createPaseoClient, type PaseoClient, type PaseoApi } from '@getpaseo/client';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  createRpc,
  actionRpc,
  listRpc,
  historyRpc,
  catalogRpc,
  testOutputRpc,
  workflowIndexRpc,
  workflowRecordRpc,
  permissionsRpc,
  nativeArtifactsRpc,
  teamChoicesRpc,
} from '../shared/contracts';
import { TERMINAL_OR_WAITING } from '../shared/state-machine';
import { Engine } from './engine';
import { createTeamProvider } from './team-provider';
import { defaultTeam, teamSettings, TEAM_PROVIDER_ID } from '../shared/team-composition';
import { configSchema } from '../shared/contracts';
import { Store } from './store';
import { captureGraphReceipt } from './graph-receipts';
import { graphRecordRpc, graphActionRpc, graphAdmitRpc, graphAdvanceRpc } from '../shared/graph-actions';
import { admitSavedGraph } from './graph-admission';
import { continueSavedGraph } from './graph-continuation';
import { submitGraphAction } from './graph-actions';
import { completedTurnTimeline } from './turn-timeline';
import { DefinitionCatalog } from './definition-catalog';
import { saveDefinitionRpc, listDefinitionsRpc, definitionHistoryRpc } from '../shared/definition-catalog';
import { PaseoRuntime } from './runtime';
import { providerProfiles, workflowModes } from './providers';
import { DEFAULT_MODEL } from '../shared/provider-selection';
import { repositoryPreflight } from './git';
import { resolveRepositories, scopesOverlap } from './scopes';

export function contributeServer(server: PluginServerContext) {
  const directory = process.env.PASEO_AGENT_TEAMS_DATA_DIR ?? join(homedir(), '.local', 'state', 'paseo-agent-teams');
  const store = new Store(directory);
  const definitions = new DefinitionCatalog(join(directory, 'definitions'));
  server.handle(graphAdvanceRpc, async (input, { paseo }) => continueSavedGraph(paseo, store.graphs, input));
  server.handle(graphAdmitRpc, async (input, { paseo }) => admitSavedGraph(paseo, store, definitions, input));
  server.handle(graphRecordRpc, async ({ id, workspaceId }) => store.graphs.get(id, workspaceId));
  server.handle(graphActionRpc, async (input, { paseo }) => submitGraphAction(paseo, store.graphs, input));
  server.handle(saveDefinitionRpc, async (input, { paseo }) => {
    if (!(await paseo.workspaces.ref(input.workspaceId).refresh()))
      throw new TeamError('WORKSPACE_NOT_FOUND', 'Workspace not found');
    return definitions.save(input);
  });
  server.handle(listDefinitionsRpc, async ({ workspaceId }) => definitions.list(workspaceId));
  server.handle(definitionHistoryRpc, async ({ id, workspaceId }) => definitions.history(id, workspaceId));
  let engine: Engine | undefined, recoveryClient: PaseoClient | undefined;
  let nativeApi: PaseoApi | undefined;
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
    engine ??= new Engine(
      store,
      new PaseoRuntime(
        recoveryClient,
        directory,
        () => nativeApi,
        async () => (await savedTeam())?.language ?? 'fr',
      ),
    );
    return engine;
  };
  server.handle(createRpc, async (input, context) => {
    nativeApi = context?.paseo ?? nativeApi;
    await store.init();
    return (await bind()).create(input.workspaceId, input.task, input.config, input.requestId);
  });
  server.handle(actionRpc, async (input, context) => {
    nativeApi = context?.paseo ?? nativeApi;
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
  server.handle(nativeArtifactsRpc, async ({ revision }) => {
    const records = (await store.all()).flatMap((w) =>
      w.events
        .filter((e) => e.kind === 'assistant' && e.role)
        .map((e) => ({
          eventId: e.id,
          workflowId: w.id,
          workspaceId: w.workspaceId,
          role: e.role!,
          text: e.text,
        })),
    );
    const current = createHash('sha256')
      .update(records.map((e) => e.eventId).join('|'))
      .digest('hex');
    return revision === current ? { revision: current } : { revision: current, records };
  });
  // Host-wide, read-only history survives deletion of the native workspace.
  server.handle(workflowIndexRpc, async () =>
    (await store.all())
      .map((w) => ({
        id: w.id,
        workspaceId: w.workspaceId,
        cwd: w.cwd,
        task: w.task,
        status: w.status,
        phase: w.phase,
        updatedAt: w.events.at(-1)?.at ?? '',
        closed: w.events.some((e) => e.kind === 'closed'),
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)),
  );
  server.handle(workflowRecordRpc, async ({ id }) => {
    const w = await store.get(id);
    return workflowRecordRpc.output.parse({
      ...w,
      closed: w.events.some((e) => e.kind === 'closed'),
      events: w.events.filter((e) => !e.kind.startsWith('receipt:') && e.kind !== 'tests'),
    });
  });
  const discover = async (paseo: PaseoApi, cwd: string) => {
    const catalog = await paseo.providers.waitForReady({ cwd, timeoutMs: 15_000 });
    const profiles = await providerProfiles(paseo);
    const providers = await Promise.all(
      catalog.entries
        .filter((e) => e.status === 'ready' && e.provider !== TEAM_PROVIDER_ID)
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
    return providers;
  };
  server.before('agent.session_open', ({ request }, context) => {
    if (request.provider.split('/')[0] !== TEAM_PROVIDER_ID) return;
    if (!request.workspaceId) throw new TeamError('WORKSPACE_NOT_FOUND', 'Team Auto needs a workspace');
    nativeApi = context.paseo;
    return {
      ...request,
      env: {
        ...request.env,
        PASEO_AGENT_TEAMS_WORKSPACE_ID: request.workspaceId,
        PASEO_AGENT_TEAMS_AGENT_ID: request.agentId,
      },
    };
  });
  const defaults = server.registerSettings(teamSettings);
  const savedTeam = async () => {
    const state = await defaults.read();
    return state.status === 'ready' ? state.values : undefined;
  };
  server.handle(teamChoicesRpc, async (_input, { paseo }) => discover(paseo, homedir()));
  server.registerProvider(
    createTeamProvider({
      defaultMode: async () => (await savedTeam())?.validation ?? 'plan',
      language: async () => (await savedTeam())?.language ?? 'fr',
      async open(cwd, workspaceId) {
        await bind();
        const workspace = await recoveryClient!.workspaces.ref(workspaceId).refresh();
        if (!workspace || workspace.workspaceDirectory !== cwd)
          throw new TeamError('WORKSPACE_ACCESS_DENIED', 'Team workspace context mismatch');
        const choices = await discover(recoveryClient!, cwd);
        const saved = await savedTeam();
        const config = configSchema.parse({
          version: 1,
          roles: defaultTeam(choices, saved),
          builderAutoAccept: false,
          ...(saved ? { validation: saved.validation, maxCorrections: saved.maxCorrections } : {}),
        });
        return { workspaceId: workspace.id, choices, config };
      },
      async ownerWorkspace(agentId, cwd) {
        await bind();
        const agent = await recoveryClient!.agents.ref(agentId).refresh();
        if (!agent?.agent.workspaceId || agent.agent.cwd !== cwd || agent.agent.provider !== TEAM_PROVIDER_ID)
          throw new TeamError('WORKSPACE_ACCESS_DENIED', 'Native Team owner unavailable');
        return agent.agent.workspaceId;
      },
      list: (workspaceId) => store.all().then((all) => all.filter((w) => w.workspaceId === workspaceId)),
      get: (id, workspaceId) => store.authorize(id, workspaceId),
      create: async (workspaceId, task, config, requestId, ownerAgentId) =>
        (await bind()).create(workspaceId, task, config, requestId, ownerAgentId),
      activity: async (w, role, operationId) => {
        await bind();
        return new PaseoRuntime(recoveryClient!, directory, () => nativeApi).activity(w, role, operationId);
      },
      action: async (input) => {
        await store.authorize(input.id, input.workspaceId);
        return (await bind()).action(input);
      },
    }),
  );
  server.handle(catalogRpc, async ({ workspaceId, repositoryPaths }, { paseo }) => {
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    if (!workspace) throw new TeamError('WORKSPACE_NOT_FOUND', 'Workspace not found');
    const cwd = workspace.workspaceDirectory;
    const providers = await discover(paseo, cwd);
    const preflight = await repositoryPreflight(cwd);
    let targets: Awaited<ReturnType<typeof resolveRepositories>> | undefined, scopeIssue: string | undefined;
    try {
      targets = await resolveRepositories(
        cwd,
        repositoryPaths ?? (preflight.gitRoot ? [preflight.gitRoot] : preflight.repositories),
      );
    } catch (error) {
      scopeIssue = String(error);
    }
    const blocker = targets?.length
      ? (await store.all()).find(
          (w) => w.status !== 'completed' && scopesOverlap(w, { repo: targets[0].lock, repositoryTargets: targets }),
        )
      : undefined;
    return {
      cwd,
      providers,
      ...preflight,
      launchIssue: scopeIssue,
      selectedRepositories: targets?.map((r) => r.root) ?? [],
      ...(blocker
        ? {
            blockingWorkflow: {
              id: blocker.id,
              workspaceId: blocker.workspaceId,
              task: blocker.task,
              status: blocker.status,
              revision: blocker.revision,
            },
          }
        : {}),
    };
  });
  server.handle(historyRpc, async ({ id, workspaceId }) => (await store.authorize(id, workspaceId)).events);
  server.handle(testOutputRpc, async ({ id, workspaceId }) => (await store.authorize(id, workspaceId)).tests);
  server.handle(permissionsRpc, async ({ id, workspaceId }, { paseo }) => {
    const w = await store.authorize(id, workspaceId);
    return new PaseoRuntime(paseo, directory).permissions(w);
  });
  const forAgent = async (agentId: string, handle: (engine: Engine) => Promise<void>) => {
    if (!(await store.forAgent(agentId)).length) return;
    await handle(await bind());
  };
  server.on('agent.permission_requested', async (event, context) => {
    nativeApi = context.paseo;
    return forAgent(event.agent.id, (engine) => engine.permission(event.agent.id));
  });
  server.on('agent.permission_resolved', async (event, context) => {
    nativeApi = context.paseo;
    return forAgent(event.agent.id, (engine) => engine.resolvePermission(event.agent.id));
  });
  server.on('agent.turn_ended', async (event, context) => {
    nativeApi = context.paseo;
    const linked =
      (await store.forAgent(event.agent.id)).length ||
      (await store.graphs.all()).some((state) =>
        state.activations.some((a) => a.dispatch?.agentId === event.agent.id && !a.result),
      );
    if (!linked) return;
    const timeline = await completedTurnTimeline(context.paseo, event);
    if (!timeline) return;
    await captureGraphReceipt(store.graphs, { ...event, timeline });
    return forAgent(event.agent.id, (engine) =>
      engine.receipt(
        event.agent.id,
        event.outcome.kind === 'completed'
          ? { status: 'idle' }
          : {
              status: 'error',
              error: event.outcome.kind === 'failed' ? event.outcome.error.message : event.outcome.reason,
            },
        timeline,
      ),
    );
  });

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
