import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, type Outcome, type Runtime, type CheckScope } from '../server/engine';
import { Store } from '../server/store';
import { configSchema, type Action, type Config, type Role, type Workflow } from '../shared/contracts';
import { INSTRUCTION_READ_ONLY } from '../shared/provider-selection';
const plan = {
  summary: 'Add OAuth2',
  tasks: ['Implement callback'],
  acceptance: ['Tests pass'],
  tests: [{ command: 'npm test', timeoutMs: 1000 }],
};
const build = { summary: 'Implemented', changes: ['callback.ts'], remaining: [] };
const pass = { verdict: 'pass', summary: 'Ready', issues: [] };
const fail = { verdict: 'fail', summary: 'Needs correction', issues: ['Missing state verification'] };
const base = () =>
  configSchema.parse({
    version: 1,
    roles: {
      planner: { provider: 'claude/discovered', modeId: 'plan' },
      builder: { provider: 'codex/discovered', modeId: 'auto' },
      reviewer: { provider: 'claude/discovered', modeId: 'plan' },
    },
  });
class Fake implements Runtime {
  reviewerPlan?: NonNullable<Runtime['reviewerPlan']>;
  plannerAnswers?: NonNullable<Runtime['plannerAnswers']>;
  calls: { role: Role; id: string; prompt: string }[] = [];
  responses: Partial<Record<Role, string[]>> = {};
  reviewCount = 0;
  testCount = 0;
  recoveryCount = 0;
  creationCount = 0;
  lost = false;
  nextRecovery?: Outcome;
  gate?: Promise<void>;
  async prepare() {
    return { cwd: '/repo', repo: '/repo/.git', baseline: '/baseline' };
  }
  async agent(w: Workflow, role: Role) {
    this.creationCount++;
    return `${w.id}-${role}`;
  }
  async context() {
    return 'initial dirty state + current changes';
  }
  async publish() {}
  async validateSelection() {}
  async canClose() {
    return true;
  }
  async fingerprint() {
    return 'snapshot-fingerprint';
  }
  async tests(w: Workflow) {
    this.testCount++;
    return (w.plan?.tests ?? []).map((t) => ({
      ...t,
      stdout: 'passed',
      stderr: '',
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
      truncated: false,
    }));
  }
  async run(_w: Workflow, role: Role, prompt: string, id: string): Promise<Outcome> {
    this.calls.push({ role, id, prompt });
    await this.gate;
    if (this.lost) {
      this.lost = false;
      throw new Error('connection lost after acceptance');
    }
    const text =
      this.responses[role]?.shift() ?? JSON.stringify(role === 'planner' ? plan : role === 'builder' ? build : pass);
    return { status: 'idle', text };
  }
  async reconcile(): Promise<Outcome> {
    this.recoveryCount++;
    return this.nextRecovery ?? { status: 'uncertain', error: 'missing receipt' };
  }
}
async function setup(t: TestContext, overrides: Partial<Config> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'teams-engine-'));
  const fake = new Fake(),
    store = new Store(dir),
    engine = new Engine(store, fake);
  t.after(async () => {
    engine.close();
    await engine.settle();
    await rm(dir, { recursive: true, force: true });
  });
  const config = { ...base(), ...overrides };
  return {
    engine,
    fake,
    store,
    config,
    async create() {
      const w = await engine.create('workspace', 'Implement OAuth2', config, 'create-1');
      await engine.settle();
      return store.get(w.id);
    },
    async action(w: Workflow, action: Action['action'], extra = {}) {
      await engine.action({
        id: w.id,
        expectedRevision: w.revision,
        requestId: `${action}-${Math.random()}`,
        action,
        ...extra,
      });
      await engine.settle();
      return store.get(w.id);
    },
  };
}
test('approved plan → build → tests → review completes and reuses three sessions', async (t) => {
  const h = await setup(t);
  let w = await h.create();
  assert.equal(w.status, 'awaiting_plan');
  assert.equal(h.fake.calls.length, 1);
  w = await h.action(w, 'approve');
  assert.equal(w.status, 'completed');
  assert.equal(h.fake.creationCount, 3);
  assert.equal(h.fake.testCount, 1);
  assert.deepEqual(
    h.fake.calls.map((c) => c.role),
    ['planner', 'builder', 'reviewer'],
  );
});
test('failed review triggers at most two corrections', async (t) => {
  const h = await setup(t);
  h.fake.responses.reviewer = [JSON.stringify(fail), JSON.stringify(fail), JSON.stringify(fail)];
  let w = await h.create();
  w = await h.action(w, 'approve');
  assert.equal(w.status, 'attention');
  assert.equal(w.cycle, 2);
  assert.equal(h.fake.calls.filter((c) => c.role === 'builder').length, 3);
  assert.equal(h.fake.creationCount, 3);
  assert.match(h.fake.calls.filter((c) => c.role === 'builder')[1].prompt, /Missing state verification/);
});
test('failed tests cannot be overridden by a passing review', async (t) => {
  const h = await setup(t, { maxCorrections: 0 });
  h.fake.tests = async (w) =>
    w.plan!.tests.map((t) => ({
      ...t,
      stdout: '',
      stderr: 'failure',
      exitCode: 1,
      durationMs: 1,
      timedOut: false,
      truncated: false,
    }));
  let w = await h.create();
  w = await h.action(w, 'approve');
  assert.equal(w.status, 'attention');
});
test('explicit launch commands override planner commands for final and autonomous policies', async (t) => {
  for (const validation of ['final', 'autonomous'] as const) {
    const h = await setup(t, { validation, testCommands: [{ command: 'trusted-check', timeoutMs: 1000 }] });
    let w = await h.create();
    assert.equal(w.plan!.tests[0].command, 'trusted-check');
    assert.equal(w.status, validation === 'final' ? 'awaiting_final' : 'completed');
    if (validation === 'final') {
      w = await h.action(w, 'approve');
      assert.equal(w.status, 'completed');
    }
  }
});
test('planner commands require explicit approval in autonomous and final modes', async (t) => {
  for (const validation of ['autonomous', 'final'] as const) {
    const h = await setup(t, { validation });
    let w = await h.create();
    assert.equal(w.status, 'awaiting_plan');
    assert.equal(h.fake.testCount, 0);
    assert.deepEqual(
      h.fake.calls.map((c) => c.role),
      ['planner'],
    );
    w = await h.action(w, 'approve');
    assert.equal(w.status, validation === 'final' ? 'awaiting_final' : 'completed');
    assert.equal(w.tests[0].command, 'npm test');
    assert.equal(w.tests[0].exitCode, 0);
  }
});
test('an autonomous planner proposing no tests pauses after planning unless their absence was accepted', async (t) => {
  for (const allowNoTests of [false, true]) {
    const h = await setup(t, { validation: 'autonomous', allowNoTests });
    h.fake.responses.planner = [JSON.stringify({ ...plan, tests: [] })];
    const w = await h.create();
    assert.equal(w.status, allowNoTests ? 'completed' : 'awaiting_plan');
    assert.equal(h.fake.calls.length, allowNoTests ? 3 : 1);
  }
});
test('no tests requires explicit acceptance and is recorded', async (t) => {
  const h = await setup(t);
  h.fake.responses.planner = [JSON.stringify({ ...plan, tests: [] })];
  let w = await h.create();
  await assert.rejects(
    h.engine.action({ id: w.id, expectedRevision: w.revision, requestId: 'reject-no-tests', action: 'approve' }),
    /absence of tests/,
  );
  w = await h.action(w, 'approve', { allowNoTests: true });
  assert.equal(w.status, 'completed');
  assert.equal(w.allowNoTests, true);
  assert.equal(w.planVersions!.at(-1)!.approval?.allowNoTests, true);
});
test('persistently invalid output stops after two formatting repairs and never dispatches a builder', async (t) => {
  const h = await setup(t);
  h.fake.responses.planner = ['not JSON', 'not JSON', 'not JSON'];
  const w = await h.create();
  assert.equal(w.status, 'attention');
  assert.equal(h.fake.calls.length, 3);
});
test('duplicate requests are idempotent; conflicting concurrent approvals are rejected', async (t) => {
  const h = await setup(t);
  const w = await h.create();
  const input = { id: w.id, expectedRevision: w.revision, requestId: 'approval', action: 'approve' as const };
  const results = await Promise.allSettled([
    h.engine.action(input),
    h.engine.action({ ...input, requestId: 'other-client' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  await h.engine.settle();
  await h.engine.action(input);
  assert.equal(h.fake.calls.filter((c) => c.role === 'builder').length, 1);
  const persisted = await h.store.get(w.id);
  assert.equal(persisted.planVersions?.length, 1);
  assert.equal(persisted.events.filter((e) => e.kind === 'plan_approved').length, 1);
  await assert.rejects(h.engine.action({ ...input, action: 'pause' }), /reused/);
  const duplicate = await h.engine.create('workspace', 'Implement OAuth2', h.config, 'create-1');
  assert.equal(duplicate.id, w.id);
});
test('one workflow holds a repository lock even when paused', async (t) => {
  const h = await setup(t);
  const w = await h.create();
  await h.action(w, 'pause');
  await assert.rejects(
    h.engine.create('second-workspace', 'Other task', h.config, 'create-2'),
    /holds this repository/,
  );
});
test('pause/resume preserves a pending approval checkpoint', async (t) => {
  const h = await setup(t);
  let w = await h.create();
  w = await h.action(w, 'pause');
  w = await h.action(w, 'resume');
  assert.equal(w.status, 'awaiting_plan');
  assert.equal(h.fake.calls.length, 1);
});
test('manual handoff includes prior response and uses a persistent target session', async (t) => {
  const h = await setup(t, { mode: 'manual' });
  let w = await h.create();
  const builder = w.agents.builder;
  w = await h.action(w, 'handoff', { role: 'builder' });
  assert.equal(w.status, 'paused');
  assert.equal(w.agents.builder, builder);
  assert.match(h.fake.calls[1].prompt, /Add OAuth2/);
  assert.match(h.fake.calls[1].prompt, /initial dirty state/);
  w = await h.action(w, 'finish');
  assert.equal(w.status, 'completed');
});
test('permission suspends until resolved, then reconciles without resending', async (t) => {
  const h = await setup(t);
  h.fake.nextRecovery = { status: 'permission' };
  h.fake.run = async (_w, role, prompt, id) => {
    h.fake.calls.push({ role, prompt, id });
    return { status: 'permission' };
  };
  let w = await h.create();
  assert.equal(w.status, 'permission');
  h.fake.nextRecovery = { status: 'idle', text: JSON.stringify(plan) };
  await h.engine.resolvePermission(w.agents.planner!);
  await h.engine.settle();
  w = await h.store.get(w.id);
  assert.equal(w.status, 'awaiting_plan');
  assert.equal(h.fake.calls.length, 1);
});
test('lost response remains attached; explicit recovery completes without a second send', async (t) => {
  const h = await setup(t);
  h.fake.lost = true;
  let w = await h.create();
  assert.equal(w.status, 'attention');
  const op = w.operation!.id;
  h.fake.nextRecovery = { status: 'idle', text: JSON.stringify(plan) };
  w = await h.action(w, 'resume');
  assert.equal(w.status, 'awaiting_plan');
  assert.equal(h.fake.calls.length, 1);
  assert.equal(h.fake.calls[0].id, op);
});
test('restart recovery leaves ambiguous sends for intervention; duplicate receipts are ignored', async (t) => {
  const h = await setup(t);
  h.fake.lost = true;
  let w = await h.create();
  const op = w.operation!;
  await h.engine.receipt(w.agents.planner!, { status: 'idle' }, [
    { type: 'user_message', text: `[agent-teams-operation:${op.id}]` },
    { type: 'assistant_message', text: JSON.stringify(plan) },
  ]);
  await h.engine.receipt(w.agents.planner!, { status: 'idle' }, [
    { type: 'user_message', text: `[agent-teams-operation:${op.id}]` },
  ]);
  w = await h.store.get(w.id);
  assert.equal(Object.keys(w.receipts ?? {}).filter((id) => id === op.id).length, 1);
  const fresh = new Engine(h.store, h.fake);
  await fresh.action({ id: w.id, expectedRevision: w.revision, requestId: 'restart', action: 'resume' });
  await fresh.settle();
  fresh.close();
  w = await h.store.get(w.id);
  assert.equal(w.status, 'attention');
  assert.equal(w.operation!.id, op.id);
  assert.equal(h.fake.calls.length, 1);
});
test('manual handoff waits for an active turn instead of interrupting it', async (t) => {
  const h = await setup(t, { mode: 'manual' });
  let release!: () => void;
  h.fake.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = await h.engine.create('workspace', 'Implement OAuth2', h.config, 'create-1');
  while (!h.fake.calls.length) await new Promise((r) => setTimeout(r, 5));
  let w = await h.store.get(first.id);
  await h.engine.action({
    id: w.id,
    expectedRevision: w.revision,
    requestId: 'active-handoff',
    action: 'handoff',
    role: 'builder',
  });
  assert.equal(h.fake.calls.length, 1);
  h.fake.gate = undefined;
  release();
  await h.engine.settle();
  w = await h.store.get(w.id);
  assert.deepEqual(
    h.fake.calls.map((c) => c.role),
    ['planner', 'builder'],
  );
  assert.equal(w.activeRole, 'builder');
});
test('automatic recovery reconciles an accepted operation without dispatching another prompt', async (t) => {
  const h = await setup(t, { recovery: 'automatic' });
  h.fake.lost = true;
  let w = await h.create();
  w.status = 'running';
  await h.store.put(w);
  h.fake.nextRecovery = { status: 'idle', text: JSON.stringify(plan) };
  const restarted = new Engine(h.store, h.fake);
  await restarted.recoverAutomatic();
  await restarted.settle();
  restarted.close();
  w = await h.store.get(w.id);
  assert.equal(w.status, 'awaiting_plan');
  assert.equal(h.fake.calls.length, 1);
});
test('working tree changes after tests prevent completion even with a passing review', async (t) => {
  const h = await setup(t, { maxCorrections: 0 });
  let fingerprintCalls = 0;
  h.fake.fingerprint = async () => (++fingerprintCalls === 1 ? 'tested-tree' : 'modified-after-tests');
  let w = await h.create();
  w = await h.action(w, 'approve');
  assert.equal(w.status, 'attention');
});
test('a manual message during a turn queues a follow-up for the same session', async (t) => {
  const h = await setup(t, { mode: 'manual' });
  let release!: () => void;
  h.fake.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = await h.engine.create('workspace', 'Implement OAuth2', h.config, 'create-1');
  while (!h.fake.calls.length) await new Promise((r) => setTimeout(r, 5));
  const w = await h.store.get(first.id);
  await h.engine.action({
    id: w.id,
    expectedRevision: w.revision,
    requestId: 'follow-up',
    action: 'message',
    message: 'Also cover refresh tokens',
  });
  h.fake.gate = undefined;
  release();
  await h.engine.settle();
  assert.deepEqual(
    h.fake.calls.map((c) => c.role),
    ['planner', 'planner'],
  );
  assert.match(h.fake.calls[1].prompt, /Also cover refresh tokens/);
});
test('provider presentation separators are accepted without accepting prose or invalid stage JSON', async () => {
  const { parseResult } = await import('../server/engine');
  assert.deepEqual(parseResult('builder', '\n\n---\n\n' + JSON.stringify(build)), build);
  assert.deepEqual(parseResult('builder', '\n---\n\n```json\n' + JSON.stringify(build) + '\n```'), build);
  assert.throws(() => parseResult('builder', 'Some explanation\n' + JSON.stringify(build)));
  assert.throws(() => parseResult('builder', '\n---\n\n' + JSON.stringify(build) + '\nTrailing explanation'));
});
test('shutdown preserves an accepted in-flight checkpoint when the SDK connection is closed', async (t) => {
  const h = await setup(t, { recovery: 'automatic' });
  let rejectRun!: (error: Error) => void;
  h.fake.run = async (_w, role, prompt, id) => {
    h.fake.calls.push({ role, prompt, id });
    return new Promise<Outcome>((_resolve, reject) => {
      rejectRun = reject;
    });
  };
  const created = await h.engine.create('workspace', 'Implement OAuth2', h.config, 'create-1');
  while (!rejectRun) await new Promise((r) => setTimeout(r, 5));
  h.engine.close();
  rejectRun(new Error('Daemon client closed'));
  await h.engine.settle();
  let w = await h.store.get(created.id);
  assert.equal(w.status, 'running');
  assert.ok(w.operation);
  assert.equal(w.error, undefined);
  h.fake.nextRecovery = { status: 'idle', text: JSON.stringify(plan) };
  const restarted = new Engine(h.store, h.fake);
  await restarted.recoverAutomatic();
  await restarted.settle();
  restarted.close();
  w = await h.store.get(created.id);
  assert.equal(w.status, 'awaiting_plan');
  assert.equal(h.fake.calls.length, 1);
});
test('instruction-only read-only roles stop on repository changes and keep their checkpoint across recovery', async (t) => {
  const h = await setup(t, { recovery: 'automatic' });
  h.config.roles.planner = { provider: 'pi/connected/model', modeId: INSTRUCTION_READ_ONLY };
  h.fake.lost = true;
  let fingerprint = 'original-tree';
  h.fake.fingerprint = async () => fingerprint;
  let w = await h.create();
  assert.equal(w.operation?.readOnlyFingerprint, 'original-tree');
  fingerprint = 'changed-tree';
  w.status = 'running';
  await h.store.put(w);
  h.engine.close();
  h.fake.nextRecovery = { status: 'idle', text: JSON.stringify(plan) };
  const restarted = new Engine(h.store, h.fake);
  await restarted.recoverAutomatic();
  await restarted.settle();
  restarted.close();
  w = await h.store.get(w.id);
  assert.equal(w.status, 'attention');
  assert.match(w.error!, /changed during a read-only turn/);
  assert.equal(w.operation?.readOnlyFingerprint, 'original-tree');
  assert.equal(w.plan, undefined);
  assert.equal(h.fake.calls.length, 1);
});

test('cross-workspace actions are denied before idempotency or revision handling', async (t) => {
  const h = await setup(t);
  const w = await h.create();
  await assert.rejects(
    h.engine.action({
      id: w.id,
      workspaceId: 'foreign',
      requestId: 'x',
      expectedRevision: w.revision,
      action: 'pause',
    }),
    /Workspace access denied/,
  );
  assert.equal((await h.store.get(w.id)).status, 'awaiting_plan');
});

test('blocked agent creation in one workflow does not block actions on another', async (t) => {
  const h = await setup(t);
  const first = await h.create();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  h.fake.prepare = async () => ({ cwd: '/second', repo: '/second/.git', baseline: '/baseline' });
  h.fake.agent = async () => {
    entered();
    await gate;
    return 'second-agent';
  };
  await h.engine.create('second', 'Second task', h.config, 'second-create');
  await started;
  try {
    const result = await Promise.race([
      h.engine.action({ id: first.id, expectedRevision: first.revision, requestId: 'pause-first', action: 'pause' }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('Action blocked')), 500);
        timer.unref();
      }),
    ]);
    assert.equal(result.status, 'paused');
  } finally {
    release();
  }
});

test('repeated timeouts reach attention without replaying the prompt', async (t) => {
  const h = await setup(t);
  h.fake.run = async (_w, role, prompt, id) => {
    h.fake.calls.push({ role, prompt, id });
    return { status: 'timeout' };
  };
  h.fake.nextRecovery = { status: 'timeout' };
  const w = await h.create();
  assert.equal(w.status, 'attention');
  assert.equal(w.operation?.consecutiveTimeouts, 3);
  assert.equal(h.fake.calls.length, 1);
  assert.equal(h.fake.recoveryCount, 2);
});

test('completion retains the delivery baseline and request retention preserves creation idempotency', async (t) => {
  const { writeFile, access } = await import('node:fs/promises');
  const h = await setup(t);
  const baseline = join(h.store.directory, 'baseline.snapshot');
  await writeFile(baseline, 'baseline');
  h.fake.prepare = async () => ({ cwd: '/repo', repo: '/repo/.git', baseline });
  let w = await h.create();
  for (let i = 0; i < 220; i++) w.requests[`old-${i}`] = String(i);
  await h.store.put(w);
  w = await h.action(w, 'approve');
  assert.equal(w.status, 'completed');
  await access(baseline);
  assert.ok(Object.keys(w.requests).length <= 200);
  const duplicate = await h.engine.create('workspace', 'Implement OAuth2', h.config, 'create-1');
  assert.equal(duplicate.id, w.id);
});

test('late permission observation reconciles a finished failed review and runs a correction', async (t) => {
  const h = await setup(t);
  const run = h.fake.run.bind(h.fake);
  let firstReview = true;
  h.fake.run = async (w, role, prompt, id) => {
    if (role !== 'reviewer' || !firstReview) return run(w, role, prompt, id);
    firstReview = false;
    h.fake.calls.push({ role, prompt, id });
    h.fake.nextRecovery = { status: 'idle', text: JSON.stringify(fail) };
    return { status: 'permission' };
  };
  let w = await h.create();
  w = await h.action(w, 'approve');
  assert.equal(w.status, 'completed');
  assert.equal(w.cycle, 1);
  assert.equal(h.fake.testCount, 2);
  assert.deepEqual(
    h.fake.calls.map((c) => c.role),
    ['planner', 'builder', 'reviewer', 'builder', 'reviewer'],
  );
  assert.equal(w.events.filter((e) => e.kind === 'correction').length, 1);
});

test('Team permission mutations are idempotent and reconcile without sending another prompt', async (t) => {
  const h = await setup(t);
  h.fake.nextRecovery = { status: 'permission' };
  h.fake.run = async (_w, role, prompt, id) => {
    h.fake.calls.push({ role, prompt, id });
    return { status: 'permission' };
  };
  const w = await h.create();
  const replies: unknown[] = [];
  Object.assign(h.fake, {
    respondPermission: async (_w: Workflow, id: string, behavior: string) => {
      replies.push({ id, behavior });
      h.fake.nextRecovery = { status: 'idle', text: JSON.stringify(plan) };
    },
  });
  const input = {
    id: w.id,
    workspaceId: w.workspaceId,
    expectedRevision: w.revision,
    requestId: 'permission-answer',
    action: 'permission' as const,
    permissionId: 'native-id',
    behavior: 'allow' as const,
  };
  await assert.rejects(h.engine.action({ ...input, workspaceId: 'foreign' }), /Workspace access denied/);
  await h.engine.action(input);
  await h.engine.settle();
  await h.engine.action(input);
  await h.engine.settle();
  assert.deepEqual(replies, [{ id: 'native-id', behavior: 'allow' }]);
  assert.equal((await h.store.get(w.id)).status, 'awaiting_plan');
  assert.equal(h.fake.calls.length, 1);
});

test('completion receipt preserves explicit restart recovery until Resume', async (t) => {
  const h = await setup(t);
  h.fake.run = async (_w, role, prompt, id) => {
    h.fake.calls.push({ role, prompt, id });
    return { status: 'permission' };
  };
  h.fake.nextRecovery = { status: 'permission' };
  const w = await h.create();
  const timeline = [
    { type: 'user_message', text: `[agent-teams-operation:${w.operation!.id}]` },
    { type: 'assistant_message', text: JSON.stringify(plan) },
  ];
  const restarted = new Engine(h.store, h.fake);
  t.after(() => restarted.close());
  await restarted.receipt(w.agents.planner!, { status: 'idle' }, timeline);
  await restarted.settle();
  assert.equal((await h.store.get(w.id)).status, 'permission');
  // The explicit Resume is still required after a restart, even when a receipt exists.
  h.fake.nextRecovery = { status: 'idle', text: JSON.stringify(plan) };
  const resumed = await h.action(await h.store.get(w.id), 'resume');
  assert.equal(resumed.status, 'awaiting_plan');
  assert.equal(h.fake.calls.length, 1);
});

test('completion receipt wakes a permission-blocked workflow observed by this engine', async (t) => {
  const h = await setup(t);
  h.fake.nextRecovery = { status: 'permission' };
  h.fake.run = async (_w, role, prompt, id) => {
    h.fake.calls.push({ role, prompt, id });
    return { status: 'permission' };
  };
  const w = await h.create();
  h.fake.nextRecovery = { status: 'idle', text: JSON.stringify(plan) };
  await h.engine.receipt(w.agents.planner!, { status: 'idle' }, [
    { type: 'user_message', text: `[agent-teams-operation:${w.operation!.id}]` },
    { type: 'assistant_message', text: JSON.stringify(plan) },
  ]);
  await h.engine.settle();
  assert.equal((await h.store.get(w.id)).status, 'awaiting_plan');
  assert.equal(h.fake.calls.length, 1);
});

test('completion arriving during permission reconciliation cannot be overwritten by a stale permission outcome', async (t) => {
  const h = await setup(t);
  h.fake.run = async (_w, role, prompt, id) => {
    h.fake.calls.push({ role, prompt, id });
    return { status: 'permission' };
  };
  let first = true;
  h.fake.reconcile = async (w?: Workflow) => {
    if (!first) return { status: 'idle', text: JSON.stringify(plan) };
    first = false;
    await h.engine.receipt(w!.agents.planner!, { status: 'idle' }, [
      { type: 'user_message', text: `[agent-teams-operation:${w!.operation!.id}]` },
      { type: 'assistant_message', text: JSON.stringify(plan) },
    ]);
    return { status: 'permission' };
  };
  // Fake normally takes no arguments, but the Runtime contract supplies the saved workflow.
  const w = await h.create();
  assert.equal(w.status, 'awaiting_plan');
  assert.equal(h.fake.calls.length, 1);
});

test('permission hook auto-accepts Builder tools but never does so for a paused workflow', async (t) => {
  const h = await setup(t, { mode: 'manual', builderAutoAccept: true });
  let w = await h.create();
  h.fake.nextRecovery = { status: 'permission' };
  h.fake.run = async (_w, role, prompt, id) => {
    h.fake.calls.push({ role, prompt, id });
    return { status: 'permission' };
  };
  w = await h.action(w, 'handoff', { role: 'builder' });
  assert.equal(w.status, 'permission');
  let approvals = 0;
  Object.assign(h.fake, {
    autoApprove: async () => {
      approvals++;
      h.fake.nextRecovery = { status: 'idle', text: 'Built' };
      return true;
    },
  });
  await h.engine.permission(w.agents.builder!);
  await h.engine.settle();
  w = await h.store.get(w.id);
  assert.equal(approvals, 1);
  assert.equal(w.status, 'paused');
  // Keep an attached turn while explicitly paused to exercise late native hooks.
  w.operation = {
    id: 'paused-operation',
    role: 'builder',
    phase: 'manual',
    state: 'prepared',
    startedAt: new Date().toISOString(),
  };
  await h.store.put(w);
  await h.engine.permission(w.agents.builder!);
  assert.equal(approvals, 1);
  assert.equal((await h.store.get(w.id)).status, 'paused');
});

test('exhausted workflows can extend their budget repeatedly while preserving evidence and sessions', async (t) => {
  const h = await setup(t, { maxCorrections: 1 });
  h.fake.responses.reviewer = Array(8).fill(JSON.stringify(fail));
  let w = await h.create();
  w = await h.action(w, 'approve');
  assert.equal(w.status, 'attention');
  assert.equal(w.cycle, 1);
  const original = { ...w.agents },
    baseline = w.baseline;
  for (let n = 0; n < 2; n++) {
    const prior: number = w.cycle;
    w = await h.action(w, 'continue', { role: 'builder', extraCorrections: 2 });
    assert.equal(w.status, 'attention');
    assert.equal(w.cycle, prior + 2);
    assert.equal(w.config.maxCorrections, prior + 2);
    assert.deepEqual(w.agents, original);
    assert.equal(w.baseline, baseline);
  }
  assert.equal(w.events.filter((e) => e.kind === 'continued').length, 2);
});

test('returning to Planner retains failed review context and requires approval of its new plan', async (t) => {
  const h = await setup(t, { maxCorrections: 0 });
  h.fake.responses.reviewer = [JSON.stringify(fail)];
  let w = await h.create();
  w = await h.action(w, 'approve');
  const before = h.fake.calls.length;
  w = await h.action(w, 'continue', { role: 'planner', extraCorrections: 3, message: 'Revise the approach' });
  assert.equal(w.status, 'awaiting_plan');
  assert.equal(w.testsApproved, false);
  assert.equal(w.config.maxCorrections, 3);
  assert.equal(h.fake.calls.length, before + 1);
  assert.match(h.fake.calls.at(-1)!.prompt, /Missing state verification/);
  assert.match(h.fake.calls.at(-1)!.prompt, /Revise the approach/);
});

test('hot reconfiguration replaces only the chosen session, persists generation and does not dispatch until continued', async (t) => {
  const h = await setup(t, { maxCorrections: 0 });
  h.fake.responses.reviewer = [JSON.stringify(fail)];
  let w = await h.create();
  w = await h.action(w, 'approve');
  const before = h.fake.calls.length,
    previous = { ...w.agents };
  const input = {
    id: w.id,
    workspaceId: w.workspaceId,
    expectedRevision: w.revision,
    requestId: 'change-reviewer',
    action: 'reconfigure' as const,
    role: 'reviewer' as const,
    selection: { provider: 'codex/another-detected-model', modeId: 'read-only' },
  };
  await h.engine.action(input);
  await h.engine.action(input);
  await h.engine.settle();
  w = await h.store.get(w.id);
  assert.equal(w.status, 'attention');
  assert.equal(h.fake.calls.length, before);
  assert.equal(w.agentGenerations?.reviewer, 1);
  assert.equal(w.agents.reviewer, undefined);
  assert.equal(w.agents.builder, previous.builder);
  assert.equal(w.agents.planner, previous.planner);
  assert.match(w.events.find((e) => e.kind === 'reconfigured')!.text, new RegExp(previous.reviewer!));
  assert.equal((await new Store(h.store.directory).get(w.id)).agentGenerations?.reviewer, 1);
  w = await h.action(w, 'continue', { role: 'reviewer', extraCorrections: 1 });
  assert.equal(w.status, 'completed');
  assert.equal(h.fake.calls.at(-1)!.role, 'reviewer');
  assert.equal(h.fake.creationCount, 4);
});

test('continuation cannot bypass checkpoints or abandon an ambiguous accepted operation', async (t) => {
  const h = await setup(t);
  let w = await h.create();
  await assert.rejects(h.action(w, 'continue', { role: 'builder' }), /Pause and wait/);
  await assert.rejects(
    h.action(w, 'reconfigure', { role: 'builder', selection: h.config.roles.builder }),
    /Pause and wait/,
  );
  w = await h.action(w, 'pause');
  await assert.rejects(h.action(w, 'continue', { role: 'builder' }), /Approve the plan/);
  h.fake.lost = true;
  w = await h.action(w, 'continue', { role: 'planner' });
  assert.equal(w.status, 'attention');
  assert.ok(w.operation);
  await assert.rejects(h.action(w, 'continue', { role: 'planner' }), /Reconcile any retained operation/);
});

test('completed workflow messages reach the selected role once without restarting the pipeline', async (t) => {
  const h = await setup(t);
  let w = await h.create();
  w = await h.action(w, 'approve');
  const before = h.fake.calls.length,
    tests = h.fake.testCount,
    review = w.review;
  h.fake.responses.reviewer = ['Voici les prochaines étapes.'];
  const input = {
    id: w.id,
    workspaceId: w.workspaceId,
    expectedRevision: w.revision,
    requestId: 'terminal-question',
    action: 'followup' as const,
    role: 'reviewer' as const,
    message: 'Que reste-t-il à faire ?',
  };
  await h.engine.action(input);
  await h.engine.settle();
  await h.engine.action(input);
  await h.engine.settle();
  w = await h.store.get(w.id);
  assert.equal(w.status, 'completed');
  assert.equal(w.phase, 'done');
  assert.equal(w.followupResult, 'Voici les prochaines étapes.');
  assert.deepEqual(w.review, review);
  assert.equal(h.fake.calls.length, before + 1);
  assert.equal(h.fake.calls.at(-1)!.role, 'reviewer');
  assert.match(h.fake.calls.at(-1)!.prompt, /not a new implementation/);
  assert.match(h.fake.calls.at(-1)!.prompt, /Que reste/);
  assert.equal(h.fake.testCount, tests);
});

test('a follow-up at plan approval preserves the human checkpoint', async (t) => {
  const h = await setup(t);
  let w = await h.create();
  h.fake.responses.planner = ['Explication du plan.'];
  w = await h.action(w, 'followup', { role: 'planner', message: 'Explique ce choix' });
  assert.equal(w.status, 'awaiting_plan');
  assert.equal(w.testsApproved, false);
  assert.equal(w.followupResult, 'Explication du plan.');
  assert.equal(h.fake.calls.length, 2);
});

test('PR requests use the Builder with explicit draft instructions and require current successful validation', async (t) => {
  const h = await setup(t);
  let w = await h.create();
  await assert.rejects(
    h.action(w, 'followup', { purpose: 'pull_request', message: 'Créer une PR' }),
    /still match a successfully validated/,
  );
  w = await h.action(w, 'approve');
  const before = h.fake.calls.length;
  h.fake.responses.builder = ['PR brouillon : https://github.com/example/project/pull/1'];
  w = await h.action(w, 'followup', { purpose: 'pull_request', message: 'Créer une PR' });
  assert.equal(w.status, 'completed');
  assert.equal(h.fake.calls.length, before + 1);
  assert.equal(h.fake.calls.at(-1)!.role, 'builder');
  assert.match(h.fake.calls.at(-1)!.prompt, /draft pull request/);
  assert.match(h.fake.calls.at(-1)!.prompt, /Never invent a PR URL/);
  h.fake.fingerprint = async () => 'changed-after-validation';
  await assert.rejects(
    h.action(w, 'followup', { purpose: 'pull_request', message: 'Créer une PR' }),
    /still match a successfully validated/,
  );
  assert.equal(h.fake.calls.length, before + 1);
});

test('completed follow-up cannot reopen a repository held by another workflow', async (t) => {
  const h = await setup(t);
  let w = await h.create();
  w = await h.action(w, 'approve');
  const other = await h.engine.create('workspace', 'Another task', h.config, 'other-create');
  await h.engine.settle();
  await assert.rejects(h.action(w, 'followup', { message: 'Que faire ensuite ?' }), new RegExp(other.id));
  assert.equal((await h.store.get(w.id)).status, 'completed');
});

test('a lost follow-up response is reconciled without sending twice', async (t) => {
  const h = await setup(t);
  let w = await h.create();
  w = await h.action(w, 'approve');
  h.fake.lost = true;
  w = await h.action(w, 'followup', { message: 'Étapes suivantes ?' });
  const before = h.fake.calls.length;
  assert.equal(w.status, 'attention');
  assert.equal(w.phase, 'followup');
  assert.ok(w.operation);
  h.fake.nextRecovery = { status: 'idle', text: 'Réponse récupérée.' };
  w = await h.action(w, 'resume');
  assert.equal(w.status, 'completed');
  assert.equal(w.followupResult, 'Réponse récupérée.');
  assert.equal(h.fake.calls.length, before);
});

test('a pause during an explanatory follow-up preserves the pending plan approval', async (t) => {
  const h = await setup(t);
  let w = await h.create();
  let release!: () => void;
  h.fake.gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = await h.engine.action({
    id: w.id,
    expectedRevision: w.revision,
    requestId: 'explain-and-pause',
    action: 'followup',
    message: 'Explain the plan',
  });
  while (h.fake.calls.length < 2) await new Promise((r) => setTimeout(r, 5));
  await h.engine.action({
    id: started.id,
    expectedRevision: (await h.store.get(w.id)).revision,
    requestId: 'pause-explanation',
    action: 'pause',
  });
  h.fake.gate = undefined;
  release();
  await h.engine.settle();
  w = await h.store.get(w.id);
  assert.equal(w.status, 'paused');
  assert.equal(w.resumeStatus, 'awaiting_plan');
  w = await h.action(w, 'resume');
  assert.equal(w.status, 'awaiting_plan');
  assert.equal(w.testsApproved, false);
});

test('explicit closure cleans up the launch snapshot without deleting working files', async (t) => {
  const { writeFile, access } = await import('node:fs/promises');
  const h = await setup(t);
  const baseline = join(h.store.directory, 'closed.snapshot');
  await writeFile(baseline, 'snapshot');
  h.fake.prepare = async () => ({ cwd: '/repo', repo: '/repo/.git', baseline });
  let w = await h.create();
  w = await h.action(w, 'finish');
  assert.equal(w.status, 'completed');
  await assert.rejects(access(baseline), { code: 'ENOENT' });
});

test('plan versions preserve provenance, human test edits and historical approvals across replanning', async (t) => {
  const h = await setup(t, { maxCorrections: 0 });
  h.fake.responses.reviewer = [JSON.stringify(fail)];
  let w = await h.create();
  assert.equal(w.planVersions?.length, 1);
  assert.equal(w.planVersions![0].agentId, w.agents.planner);
  assert.equal(w.planVersions![0].operationId, h.fake.calls[0].id);
  assert.deepEqual(w.planVersions![0].selection, h.config.roles.planner);
  const original = structuredClone(w.planVersions![0]);
  const tests = [{ command: 'npm run check', timeoutMs: 2000 }];
  w = await h.action(w, 'approve', { tests });
  assert.equal(w.planVersions?.length, 2);
  assert.deepEqual(w.planVersions![0], original);
  assert.deepEqual(w.planVersions![1].plan.tests, tests);
  assert.equal(w.planVersions![1].source, 'human');
  assert.equal(w.planVersions![1].approval?.policy, 'human');
  const approved = structuredClone(w.planVersions![1]);
  assert.equal(w.status, 'attention');
  w = await h.action(w, 'continue', { role: 'planner', message: 'Revise the plan' });
  assert.equal(w.status, 'awaiting_plan');
  assert.equal(w.testsApproved, false);
  assert.equal(w.testedFingerprint, undefined);
  assert.equal(w.planVersions?.length, 3);
  assert.deepEqual(w.planVersions![1], approved);
  assert.equal(w.planVersions![2].approval, undefined);
  const restarted = await new Store(h.store.directory).get(w.id);
  assert.deepEqual(restarted.planVersions, w.planVersions);
  assert.equal(h.fake.calls.filter((c) => c.role === 'builder').length, 1);
});

test('automatic plan approval records the effective launch commands, not the proposed commands', async (t) => {
  const commands = [{ command: 'npm run check', timeoutMs: 2000 }];
  const h = await setup(t, { validation: 'autonomous', testCommands: commands });
  const w = await h.create();
  assert.equal(w.status, 'completed');
  assert.equal(w.planVersions?.length, 1);
  assert.deepEqual(w.planVersions![0].plan.tests, commands);
  assert.equal(w.planVersions![0].approval?.policy, 'configuration');
  assert.deepEqual(w.planVersions![0].plan, w.plan);
});

test('an invalid replacement keeps the recorded plan and approval history without starting another builder', async (t) => {
  const h = await setup(t, { maxCorrections: 0 });
  h.fake.responses.reviewer = [JSON.stringify(fail)];
  let w = await h.create();
  w = await h.action(w, 'approve');
  const history = structuredClone(w.planVersions);
  const approvedPlan = structuredClone(w.plan);
  h.fake.responses.planner = ['not a structured plan', 'not a structured plan', 'not a structured plan'];
  w = await h.action(w, 'continue', { role: 'planner' });
  assert.equal(w.status, 'attention');
  assert.equal(w.testsApproved, false);
  assert.deepEqual(w.planVersions, history);
  assert.deepEqual(w.plan, approvedPlan);
  assert.equal(h.fake.calls.filter((c) => c.role === 'builder').length, 1);
});

test('Reviewer discussions and proposals preserve the approved plan until explicit adoption', async (t) => {
  const h = await setup(t);
  let w = await h.create();
  // Keep a previously approved plan at a safe checkpoint, without starting a Builder.
  w.testsApproved = true;
  w.planVersions![0].approval = { at: 'original', policy: 'human', allowNoTests: false };
  w.testedFingerprint = 'old-validation';
  await h.store.put(w);
  h.fake.responses.reviewer = [
    JSON.stringify({ kind: 'discussion', summary: 'Prefer a dedicated callback?' }),
    JSON.stringify({ kind: 'proposal', summary: 'Dedicated route', plan: { ...plan, tasks: ['Dedicated callback'] } }),
  ];
  w = await h.action(w, 'followup', { purpose: 'plan_revision', message: 'Discuss the callback' });
  assert.equal(w.status, 'awaiting_plan');
  assert.equal(w.testsApproved, true);
  assert.equal(w.planProposal, undefined);
  assert.deepEqual(w.plan, plan);
  w = await h.action(w, 'followup', { purpose: 'plan_revision', message: 'Yes, propose it' });
  assert.match(h.fake.calls.at(-1)!.prompt, /Prefer a dedicated callback/);
  assert.equal(w.planVersions?.length, 1);
  assert.deepEqual(w.plan, plan);
  assert.equal(w.planProposal?.baseVersion, 1);
  const proposal = structuredClone(w.planProposal!);
  const reloaded = new Store(h.store.directory);
  assert.deepEqual((await reloaded.get(w.id)).planProposal, proposal);
  // A model change after proposal must not rewrite its provenance.
  w = await h.action(w, 'pause');
  w = await h.action(w, 'reconfigure', {
    role: 'reviewer',
    selection: { provider: 'codex/other', modeId: 'read-only' },
  });
  w = await h.action(w, 'adopt_plan');
  assert.equal(w.status, 'paused');
  assert.equal(w.resumeStatus, 'awaiting_plan');
  assert.equal(w.testsApproved, false);
  assert.equal(w.testedFingerprint, undefined);
  assert.equal(w.planProposal, undefined);
  assert.deepEqual(w.plan?.tasks, ['Dedicated callback']);
  assert.equal(w.planVersions?.length, 2);
  assert.equal(w.planVersions![0].approval?.at, 'original');
  assert.equal(w.planVersions![1].source, 'reviewer');
  assert.equal(w.planVersions![1].agentId, proposal.agentId);
  assert.deepEqual(w.planVersions![1].selection, proposal.selection);
  assert.equal(w.planVersions![1].operationId, proposal.operationId);
  assert.equal(h.fake.calls.filter((c) => c.role === 'builder').length, 0);
  w = await h.action(w, 'resume');
  assert.equal(w.status, 'awaiting_plan');
  w = await h.action(w, 'approve');
  assert.equal(w.status, 'completed');
});

test('invalid Reviewer proposals never mutate or approve the current plan', async (t) => {
  for (const text of [
    'not JSON',
    JSON.stringify({ kind: 'proposal', summary: 'Incomplete', plan: {} }),
    JSON.stringify(pass),
  ]) {
    const h = await setup(t);
    let w = await h.create();
    h.fake.responses.reviewer = [text];
    w = await h.action(w, 'followup', { purpose: 'plan_revision', message: 'Revise' });
    assert.equal(w.status, 'awaiting_plan');
    assert.match(w.error!, /Invalid plan revision/);
    assert.equal(w.planProposal, undefined);
    assert.equal(w.testsApproved, false);
    assert.deepEqual(w.plan, plan);
    await assert.rejects(h.action(w, 'adopt_plan'), /No current Reviewer proposal/);
    assert.equal(h.fake.calls.filter((c) => c.role === 'builder').length, 0);
  }
});

test('plan proposal adoption is idempotent, rejects stale clients and applies configured validation policies', async (t) => {
  for (const validation of ['plan', 'final', 'autonomous'] as const) {
    const h = await setup(t, { validation, testCommands: validation === 'plan' ? [] : plan.tests });
    let w = await h.create();
    // final/autonomous complete normally first; restore a live paused checkpoint for this test.
    w.status = 'paused';
    w.phase = 'building';
    await h.store.put(w);
    h.fake.responses.reviewer = [
      JSON.stringify({ kind: 'proposal', summary: 'Revised', plan: { ...plan, summary: 'Revised plan' } }),
    ];
    w = await h.action(w, 'followup', { purpose: 'plan_revision', message: 'Revise' });
    const input = { id: w.id, expectedRevision: w.revision, requestId: 'adoption', action: 'adopt_plan' as const };
    const results = await Promise.allSettled([
      h.engine.action(input),
      h.engine.action(input),
      h.engine.action({ ...input, requestId: 'stale-client' }),
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'fulfilled');
    assert.equal(results[2].status, 'rejected');
    await h.engine.settle();
    w = await h.store.get(w.id);
    assert.equal(w.status, 'paused');
    assert.equal(w.planVersions?.length, 2);
    assert.equal(w.planVersions![1].approval?.policy, validation === 'plan' ? undefined : 'configuration');
    assert.equal(w.resumeStatus, validation === 'plan' ? 'awaiting_plan' : 'ready');
    assert.equal(w.events.filter((e) => e.kind === 'plan_adopted').length, 1);
  }
});

test('a plan change invalidates a pending Reviewer proposal', async (t) => {
  const h = await setup(t);
  let w = await h.create();
  h.fake.responses.reviewer = [JSON.stringify({ kind: 'proposal', summary: 'Proposal', plan })];
  w = await h.action(w, 'followup', { purpose: 'plan_revision', message: 'Revise' });
  assert.ok(w.planProposal);
  w = await h.action(w, 'message', { message: 'New requirement for the Planner' });
  assert.equal(w.planVersions?.length, 2);
  assert.equal(w.planProposal, undefined);
  await assert.rejects(h.action(w, 'adopt_plan'), /No current Reviewer proposal/);
});

test('Reviewer revision survives pause and restart with native reconciliation and no second send', async (t) => {
  const h = await setup(t);
  let w = await h.create();
  let release!: () => void;
  h.fake.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const response = JSON.stringify({
    kind: 'proposal',
    summary: 'Native proposal',
    plan: { ...plan, summary: 'Native plan' },
  });
  h.fake.responses.reviewer = [response];
  await h.engine.action({
    id: w.id,
    expectedRevision: w.revision,
    requestId: 'native-revision',
    action: 'followup',
    purpose: 'plan_revision',
    message: 'Revise via native thread',
  });
  for (let i = 0; i < 100 && h.fake.calls.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 2));
  w = await h.store.get(w.id);
  assert.equal(w.operation?.role, 'reviewer');
  await assert.rejects(
    h.engine.action({
      id: w.id,
      expectedRevision: w.revision,
      requestId: 'second-turn',
      action: 'followup',
      purpose: 'plan_revision',
      message: 'Too soon',
    }),
    /Wait for the current turn/,
  );
  await h.engine.action({ id: w.id, expectedRevision: w.revision, requestId: 'pause-native', action: 'pause' });
  h.engine.close();
  release();
  await h.engine.settle();
  const store = new Store(h.store.directory);
  const resumed = new Engine(store, h.fake);
  t.after(() => resumed.close());
  w = await store.get(w.id);
  assert.ok(w.operation);
  h.fake.nextRecovery = { status: 'idle', text: response };
  await resumed.action({ id: w.id, expectedRevision: w.revision, requestId: 'resume-native', action: 'resume' });
  await resumed.settle();
  w = await store.get(w.id);
  assert.equal(h.fake.calls.length, 2);
  assert.equal(h.fake.recoveryCount, 1);
  assert.equal(w.planProposal?.plan.summary, 'Native plan');
  assert.equal(w.plan?.summary, plan.summary);
  assert.equal(w.status, 'awaiting_plan');
});

test('Reviewer revision detects repository edits even in native read-only modes', async (t) => {
  const h = await setup(t);
  let w = await h.create();
  let fingerprints = 0;
  h.fake.fingerprint = async () => (++fingerprints === 1 ? 'before' : 'after');
  h.fake.responses.reviewer = [JSON.stringify({ kind: 'proposal', summary: 'Proposal', plan })];
  w = await h.action(w, 'followup', { purpose: 'plan_revision', message: 'Revise' });
  assert.equal(w.status, 'attention');
  assert.match(w.error!, /Repository changed during a read-only turn/);
  assert.ok(w.operation);
  assert.equal(w.planProposal, undefined);
  assert.deepEqual(w.plan, plan);
});

test('one multi-repository workflow locks every target atomically and releases them together', async (t) => {
  const h = await setup(t);
  h.fake.prepare = async () => ({
    cwd: '/parent',
    repo: '/a/.git',
    baseline: '/unused-baseline',
    repositoryTargets: [
      { root: '/a', lock: '/a/.git' },
      { root: '/b', lock: '/b/.git' },
    ],
  });
  let first = await h.create();
  assert.equal(first.repositoryTargets?.length, 2);
  h.fake.prepare = async () => ({
    cwd: '/other',
    repo: '/c/.git',
    baseline: '/unused-baseline',
    repositoryTargets: [
      { root: '/c', lock: '/c/.git' },
      { root: '/b', lock: '/b/.git' },
    ],
  });
  await assert.rejects(h.engine.create('other', 'Second task', h.config, 'second-create'), /Another workflow holds/);
  first = await h.action(first, 'finish');
  const second = await h.engine.create('other', 'Second task', h.config, 'second-create');
  await h.engine.settle();
  assert.ok(second.id !== first.id);
  await assert.rejects(h.action(first, 'followup', { message: 'Next steps?' }), /Another workflow holds/);
  assert.match(h.fake.calls[0].prompt, /Allowed Git repositories/);
  assert.match(h.fake.calls[0].prompt, /\/b/);
  assert.match(h.fake.calls[0].prompt, /coordination directory/);
});

test('overlapping creation checks locks before snapshots while retaining atomic acquisition', async (t) => {
  const h = await setup(t);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captures = 0;
  h.fake.prepare = async (workspace?: string, _config?: Config, check?: CheckScope) => {
    const scope = {
      cwd: '/parent',
      repo: workspace === 'other' ? '/c/.git' : '/a/.git',
      repositoryTargets: [
        { root: workspace === 'other' ? '/c' : '/a', lock: workspace === 'other' ? '/c/.git' : '/a/.git' },
        { root: '/b', lock: '/b/.git' },
      ],
    };
    await check?.(scope);
    captures++;
    await gate;
    return { ...scope, baseline: '/unused-baseline' };
  };
  const first = h.engine.create('workspace', 'First', h.config, 'atomic-first');
  while (captures < 1) await new Promise((resolve) => setTimeout(resolve, 5));
  const second = h.engine.create('other', 'Second', h.config, 'atomic-second');
  release();
  const results = await Promise.allSettled([first, second]);
  await h.engine.settle();
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(captures, 1);
  if (results[1].status === 'rejected') assert.match(String(results[1].reason), /Another workflow holds/);
});

test('goal execution replans after correction failures and completes without another manual approval', async (t) => {
  const h = await setup(t, { goalMode: true, maxCorrections: 1, goalMaxTurns: 12 });
  h.fake.responses.reviewer = [JSON.stringify(fail), JSON.stringify(pass)];
  let w = await h.create();
  assert.equal(w.status, 'awaiting_plan');
  w = await h.action(w, 'approve');
  assert.equal(w.status, 'completed');
  assert.equal(w.goal?.replans, 1);
  assert.equal(w.goal?.turns, 6);
  assert.deepEqual(
    h.fake.calls.map((c) => c.role),
    ['planner', 'builder', 'reviewer', 'planner', 'builder', 'reviewer'],
  );
  assert.equal(w.planVersions?.length, 2);
  assert.equal(w.planVersions?.[1].approval?.policy, 'configuration');
  assert.match(h.fake.calls[3].prompt, /Missing state verification/);
  assert.equal(w.agentGenerations?.reviewer, 1);
});

test('goal execution repairs verification commands, runs them and reviews independently', async (t) => {
  const h = await setup(t, { goalMode: true, validation: 'autonomous' });
  const corrected = [{ command: 'node --test tests/real.test.js', timeoutMs: 1000 }];
  h.fake.responses.builder = [JSON.stringify({ ...build, tests: corrected })];
  const w = await h.create();
  assert.equal(w.status, 'completed');
  assert.deepEqual(
    w.tests.map((t) => t.command),
    corrected.map((t) => t.command),
  );
  assert.equal(w.planVersions?.at(-1)?.source, 'builder');
  assert.match(h.fake.calls.at(-1)!.prompt, /Verified working artifact fingerprint: snapshot-fingerprint/);
});

test('goal execution sends failing verification back for diagnosis before spending a Reviewer turn', async (t) => {
  const h = await setup(t, { goalMode: true, validation: 'autonomous', maxCorrections: 1 });
  const successful = h.fake.tests.bind(h.fake);
  let calls = 0;
  h.fake.tests = async (w) =>
    (await successful(w)).map((r) => ({ ...r, exitCode: ++calls === 1 ? 1 : 0, stderr: 'bad verification path' }));
  const w = await h.create();
  assert.equal(w.status, 'completed');
  assert.equal(h.fake.calls.filter((c) => c.role === 'reviewer').length, 1);
  assert.match(h.fake.calls.filter((c) => c.role === 'planner')[1].prompt, /bad verification path/);
});

test('goal execution respects its total turn budget instead of looping forever', async (t) => {
  const h = await setup(t, { goalMode: true, validation: 'autonomous', maxCorrections: 1, goalMaxTurns: 5 });
  h.fake.responses.reviewer = Array(5).fill(JSON.stringify(fail));
  const w = await h.create();
  assert.equal(w.status, 'attention');
  assert.equal(h.fake.calls.length, 5);
  assert.match(w.error!, /Budget/);
  assert.equal(w.operation, undefined);
});

test('completed malformed reports get a formatting-only repair instead of reimplementing', async (t) => {
  const h = await setup(t);
  h.fake.responses.builder = ['Implementation is complete but report is not JSON', JSON.stringify(build)];
  let w = await h.create();
  w = await h.action(w, 'approve');
  assert.equal(w.status, 'completed');
  assert.equal(w.cycle, 0);
  assert.equal(h.fake.testCount, 1);
  const repairs = h.fake.calls.filter((c) => c.prompt.includes('Repair only the report format'));
  assert.equal(repairs.length, 1);
  assert.match(repairs[0].prompt, /Do not use tools/);
  assert.equal(w.resultRepair, undefined);
});

test('a paused legacy workflow can explicitly opt into goal execution with a fresh budget', async (t) => {
  const h = await setup(t, { maxCorrections: 0 });
  h.fake.responses.reviewer = [JSON.stringify(fail), JSON.stringify(pass)];
  let w = await h.create();
  w = await h.action(w, 'approve');
  assert.equal(w.status, 'attention');
  w = await h.action(w, 'start_goal');
  assert.equal(w.status, 'completed');
  assert.equal(w.config.goalMode, true);
  assert.equal(w.config.recovery, 'automatic');
});

test('goal time budget retains an active operation without replaying it', async (t) => {
  const h = await setup(t, { goalMode: true, validation: 'autonomous', goalTimeBudgetMs: 60000 });
  h.fake.run = async (_w, role, prompt, id) => {
    h.fake.calls.push({ role, prompt, id });
    const stored = (await h.store.all())[0];
    stored.goal!.startedAt = new Date(Date.now() - 60001).toISOString();
    await h.store.put(stored);
    return { status: 'timeout' };
  };
  const w = await h.create();
  assert.equal(w.status, 'attention');
  assert.ok(w.operation);
  assert.equal(h.fake.calls.length, 1);
  assert.equal(h.fake.recoveryCount, 0);
});

test('goal reconnect reconciles the saved operation without resending a lost accepted prompt', async (t) => {
  const h = await setup(t, { goalMode: true, recovery: 'automatic' });
  h.fake.lost = true;
  let w = await h.create();
  assert.equal(w.status, 'running');
  const operationId = w.operation?.id;
  h.fake.nextRecovery = { status: 'idle', text: JSON.stringify(plan) };
  await h.engine.recoverAutomatic();
  await h.engine.settle();
  w = await h.store.get(w.id);
  assert.equal(w.status, 'awaiting_plan');
  assert.equal(h.fake.calls.length, 1);
  assert.equal(h.fake.calls[0].id, operationId);
  assert.equal(h.fake.recoveryCount, 1);
});

test('an exhausted goal can explicitly renew its budget and finish without discarding prior evidence', async (t) => {
  const h = await setup(t, { goalMode: true, validation: 'autonomous', maxCorrections: 1, goalMaxTurns: 3 });
  h.fake.responses.reviewer = [JSON.stringify(fail), JSON.stringify(pass)];
  let w = await h.create();
  assert.equal(w.status, 'attention');
  const previousEvents = w.events.length;
  w = await h.action(w, 'start_goal');
  assert.equal(w.status, 'completed');
  assert.equal(w.goal?.turns, 3);
  assert.ok(w.events.length > previousEvents);
  assert.equal(w.planVersions?.filter((v) => v.approval).length, 2);
});

test('goal command evolution preserves explicit launch verification commands', async (t) => {
  const h = await setup(t, {
    goalMode: true,
    validation: 'autonomous',
    testCommands: [{ command: 'trusted-behavior-check', timeoutMs: 1000 }],
  });
  h.fake.responses.builder = [JSON.stringify({ ...build, tests: [{ command: 'echo success', timeoutMs: 1000 }] })];
  const w = await h.create();
  assert.equal(w.status, 'completed');
  assert.deepEqual(
    w.tests.map((t) => t.command),
    ['trusted-behavior-check'],
  );
  assert.equal(w.planVersions?.length, 1);
});

test('starting goal execution recovers a legacy rejected fenced Builder report for Planner diagnosis', async (t) => {
  const h = await setup(t, { maxCorrections: 0 });
  h.fake.responses.reviewer = [JSON.stringify(fail), JSON.stringify(pass)];
  let w = await h.create();
  w = await h.action(w, 'approve');
  w.events.push({
    id: 'legacy-invalid-reply',
    at: new Date().toISOString(),
    kind: 'assistant',
    role: 'builder',
    text:
      'Latest fixes are done.\n```json\n' +
      JSON.stringify({ ...build, remaining: ['Only the real integration check remains'] }) +
      '\n```',
  });
  await h.store.put(w);
  w = await h.action(w, 'start_goal');
  assert.equal(w.status, 'completed');
  assert.match(h.fake.calls.filter((c) => c.role === 'planner')[1].prompt, /Only the real integration check remains/);
});

test('native Reviewer proposals retain cursor provenance, require adoption and survive reload without reimport', async (t) => {
  const h = await setup(t);
  let w = await h.create();
  w.agents.reviewer = 'native-reviewer';
  await h.store.put(w);
  const original = structuredClone(w.plan);
  const version = w.planVersions!.at(-1)!.version;
  const revised = { ...plan, summary: 'Native revision' };
  const source = { epoch: 'native', seq: 42, turnId: 'native-turn' };
  h.fake.reviewerPlan = async () => ({
    source,
    prompt: 'Native user decision',
    text: JSON.stringify({
      workflowId: w.id,
      baseVersion: version,
      kind: 'proposal',
      summary: 'Native decision',
      plan: revised,
    }),
  });
  const calls = h.fake.calls.length;
  w = await h.action(w, 'import_reviewer_plan');
  assert.deepEqual(w.plan, original);
  assert.equal(w.testsApproved, false);
  assert.deepEqual(w.planProposal?.nativeSource, source);
  assert.equal(w.planProposal?.selection, undefined);
  const loaded = await new Store(h.store.directory).get(w.id);
  assert.deepEqual(loaded.planProposal, w.planProposal);
  w = await h.action(loaded, 'import_reviewer_plan');
  assert.equal(w.events.filter((e) => e.kind === 'native_plan_imported').length, 1);
  assert.equal(h.fake.calls.length, calls);
  w = await h.action(w, 'adopt_plan');
  assert.equal(w.plan?.summary, 'Native revision');
  assert.equal(w.status, 'awaiting_plan');
  assert.equal(w.testsApproved, false);
  assert.deepEqual(w.planVersions!.at(-1)!.nativeSource, source);
  assert.equal(w.planVersions!.at(-1)!.selection, undefined);
});

test('native Reviewer import rejects stale, foreign and invalid responses without losing a pending proposal', async (t) => {
  const h = await setup(t);
  let w = await h.create();
  w.agents.reviewer = 'native-reviewer';
  await h.store.put(w);
  const source = { epoch: 'native', seq: 42, turnId: 'turn' };
  const envelope = { workflowId: w.id, baseVersion: 1, kind: 'proposal', summary: 'Ready', plan };
  h.fake.reviewerPlan = async () => ({ source, prompt: 'Native user decision', text: JSON.stringify(envelope) });
  w = await h.action(w, 'import_reviewer_plan');
  const proposal = structuredClone(w.planProposal);
  for (const invalid of [
    { ...envelope, baseVersion: 0 },
    { ...envelope, workflowId: 'other' },
    { ...envelope, plan: {} },
    { kind: 'discussion', summary: 'Missing context' },
  ]) {
    h.fake.reviewerPlan = async () => ({ source, prompt: 'Native user decision', text: JSON.stringify(invalid) });
    await assert.rejects(h.action(w, 'import_reviewer_plan'));
    assert.deepEqual((await h.store.get(w.id)).planProposal, proposal);
  }
});

test('native import stays paused and rejects a repository or session changing during retrieval', async (t) => {
  const h = await setup(t);
  let w = await h.create();
  w.agents.reviewer = 'native-reviewer';
  w.status = 'paused';
  await h.store.put(w);
  const result = {
    source: { epoch: 'native', seq: 1, turnId: 'turn' },
    prompt: 'Clarify without assuming approval',
    text: JSON.stringify({ workflowId: w.id, baseVersion: 1, kind: 'discussion', summary: 'En attente de décision' }),
  };
  let fingerprint = 'before';
  h.fake.fingerprint = async () => fingerprint;
  h.fake.reviewerPlan = async () => {
    fingerprint = 'after';
    return result;
  };
  await assert.rejects(h.action(w, 'import_reviewer_plan'), /changed during import/);
  assert.equal(
    (await h.store.get(w.id)).events.some((e) => e.kind === 'native_plan_imported'),
    false,
  );
  h.fake.reviewerPlan = async () => result;
  let checks = 0;
  h.fake.canClose = async () => ++checks === 1;
  await assert.rejects(h.action(w, 'import_reviewer_plan'), /changed during import/);
  h.fake.canClose = async () => true;
  let reads = 0;
  h.fake.reviewerPlan = async () => ({ ...result, source: { ...result.source, seq: ++reads } });
  await assert.rejects(h.action(w, 'import_reviewer_plan'), /reply changed during import/);
  h.fake.reviewerPlan = async () => result;
  const calls = h.fake.calls.length;
  w = await h.action(w, 'import_reviewer_plan');
  assert.equal(w.status, 'paused');
  assert.equal(w.planVersions!.length, 1);
  assert.equal(w.planProposal, undefined);
  assert.equal(w.events.filter((e) => e.kind === 'user').at(-1)?.text, result.prompt);
  assert.equal(h.fake.calls.length, calls);
});

const clarification = {
  kind: 'clarification',
  summary: 'Choisir la portée avant de planifier',
  questions: ['scope', 'style'].map((id) => ({
    id,
    title: `Quelle ${id} ?`,
    options: [
      { id: 'small', label: 'Ciblée', tradeoff: 'Moins de changements' },
      { id: 'large', label: 'Complète', tradeoff: 'Plus de couverture et de travail' },
    ],
    recommendedOptionId: 'small',
  })),
};
for (const validation of ['plan', 'final', 'autonomous'] as const) {
  test(`clarifications persist and block every dispatch until all explicit answers (${validation})`, async (t) => {
    const h = await setup(t, { validation, recovery: 'automatic', testCommands: plan.tests });
    h.fake.responses.planner = [JSON.stringify(clarification), JSON.stringify(plan)];
    let w = await h.create();
    assert.equal(w.status, 'attention');
    assert.equal(w.error, 'En attente de réponse');
    assert.equal(w.testsApproved, false);
    const id = w.clarifications![0].id;
    for (const action of ['approve', 'resume', 'continue', 'start_goal', 'message', 'followup'] as const) {
      await assert.rejects(h.action(w, action, { role: 'builder', message: 'silence' }), /En attente de réponse/);
    }
    w = await h.action(w, 'answer_clarification', {
      clarificationId: id,
      answers: [{ questionId: 'scope', optionId: 'small' }],
    });
    assert.equal(w.status, 'attention');
    assert.equal(h.fake.calls.length, 1);
    const restarted = new Engine(new Store(h.store.directory), h.fake);
    t.after(() => restarted.close());
    await restarted.recoverAutomatic();
    await restarted.settle();
    const restored = await restarted.store.get(w.id);
    assert.deepEqual(restored.clarifications, w.clarifications);
    assert.equal(h.fake.calls.length, 1);
    // A duplicate semantic answer does not append another decision.
    w = await h.action(w, 'answer_clarification', {
      clarificationId: id,
      answers: [{ questionId: 'scope', optionId: 'small' }],
    });
    assert.equal(w.clarifications![0].answers.length, 1);
    await assert.rejects(
      h.action(w, 'answer_clarification', {
        clarificationId: id,
        answers: [{ questionId: 'scope', optionId: 'large' }],
      }),
      /silently overwritten/,
    );
    await assert.rejects(
      h.action(w, 'answer_clarification', {
        clarificationId: id,
        answers: [{ questionId: 'style', optionId: 'unknown' }],
      }),
      /Unknown question/,
    );
    w = await h.action(w, 'answer_clarification', {
      clarificationId: id,
      answers: [{ questionId: 'style', text: 'Je préfère conserver le style actuel' }],
    });
    assert.ok(w.clarifications![0].resolvedAt);
    assert.ok(h.fake.calls[1].prompt.includes('Je préfère conserver le style actuel'));
    assert.equal(h.fake.calls[1].role, 'planner');
    if (validation === 'plan') {
      assert.equal(w.status, 'awaiting_plan');
      assert.equal(h.fake.calls.length, 2);
      assert.equal(w.testsApproved, false);
    } else {
      assert.equal(w.status, validation === 'final' ? 'awaiting_final' : 'completed');
      assert.deepEqual(
        h.fake.calls.map((c) => c.role),
        ['planner', 'planner', 'builder', 'reviewer'],
      );
    }
  });
}
test('paused clarification accepts later answers without dispatch, and concurrent answers are serialized', async (t) => {
  const h = await setup(t);
  h.fake.responses.planner = [JSON.stringify(clarification)];
  let w = await h.create();
  w = await h.action(w, 'pause');
  const input = {
    id: w.id,
    expectedRevision: w.revision,
    action: 'answer_clarification' as const,
    clarificationId: w.clarifications![0].id,
    answers: [
      { questionId: 'scope', text: 'Refus des choix proposés : documentation seule' },
      { questionId: 'style', optionId: 'small' },
    ],
  };
  const results = await Promise.allSettled(['one', 'two'].map((requestId) => h.engine.action({ ...input, requestId })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  await h.engine.settle();
  w = await h.store.get(w.id);
  assert.equal(w.status, 'paused');
  assert.equal(w.resumeStatus, 'ready');
  assert.equal(h.fake.calls.length, 1);
  assert.equal(w.clarifications![0].answers.length, 2);
  w = await h.action(w, 'resume');
  assert.equal(w.status, 'awaiting_plan');
  assert.equal(h.fake.calls.length, 2);
});
test('goal replanning cannot reuse a prior plan approval to bypass an unanswered clarification', async (t) => {
  const h = await setup(t, { goalMode: true, validation: 'autonomous', testCommands: plan.tests, maxCorrections: 0 });
  h.fake.responses.planner = [JSON.stringify(plan), JSON.stringify(clarification), JSON.stringify(plan)];
  h.fake.responses.reviewer = [JSON.stringify(fail), JSON.stringify(pass)];
  let w = await h.create();
  assert.equal(w.status, 'attention');
  assert.ok(w.planVersions![0].approval);
  assert.equal(w.testsApproved, false);
  assert.equal(h.fake.calls.filter((c) => c.role === 'builder').length, 1);
  await h.engine.recoverAutomatic();
  await h.engine.settle();
  assert.equal(h.fake.calls.filter((c) => c.role === 'builder').length, 1);
  const extra = {
    clarificationId: w.clarifications![0].id,
    answers: clarification.questions.map((q) => ({ questionId: q.id, optionId: 'small' })),
  };
  h.fake.canClose = async () => false;
  await assert.rejects(h.action(w, 'answer_clarification', extra), /native agent is still active/);
  assert.equal((await h.store.get(w.id)).clarifications![0].answers.length, 0);
  h.fake.canClose = async () => true;
  w = await h.action(w, 'answer_clarification', extra);
  assert.equal(w.status, 'completed');
  assert.equal(h.fake.calls.filter((c) => c.role === 'builder').length, 2);
});

test('oversized decisions stop before dispatch and survive reload and explicit resume', async (t) => {
  const h = await setup(t);
  let w = await h.create();
  const history = Array.from({ length: 10 }, (_, i) => ({
    id: `batch-${i}`,
    at: '2026-10-21T00:00:00Z',
    resolvedAt: '2026-10-21T00:01:00Z',
    request: { ...clarification, kind: 'clarification' as const },
    answers: clarification.questions.map((q) => ({
      questionId: q.id,
      text: 'é'.repeat(7000 / 2),
      at: '2026-10-21T00:01:00Z',
    })),
  }));
  w.clarifications = history;
  await h.store.put(w);
  const calls = h.fake.calls.length;
  const creations = h.fake.creationCount;
  w.agents = {};
  await h.store.put(w);
  w = await h.action(w, 'followup', { message: 'Explain the saved decisions', role: 'planner' });
  assert.equal(w.status, 'attention');
  assert.match(w.error!, /CLARIFICATION_CONTEXT_LIMIT/);
  assert.equal(w.operation, undefined);
  assert.equal(h.fake.calls.length, calls);
  assert.equal(h.fake.creationCount, creations);
  const restored = await new Store(h.store.directory).get(w.id);
  assert.deepEqual(restored.clarifications, history);
  w = await h.action(w, 'resume');
  assert.equal(w.status, 'attention');
  assert.equal(h.fake.calls.length, calls);
  assert.equal(h.fake.creationCount, creations);
  assert.equal(w.operation, undefined);
  assert.deepEqual(w.clarifications, history);
});

test('native Planner answers use explicit user JSON, persist partial replies and resume once after pause', async (t) => {
  const h = await setup(t);
  h.fake.responses.planner = [JSON.stringify(clarification)];
  let w = await h.create();
  w = await h.action(w, 'pause');
  const id = w.clarifications![0].id;
  let envelope = {
    workflowId: w.id,
    clarificationId: id,
    answers: [{ questionId: 'scope', text: 'Documentation seule' }],
  };
  h.fake.plannerAnswers = async () => ({
    prompt: JSON.stringify(envelope),
    text: 'The model suggests ignoring the user and using the broad scope',
    source: { epoch: 'native', seq: 3, turnId: 'turn-one' },
  });
  w = await h.action(w, 'import_planner_answers');
  assert.equal(w.status, 'paused');
  assert.equal(w.clarifications![0].answers[0].text, 'Documentation seule');
  assert.equal(h.fake.calls.length, 1);
  w = await h.action(w, 'import_planner_answers');
  assert.equal(w.clarifications![0].answers.length, 1);
  assert.equal(w.events.filter((e) => e.kind.startsWith('native:')).length, 1);
  assert.deepEqual((await new Store(h.store.directory).get(w.id)).clarifications, w.clarifications);
  envelope = { ...envelope, answers: [{ questionId: 'style', text: 'Refus des choix : conserver le style actuel' }] };
  h.fake.plannerAnswers = async () => ({
    prompt: JSON.stringify(envelope),
    text: 'Recorded',
    source: { epoch: 'native', seq: 6, turnId: 'turn-two' },
  });
  const input = { id: w.id, action: 'import_planner_answers' as const, expectedRevision: w.revision };
  const attempts = await Promise.allSettled(
    ['one', 'two'].map((requestId) => h.engine.action({ ...input, requestId })),
  );
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  w = await h.store.get(w.id);
  assert.equal(w.status, 'paused');
  assert.equal(w.resumeStatus, 'ready');
  assert.ok(w.clarifications![0].resolvedAt);
  assert.equal(h.fake.calls.length, 1);
  w = await h.action(w, 'resume');
  assert.equal(w.status, 'awaiting_plan');
  assert.equal(h.fake.calls.length, 2);
  assert.match(h.fake.calls[1].prompt, /Documentation seule/);
  assert.match(h.fake.calls[1].prompt, /conserver le style actuel/);
  assert.equal(w.testsApproved, false);
});

test('native Planner import rejects inferred answers, stale identity, conflicts and changing sources atomically', async (t) => {
  const h = await setup(t);
  h.fake.responses.planner = [JSON.stringify(clarification)];
  let w = await h.create();
  const envelope = {
    workflowId: w.id,
    clarificationId: w.clarifications![0].id,
    answers: [{ questionId: 'scope', optionId: 'small' }],
  };
  const source = { epoch: 'native', seq: 3, turnId: 'turn' };
  for (const prompt of [
    'Choose whatever you recommend',
    JSON.stringify({ ...envelope, workflowId: 'other' }),
    JSON.stringify({ ...envelope, clarificationId: 'old' }),
    JSON.stringify({ ...envelope, answers: [{ questionId: 'scope', optionId: 'unknown' }] }),
    JSON.stringify({ ...envelope, answers: [...envelope.answers, ...envelope.answers] }),
  ]) {
    h.fake.plannerAnswers = async () => ({ prompt, text: JSON.stringify(envelope), source });
    await assert.rejects(h.action(w, 'import_planner_answers'));
    assert.equal((await h.store.get(w.id)).clarifications![0].answers.length, 0);
    assert.equal((await h.store.get(w.id)).revision, w.revision);
  }
  let reads = 0;
  h.fake.plannerAnswers = async () => ({
    prompt: JSON.stringify(envelope),
    text: 'OK',
    source: { ...source, seq: ++reads },
  });
  await assert.rejects(h.action(w, 'import_planner_answers'), /changed during import/);
  h.fake.plannerAnswers = async () => ({ prompt: JSON.stringify(envelope), text: 'OK', source });
  h.fake.canClose = async () => false;
  await assert.rejects(h.action(w, 'import_planner_answers'), /native agent is still active/);
  h.fake.canClose = async () => true;
  w = await h.action(w, 'answer_clarification', {
    clarificationId: envelope.clarificationId,
    answers: [{ questionId: 'scope', optionId: 'large' }],
  });
  await assert.rejects(h.action(w, 'import_planner_answers'), /silently overwritten/);
  assert.equal(h.fake.calls.length, 1);
  assert.equal(w.events.filter((e) => e.kind.startsWith('native:')).length, 0);
});
