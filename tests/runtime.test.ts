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
    send: async () => {
      sends++;
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
test('explicit coordinator recovery binds the exact operation and ignores plugin progress cards', async () => {
  const prompt = { turnId: 'turn', item: { type: 'user_message', text: '[agent-teams-operation:operation]\ntask' } };
  const reply = {
    turnId: 'turn',
    seqEnd: 12,
    item: { type: 'assistant_message', text: '{"kind":"reply","summary":"Done"}' },
  };
  const progress = { item: { type: 'plugin', kind: 'agent-teams-progress' } };
  const w = savedWorkflow();
  w.agents.planner = 'planner';
  w.workspaceId = 'owner';
  w.cwd = '/repo';
  const scope = { workspaceId: 'owner', cwd: '/repo' };
  const h = adapter(scope, [progress, prompt, progress, reply, progress]);
  const result = await h.runtime.coordinatorResult(w);
  assert.equal(result.text, reply.item.text);
  assert.deepEqual(result.source, { epoch: 'epoch', seq: 12, turnId: 'turn' });
  assert.deepEqual(h.counts(), { sends: 0, waits: 0, appends: 0 });
  for (const entries of [
    [prompt, reply, { ...prompt, item: { ...prompt.item, text: 'foreign task' } }],
    [{ ...prompt, item: { ...prompt.item, text: '[agent-teams-operation:wrong]\ntask' } }, reply],
    [prompt, { turnId: 'foreign', item: { type: 'tool_call' } }, reply],
  ])
    await assert.rejects(adapter(scope, entries).runtime.coordinatorResult(w));
  await assert.rejects(adapter({ ...scope, workspaceId: 'foreign' }, [prompt, reply]).runtime.coordinatorResult(w));
});
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
  assert.equal(result.status, 'working');
  assert.deepEqual(h.counts(), { sends: 0, waits: 0, appends: 0 });
});
test('dispatch sends once and returns without waiting for role completion', async () => {
  const h = adapter({
    run: async () => assert.fail('must not hold an SDK run open'),
  });
  assert.equal((await h.runtime.run(savedWorkflow(), 'builder', 'task', 'operation')).status, 'working');
  assert.deepEqual(h.counts(), { sends: 1, waits: 0, appends: 0 });
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
  const h = adapter({}, [accepted]);
  const w = savedWorkflow();
  w.receipts = {
    operation: JSON.stringify({
      status: 'idle',
      text: 'Failed to authenticate: OAuth session expired and could not be refreshed',
    }),
  };
  const result = await h.runtime.reconcile(w);
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
  const h = adapter({}, [accepted]);
  const w = savedWorkflow();
  w.receipts = {
    operation: JSON.stringify({
      status: 'idle',
      text: 'Fable 5.1 requires usage credits. Switch to another model to continue.',
    }),
  };
  const result = await h.runtime.reconcile(w);
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

test('Builder auto-accept resolves discovered native modes and features without changing Reviewer', async () => {
  for (const [harness, family, selected, expected] of [
    ['codex', 'codex', 'auto', 'full-access'],
    ['credit-account', 'claude', 'default', 'bypassPermissions'],
    ['opencode', 'opencode', 'build', 'build'],
    ['pi', 'pi', 'native-default', 'native-default'],
  ]) {
    const created: { config: { modeId: string; featureValues?: unknown; options?: unknown } }[] = [];
    const api = {
      config: { get: async () => ({ config: { providers: { [harness]: { extends: family } } } }) },
      providers: {
        listModes: async () => ({ modes: [{ id: selected }, { id: expected }, { id: 'plan' }] }),
        listFeatures: async () => ({ features: family === 'opencode' ? [{ id: 'auto_accept', type: 'toggle' }] : [] }),
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
    const w = {
      id: 'workflow',
      workspaceId: 'workspace',
      cwd: '/repo',
      config: {
        builderAutoAccept: true,
        roles: {
          builder: { provider: `${harness}/detected-model`, modeId: selected },
          reviewer: { provider: `${harness}/detected-model`, modeId: 'plan' },
        },
      },
    } as unknown as Workflow;
    const runtime = new PaseoRuntime(api, '/unused');
    await runtime.agent(w, 'builder');
    await runtime.agent(w, 'reviewer');
    assert.equal(created[0].config.modeId, expected);
    assert.deepEqual(created[0].config.featureValues, family === 'opencode' ? { auto_accept: true } : undefined);
    assert.equal(created[1].config.modeId, 'plan');
    assert.equal(created[1].config.featureValues, undefined);
  }
});

test('auto-accept answers only Builder tool requests and deduplicates concurrent answers', async () => {
  const replies: unknown[] = [];
  const pendingPermissions = [
    { id: 'tool', name: 'Bash', kind: 'tool', actions: [{ id: 'once', label: 'Allow once', behavior: 'allow' }] },
    { id: 'question', name: 'Question', kind: 'question' },
    { id: 'plan', name: 'ExitPlanMode', kind: 'plan' },
    { id: 'deny-only', name: 'Blocked', kind: 'tool', actions: [{ id: 'deny', label: 'Deny', behavior: 'deny' }] },
  ];
  const h = adapter({
    pendingPermissions,
    respondToPermission: async (input: unknown) => {
      replies.push(input);
    },
  });
  const w = savedWorkflow();
  w.config = { builderAutoAccept: true } as Workflow['config'];
  await Promise.all([h.runtime.autoApprove(w), h.runtime.autoApprove(w)]);
  assert.deepEqual(replies, [{ requestId: 'tool', response: { behavior: 'allow', selectedActionId: 'once' } }]);
  w.operation!.role = 'reviewer';
  assert.equal(await h.runtime.autoApprove(w), false);
  w.operation!.role = 'builder';
  w.config.builderAutoAccept = false;
  assert.equal(await h.runtime.autoApprove(w), false);
});

test('manual permissions retain read-only roles and never answer a different request on retry', async () => {
  const replies: unknown[] = [];
  const h = adapter({
    pendingPermissions: [{ id: 'plan', name: 'ExitPlanMode', kind: 'plan' }],
    respondToPermission: async (input: unknown) => {
      replies.push(input);
    },
  });
  const w = savedWorkflow();
  w.operation!.role = 'reviewer';
  w.agents.reviewer = 'reviewer';
  assert.equal((await h.runtime.permissions(w))[0].canAllow, false);
  await assert.rejects(h.runtime.respondPermission(w, 'plan', 'allow'), /remain read-only/);
  await h.runtime.respondPermission(w, 'stale', 'allow');
  assert.equal(replies.length, 0);
  await h.runtime.respondPermission(w, 'plan', 'deny');
  assert.deepEqual(replies, [
    { requestId: 'plan', response: { behavior: 'deny', selectedActionId: undefined, interrupt: true } },
  ]);
});

test('auto-accept preserves harness defaults when no model, mode or feature catalog is advertised', async () => {
  let captured!: { config: { provider: string; modeId?: string; featureValues?: unknown } };
  const api = {
    config: { get: async () => ({ config: { providers: {} } }) },
    providers: {
      listModes: async () => ({ modes: [] }),
      listFeatures: async (input: { provider: string; modeId?: string }) => {
        assert.equal(input.provider, 'pi');
        assert.equal(input.modeId, undefined);
        return {};
      },
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
  const w = {
    id: 'workflow',
    workspaceId: 'workspace',
    cwd: '/repo',
    config: { builderAutoAccept: true, roles: { builder: { provider: `pi/${DEFAULT_MODEL}`, modeId: DEFAULT_MODE } } },
  } as unknown as Workflow;
  await new PaseoRuntime(api, '/unused').agent(w, 'builder');
  assert.equal(captured.config.provider, 'pi');
  assert.equal(captured.config.modeId, undefined);
  assert.equal(captured.config.featureValues, undefined);
});

test('replacement sessions use a persisted generation key without changing other role identities', async () => {
  const created: { idempotencyKey: string }[] = [];
  const api = {
    config: { get: async () => ({ config: { providers: {} } }) },
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
    cycle: 4,
    config: {
      roles: {
        builder: { provider: 'codex/model', modeId: 'auto' },
        planner: { provider: 'claude/model', modeId: 'plan' },
      },
    },
    agentGenerations: { builder: 2 },
  } as unknown as Workflow;
  await runtime.agent(w, 'builder');
  await runtime.agent(w, 'builder');
  await runtime.agent(w, 'planner');
  assert.deepEqual(
    created.map((c) => c.idempotencyKey),
    ['workflow-builder-g2', 'workflow-builder-g2', 'workflow-planner'],
  );
});

test('hot selections must use a discovered model and retain read-only permissions for planning and review', async () => {
  const api = {
    config: { get: async () => ({ config: { providers: {} } }) },
    providers: {
      waitForReady: async () => ({ entries: [{ provider: 'codex', status: 'ready', models: [{ id: 'detected' }] }] }),
      listModes: async () => ({ modes: [{ id: 'auto' }, { id: 'full-access' }] }),
    },
  } as unknown as PaseoApi;
  const runtime = new PaseoRuntime(api, '/unused'),
    w = { cwd: '/repo' } as Workflow;
  await runtime.validateSelection(w, 'reviewer', { provider: 'codex/detected', modeId: 'read-only' });
  await assert.rejects(
    runtime.validateSelection(w, 'reviewer', { provider: 'codex/detected', modeId: 'full-access' }),
    /read-only permission/,
  );
  await assert.rejects(
    runtime.validateSelection(w, 'builder', { provider: 'codex/invented', modeId: 'auto' }),
    /Unavailable provider/,
  );
});

test('native progress uses the plugin connection without duplicating assistant artifacts', async () => {
  const items: unknown[] = [];
  const ordinary = {
    agents: {
      ref: () => ({
        timeline: {
          append: async () => {
            throw Error('ordinary SDK must not publish');
          },
        },
      }),
    },
  } as unknown as PaseoApi;
  const plugin = {
    agents: {
      ref: () => ({
        timeline: {
          append: async (item: unknown) => {
            items.push(item);
          },
        },
      }),
    },
  } as unknown as PaseoApi;
  const runtime = new PaseoRuntime(ordinary, '/unused', () => plugin);
  const w = savedWorkflow();
  w.agents.planner = 'planner';
  w.phase = 'done';
  w.status = 'completed';
  w.task = 'Task';
  w.cycle = 0;
  w.events.push({
    id: 'result',
    at: new Date().toISOString(),
    kind: 'assistant',
    role: 'planner',
    text: JSON.stringify({ summary: 'Readable plan', tasks: ['Do it'], acceptance: ['Works'], tests: [] }),
  });
  await runtime.publish(w);
  assert.equal(items.length, 1);
  assert.equal((items[0] as { data: { artifact?: unknown } }).data.artifact, undefined);
});

test('skill discovery uses the selected role session and gracefully tolerates unavailable catalogs', async () => {
  const w = savedWorkflow();
  w.task = 'normalizeLabel using team-live-verification';
  let calls = 0;
  const h = adapter({
    commands: async () => {
      calls++;
      return {
        commands: [{ name: 'team-live-verification', description: 'Behavior tests', kind: 'skill' }],
        error: null,
      };
    },
  });
  assert.match(await h.runtime.skillContext(w, 'builder'), /team-live-verification/);
  assert.equal(calls, 1);
  const unavailable = adapter({
    commands: async () => {
      throw new Error('unsupported');
    },
  });
  assert.match(await unavailable.runtime.skillContext(w, 'builder'), /unavailable/);
});

test('native Reviewer import reads only the final canonical native reply without sending or waiting', async () => {
  const native = [
    { item: { type: 'user_message', text: 'Propose a revised plan' }, turnId: 'native-turn', seqEnd: 1 },
    { item: { type: 'assistant_message', text: 'Thinking about it' }, turnId: 'native-turn', seqEnd: 2 },
    {
      item: { type: 'assistant_message', text: '{"kind":"discussion","summary":"Ready"}' },
      turnId: 'native-turn',
      seqEnd: 3,
    },
  ];
  const h = adapter({}, native);
  const w = savedWorkflow();
  w.agents.reviewer = 'reviewer';
  const result = await h.runtime.reviewerPlan(w);
  assert.equal(result.text, native[2].item.text);
  assert.deepEqual(result.source, { epoch: 'epoch', seq: 3, turnId: 'native-turn' });
  assert.deepEqual(h.counts(), { sends: 0, waits: 0, appends: 0 });
});

test('native import refuses busy, partial, workflow-owned and ambiguous timelines', async () => {
  const w = savedWorkflow();
  w.agents.reviewer = 'reviewer';
  const prompt = { item: { type: 'user_message', text: 'Native question' }, seqEnd: 1 };
  const answer = { item: { type: 'assistant_message', text: '{}' }, turnId: 'turn', seqEnd: 2 };
  for (const h of [
    adapter({ status: 'running' }, [prompt, answer]),
    adapter({ activeTurn: { turnId: 'turn' } }, [prompt, answer]),
    adapter({ pendingPermissions: [{}] }, [prompt, answer]),
    adapter({}, [accepted, answer]),
    adapter({}, [answer]),
    adapter({}, [prompt]),
    adapter({}, [prompt, answer, { ...answer, turnId: 'another' }]),
    adapter({ timeline: { refetch: async () => ({ entries: [prompt, answer], gap: true }) } }),
  ]) {
    await assert.rejects(h.runtime.reviewerPlan(w));
    assert.equal(h.counts().sends, 0);
  }
});

test('native Planner answers share canonical completeness and permission safeguards without dispatch', async () => {
  const w = savedWorkflow();
  w.agents.planner = 'planner';
  const prompt = {
    item: { type: 'user_message', text: '{"workflowId":"workflow","clarificationId":"batch","answers":[]}' },
    seqEnd: 1,
  };
  const answer = { item: { type: 'assistant_message', text: 'Recorded' }, turnId: 'native-turn', seqEnd: 2 };
  const h = adapter({}, [prompt, answer]);
  assert.equal((await h.runtime.plannerAnswers(w)).prompt, prompt.item.text);
  for (const bad of [
    adapter({ status: 'running' }, [prompt, answer]),
    adapter({ pendingPermissions: [{}] }, [prompt, answer]),
    adapter({}, [accepted, answer]),
    adapter({}, [prompt]),
    adapter({}, [prompt, answer, { ...answer, turnId: 'other' }]),
    adapter({ timeline: { refetch: async () => ({ entries: [prompt, answer], gap: true }) } }),
  ]) {
    await assert.rejects(bad.runtime.plannerAnswers(w));
    assert.equal(bad.counts().sends, 0);
  }
  assert.deepEqual(h.counts(), { sends: 0, waits: 0, appends: 0 });
});

test('checkpoint inactivity checks every role including active turns with an idle status', async () => {
  const w = savedWorkflow();
  w.agents = { planner: 'planner', builder: 'builder', reviewer: 'reviewer' };
  for (const role of Object.values(w.agents)) {
    for (const state of [
      { status: 'running' },
      { status: 'initializing' },
      { activeTurn: { turnId: 'native-turn' } },
      { pendingPermissions: [{}] },
      { refresh: async () => null },
    ]) {
      const idle = { status: 'idle', activeTurn: null, pendingPermissions: [], refresh: async () => ({}) };
      const api = {
        agents: { ref: (id: string) => (id === role ? { ...idle, ...state } : idle) },
      } as unknown as PaseoApi;
      assert.equal(await new PaseoRuntime(api, '/unused').canClose(w), false, `${role}: ${JSON.stringify(state)}`);
    }
  }
  assert.equal(await adapter().runtime.canClose(w), true);
});

test('Team Auto roles are native children of the orchestrator agent, and degrade to tabs when it is gone', async () => {
  const created: { parent?: string; idempotencyKey: string }[] = [];
  let missing = false;
  const api = {
    config: { get: async () => ({ config: { providers: {} } }) },
    workspaces: {
      ref: () => ({
        agents: {
          create: async (input: { parent?: string; idempotencyKey: string }) => {
            created.push(input);
            if (input.parent && missing) throw new Error(`Caller agent ${input.parent} not found`);
            return { id: `agent-${created.length}` };
          },
        },
      }),
    },
  } as unknown as PaseoApi;
  const runtime = new PaseoRuntime(api, '/unused');
  const w = {
    id: 'workflow',
    workspaceId: 'workspace',
    ownerAgentId: 'team-auto',
    config: { roles: { builder: { provider: 'codex/discovered', modeId: 'auto' } } },
  } as unknown as Workflow;
  assert.equal(await runtime.agent(w, 'builder'), 'agent-1');
  assert.equal(created[0].parent, 'team-auto');
  missing = true;
  assert.equal(await runtime.agent(w, 'builder'), 'agent-3');
  assert.equal(created[2].parent, undefined);
  assert.equal(created[2].idempotencyKey, created[1].idempotencyKey);
  await assert.rejects(
    new PaseoRuntime(
      {
        ...api,
        workspaces: {
          ref: () => ({
            agents: {
              create: async () => {
                throw new Error('Provider unavailable');
              },
            },
          }),
        },
      } as unknown as PaseoApi,
      '/unused',
    ).agent(w, 'builder'),
    /Provider unavailable/,
  );
});

test('role activity lists the tool calls of one operation turn, latest state per call', async () => {
  const tool = (callId: string, detail: unknown, status = 'completed') => ({
    item: { type: 'tool_call', callId, name: 'tool', status, error: null, detail },
  });
  const entries = [
    { item: { type: 'user_message', text: '[agent-teams-operation:old]\nOld' } },
    tool('old', { type: 'read', filePath: 'old.ts' }),
    { item: { type: 'user_message', text: '[agent-teams-operation:operation]\nTask' } },
    tool('a', { type: 'shell', command: 'npm   test' }, 'running'),
    tool('b', { type: 'edit', filePath: 'src/a.ts' }),
    tool('a', { type: 'shell', command: 'npm   test' }),
    { item: { type: 'assistant_message', text: 'done' } },
    { item: { type: 'user_message', text: 'native follow-up' } },
    tool('c', { type: 'read', filePath: 'later.ts' }),
  ];
  const h = adapter({}, entries);
  assert.deepEqual(await h.runtime.activity(savedWorkflow(), 'builder', 'operation'), [
    { toolName: 'Shell', summary: 'npm test' },
    { toolName: 'Edit', summary: 'src/a.ts' },
  ]);
  assert.deepEqual(await h.runtime.activity(savedWorkflow(), 'builder', 'unknown'), []);
});

test('Team Auto role sessions are titled in the interface language', async () => {
  const titles: string[] = [];
  const api = {
    config: { get: async () => ({ config: { providers: {} } }) },
    workspaces: {
      ref: () => ({
        agents: {
          create: async (input: { title: string }) => {
            titles.push(input.title);
            return { id: 'agent' };
          },
        },
      }),
    },
  } as unknown as PaseoApi;
  const w = {
    id: 'workflow',
    workspaceId: 'workspace',
    ownerAgentId: 'team-auto',
    config: { roles: { reviewer: { provider: 'claude/discovered', modeId: 'plan' } } },
  } as unknown as Workflow;
  await new PaseoRuntime(
    api,
    '/unused',
    () => api,
    async () => 'en',
  ).agent(w, 'reviewer');
  await new PaseoRuntime(api, '/unused').agent(w, 'reviewer');
  assert.deepEqual(titles, ['Review', 'Revue']);
});

test('a later native conversation cannot invalidate or replace an exact completed-operation receipt', async () => {
  const h = adapter({}, [
    accepted,
    { item: { type: 'assistant_message', text: 'original' } },
    { item: { type: 'user_message', text: 'human answered a question' } },
    { item: { type: 'assistant_message', text: 'later native work is now finished' } },
  ]);
  const w = savedWorkflow();
  w.receipts = { operation: JSON.stringify({ status: 'idle', text: 'original proven result' }) };
  const result = await h.runtime.reconcile(w);
  assert.equal(result.status, 'idle');
  assert.equal(result.text, 'original proven result');
  assert.equal(result.externallyContinued, true);
  assert.equal(h.counts().sends, 0);
});
