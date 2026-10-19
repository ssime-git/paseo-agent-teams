import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PaseoApi } from '@getpaseo/client';
import { PaseoRuntime, readOnlyMode } from '../server/runtime';
import type { Workflow } from '../shared/contracts';
import { DEFAULT_MODE, DEFAULT_MODEL, INSTRUCTION_READ_ONLY } from '../shared/provider-selection';

function savedWorkflow(): Workflow {
  return {
    id: 'workflow',
    agents: { builder: 'agent' },
    operation: {
      id: 'operation',
      role: 'builder',
      phase: 'building',
      state: 'prepared',
      startedAt: new Date().toISOString(),
    },
    events: [],
  } as unknown as Workflow;
}
function adapter(overrides: Record<string, unknown> = {}, entries: unknown[] = []) {
  let sends = 0,
    waits = 0,
    appends = 0;
  const handle = {
    status: 'idle',
    pendingPermissions: [],
    activeTurn: null,
    refresh: async () => ({}),
    run: async () => {
      sends++;
      return { status: 'idle', lastMessage: 'done' };
    },
    waitForFinish: async () => {
      waits++;
      return { status: 'idle', lastMessage: 'completed live' };
    },
    timeline: {
      refetch: async () => ({ entries, endCursor: { epoch: 'epoch', seq: 8 }, hasOlder: false }),
      append: async () => {
        appends++;
      },
    },
    ...overrides,
  };
  const api = { agents: { ref: () => handle } } as unknown as PaseoApi;
  const runtime = new PaseoRuntime(api, '/unused');
  return { runtime, counts: () => ({ sends, waits, appends }) };
}
const accepted = { item: { type: 'user_message', text: '[agent-teams-operation:operation] task' } };
test('idle plus a previous assistant message does not prove completion', async () => {
  const h = adapter({}, [accepted, { item: { type: 'assistant_message', text: 'unproven' } }]);
  assert.equal((await h.runtime.reconcile(savedWorkflow())).status, 'uncertain');
  assert.equal(h.counts().sends, 0);
});
test('a durable hook receipt and matching prompt recover a finished turn', async () => {
  const h = adapter({}, [accepted]);
  const w = savedWorkflow();
  w.events.push({
    id: 'receipt',
    at: new Date().toISOString(),
    kind: 'receipt:operation',
    text: JSON.stringify({ status: 'idle', text: 'validated result' }),
  });
  const result = await h.runtime.reconcile(w);
  assert.equal(result.status, 'idle');
  assert.equal(result.text, 'validated result');
  assert.deepEqual(result.cursor, { epoch: 'epoch', seq: 8 });
});
test('an active accepted turn is observed without a second send', async () => {
  const h = adapter({ status: 'running', activeTurn: { turnId: 'turn' } }, [accepted]);
  const result = await h.runtime.reconcile(savedWorkflow());
  assert.equal(result.status, 'idle');
  assert.deepEqual(h.counts(), { sends: 0, waits: 1, appends: 0 });
});
test('foreign prompts, missing acceptance, missing agents and permissions suspend safely', async () => {
  const foreign = adapter({}, [accepted, { item: { type: 'user_message', text: 'foreign task' } }]);
  assert.equal((await foreign.runtime.reconcile(savedWorkflow())).status, 'uncertain');
  assert.equal((await adapter().runtime.reconcile(savedWorkflow())).status, 'uncertain');
  assert.equal((await adapter({ refresh: async () => null }).runtime.reconcile(savedWorkflow())).status, 'uncertain');
  assert.equal((await adapter({ pendingPermissions: [{}] }).runtime.reconcile(savedWorkflow())).status, 'permission');
});
test('busy sessions cannot receive another prompt; read-only modes are restricted', async () => {
  const h = adapter({ status: 'running' });
  assert.equal((await h.runtime.run(savedWorkflow(), 'builder', 'task', 'operation')).status, 'uncertain');
  assert.equal(h.counts().sends, 0);
  assert.equal(readOnlyMode('claude', 'plan'), true);
  assert.equal(readOnlyMode('codex', 'read-only'), true);
  assert.equal(readOnlyMode('claude', 'acceptEdits'), false);
});
test('native cards append through the plugin-owned API with stable identity', async () => {
  const h = adapter();
  const w = savedWorkflow();
  w.agents.planner = 'planner';
  w.phase = 'building';
  w.cycle = 1;
  w.task = 'task';
  w.status = 'running';
  await h.runtime.publish(w);
  await h.runtime.publish(w);
  assert.equal(h.counts().appends, 2);
});
test('expired Claude OAuth is reported as an actionable provider error, even when the SDK reports idle', async () => {
  const h = adapter({
    run: async () => ({
      status: 'idle',
      lastMessage: 'Failed to authenticate: OAuth session expired and could not be refreshed',
      error: null,
    }),
  });
  const result = await h.runtime.run(savedWorkflow(), 'builder', 'task', 'operation');
  assert.equal(result.status, 'error');
  assert.match(result.error!, /OAuth session expired/);
});
test('Claude read-only roles cannot exit plan mode or edit files; Builder retains its selected mode', async () => {
  const created: unknown[] = [];
  const api = {
    config: { get: async () => ({ config: { providers: {} } }) },
    workspaces: {
      ref: () => ({
        agents: {
          create: async (input: unknown) => {
            created.push(input);
            return { id: 'agent' };
          },
        },
      }),
    },
  } as unknown as PaseoApi;
  const runtime = new PaseoRuntime(api, '/unused');
  const w = {
    id: 'workflow',
    workspaceId: 'workspace',
    config: {
      roles: {
        planner: { provider: 'claude/discovered', modeId: 'plan' },
        builder: { provider: 'codex/discovered', modeId: 'auto' },
      },
    },
  } as unknown as Workflow;
  await runtime.agent(w, 'planner');
  await runtime.agent(w, 'builder');
  const [planner, builder] = created as {
    env: Record<string, string>;
    config: { modeId: string; options?: { disallowedTools: string[] } };
  }[];
  assert.equal(planner.env.GIT_OPTIONAL_LOCKS, '0');
  assert.equal(builder.env.GIT_OPTIONAL_LOCKS, '0');
  assert.equal(planner.config.modeId, 'plan');
  assert.ok(planner.config.options?.disallowedTools.includes('ExitPlanMode'));
  assert.ok(planner.config.options?.disallowedTools.includes('Write'));
  assert.equal(builder.config.modeId, 'auto');
  assert.equal(builder.config.options, undefined);
});
test('a listed model that requires usage credits reports a provider error without substituting another model', async () => {
  const h = adapter({
    run: async () => ({
      status: 'idle',
      lastMessage: 'Fable 5.1 requires usage credits. Switch to another model to continue.',
      error: null,
    }),
  });
  const result = await h.runtime.run(savedWorkflow(), 'builder', 'task', 'operation');
  assert.equal(result.status, 'error');
  assert.match(result.error!, /requires usage credits/);
});

test('a custom Claude account keeps its identity and read-only restrictions at launch', async () => {
  let captured!: {
    config: { provider: string; modeId: string; options: { disallowedTools: string[] } };
    env: Record<string, string>;
  };
  const api = {
    config: {
      get: async () => ({ config: { providers: { 'credit-account': { extends: 'claude', label: 'Credits' } } } }),
    },
    workspaces: {
      ref: () => ({
        agents: {
          create: async (input: unknown) => {
            captured = input as typeof captured;
            return { id: 'agent' };
          },
        },
      }),
    },
  } as unknown as PaseoApi;
  const runtime = new PaseoRuntime(api, '/unused');
  const w = {
    id: 'workflow',
    workspaceId: 'workspace',
    config: { roles: { reviewer: { provider: 'credit-account/fable', modeId: 'plan' } } },
  } as unknown as Workflow;
  await runtime.agent(w, 'reviewer');
  assert.equal(captured.config.provider, 'credit-account/fable');
  assert.equal(captured.config.modeId, 'plan');
  assert.ok(captured.config.options.disallowedTools.includes('ExitPlanMode'));
  assert.deepEqual(captured.env, { GIT_OPTIONAL_LOCKS: '0' });
});
test('Codex review uses a read-only sandbox with escalation disabled while Builder keeps its selected mode', async () => {
  const created: { config: { modeId: string; provider: string; options?: unknown } }[] = [];
  const api = {
    config: { get: async () => ({ config: { providers: { 'codex-account': { extends: 'codex' } } } }) },
    providers: { listModes: async () => ({ modes: [{ id: 'auto' }, { id: 'full-access' }] }) },
    workspaces: {
      ref: () => ({
        agents: {
          create: async (input: unknown) => {
            created.push(input as (typeof created)[number]);
            return { id: 'agent' };
          },
        },
      }),
    },
  } as unknown as PaseoApi;
  const runtime = new PaseoRuntime(api, '/unused');
  const w = {
    id: 'workflow',
    workspaceId: 'workspace',
    cwd: '/repo',
    config: {
      roles: {
        reviewer: { provider: 'codex-account/model', modeId: 'read-only' },
        builder: { provider: 'codex/model', modeId: 'full-access' },
      },
    },
  } as unknown as Workflow;
  await runtime.agent(w, 'reviewer');
  await runtime.agent(w, 'builder');
  assert.equal(created[0].config.provider, 'codex-account/model');
  assert.equal(created[0].config.modeId, 'auto');
  assert.deepEqual(created[0].config.options, { sandbox_mode: 'read-only', approval_policy: 'never' });
  assert.equal(created[1].config.modeId, 'full-access');
  assert.equal(created[1].config.options, undefined);
});
test('generic harnesses preserve discovered model IDs and omit workflow-only default markers at launch', async () => {
  const created: { config: { provider: string; modeId?: string; options?: unknown; systemPrompt: string } }[] = [];
  const api = {
    config: { get: async () => ({ config: { providers: {} } }) },
    providers: {
      listModes: async (id: string) => ({ modes: id === 'opencode' ? [{ id: 'build' }, { id: 'plan' }] : [] }),
    },
    workspaces: {
      ref: () => ({
        agents: {
          create: async (input: unknown) => {
            created.push(input as (typeof created)[number]);
            return { id: 'agent' };
          },
        },
      }),
    },
  } as unknown as PaseoApi;
  const runtime = new PaseoRuntime(api, '/unused');
  const w = {
    id: 'workflow',
    workspaceId: 'workspace',
    cwd: '/repo',
    config: {
      roles: {
        planner: { provider: 'opencode/zen/free-model', modeId: 'plan' },
        builder: { provider: `pi/${DEFAULT_MODEL}`, modeId: DEFAULT_MODE },
        reviewer: { provider: 'pi/connected/model', modeId: INSTRUCTION_READ_ONLY },
      },
    },
  } as unknown as Workflow;
  await runtime.agent(w, 'planner');
  await runtime.agent(w, 'builder');
  await runtime.agent(w, 'reviewer');
  assert.equal(created[0].config.provider, 'opencode/zen/free-model');
  assert.equal(created[0].config.modeId, 'plan');
  assert.equal(created[0].config.options, undefined);
  assert.equal(created[1].config.provider, 'pi');
  assert.equal(created[1].config.modeId, undefined);
  assert.equal(created[2].config.provider, 'pi/connected/model');
  assert.equal(created[2].config.modeId, undefined);
  assert.match(created[2].config.systemPrompt, /Never edit files/);
  assert.doesNotMatch(JSON.stringify(created), /__paseo_|__agent_teams/);
});
