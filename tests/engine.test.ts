import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, type Outcome, type Runtime } from '../server/engine';
import { Store } from '../server/store';
import { configSchema, type Config, type Role, type Workflow } from '../shared/contracts';
import { INSTRUCTION_READ_ONLY } from '../shared/provider-selection';
const plan = { summary: 'Add OAuth2', tasks: ['Implement callback'], acceptance: ['Tests pass'], tests: [{ command: 'npm test', timeoutMs: 1000 }] };
const build = { summary: 'Implemented', changes: ['callback.ts'], remaining: [] };
const pass = { verdict: 'pass', summary: 'Ready', issues: [] };
const fail = { verdict: 'fail', summary: 'Needs correction', issues: ['Missing state verification'] };
const base = () => configSchema.parse({ version: 1, roles: { planner: { provider: 'claude/discovered', modeId: 'plan' }, builder: { provider: 'codex/discovered', modeId: 'auto' }, reviewer: { provider: 'claude/discovered', modeId: 'plan' } } });
class Fake implements Runtime {
  calls: { role: Role; id: string; prompt: string }[] = [];
  responses: Partial<Record<Role, string[]>> = {};
  reviewCount = 0; testCount = 0; recoveryCount = 0; creationCount = 0;
  lost = false; nextRecovery?: Outcome; gate?: Promise<void>;
  async prepare() { return { cwd: '/repo', repo: '/repo/.git', baseline: '/baseline' }; }
  async agent(w: Workflow, role: Role) { this.creationCount++; return `${w.id}-${role}`; }
  async context() { return 'initial dirty state + current changes'; }
  async publish() {}
  async canClose() { return true; }
  async fingerprint() { return 'snapshot-fingerprint'; }
  async tests(w: Workflow) { this.testCount++; return (w.plan?.tests ?? []).map(t => ({ ...t, stdout: 'passed', stderr: '', exitCode: 0, durationMs: 1, timedOut: false, truncated: false })); }
  async run(_w: Workflow, role: Role, prompt: string, id: string): Promise<Outcome> {
    this.calls.push({ role, id, prompt });
    await this.gate;
    if (this.lost) { this.lost = false; throw new Error('connection lost after acceptance'); }
    const text = this.responses[role]?.shift() ?? JSON.stringify(role === 'planner' ? plan : role === 'builder' ? build : pass);
    return { status: 'idle', text };
  }
  async reconcile(): Promise<Outcome> { this.recoveryCount++; return this.nextRecovery ?? { status: 'uncertain', error: 'missing receipt' }; }
}
async function setup(t: TestContext, overrides: Partial<Config> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'teams-engine-'));
  const fake = new Fake(), store = new Store(dir), engine = new Engine(store, fake);
  t.after(async () => { engine.close(); await engine.settle(); await rm(dir, { recursive: true, force: true }); });
  const config = { ...base(), ...overrides };
  return { engine, fake, store, config, async create() { const w = await engine.create('workspace', 'Implement OAuth2', config, 'create-1'); await engine.settle(); return store.get(w.id); }, async action(w: Workflow, action: 'approve' | 'pause' | 'resume' | 'handoff' | 'message' | 'finish', extra = {}) {
    await engine.action({ id: w.id, expectedRevision: w.revision, requestId: `${action}-${Math.random()}`, action, ...extra }); await engine.settle(); return store.get(w.id);
  } };
}
test('approved plan → build → tests → review completes and reuses three sessions', async t => {
  const h = await setup(t); let w = await h.create(); assert.equal(w.status, 'awaiting_plan'); assert.equal(h.fake.calls.length, 1);
  w = await h.action(w, 'approve'); assert.equal(w.status, 'completed'); assert.equal(h.fake.creationCount, 3); assert.equal(h.fake.testCount, 1);
  assert.deepEqual(h.fake.calls.map(c => c.role), ['planner', 'builder', 'reviewer']);
});
test('failed review triggers at most two corrections', async t => {
  const h = await setup(t); h.fake.responses.reviewer = [JSON.stringify(fail), JSON.stringify(fail), JSON.stringify(fail)];
  let w = await h.create(); w = await h.action(w, 'approve');
  assert.equal(w.status, 'attention'); assert.equal(w.cycle, 2); assert.equal(h.fake.calls.filter(c => c.role === 'builder').length, 3); assert.equal(h.fake.creationCount, 3);
  assert.match(h.fake.calls.filter(c => c.role === 'builder')[1].prompt, /Missing state verification/);
});
test('failed tests cannot be overridden by a passing review', async t => {
  const h = await setup(t, { maxCorrections: 0 });
  h.fake.tests = async w => w.plan!.tests.map(t => ({ ...t, stdout: '', stderr: 'failure', exitCode: 1, durationMs: 1, timedOut: false, truncated: false }));
  let w = await h.create(); w = await h.action(w, 'approve'); assert.equal(w.status, 'attention');
});
test('final and autonomous policies use only launch-trusted commands', async t => {
  for (const validation of ['final', 'autonomous'] as const) {
    const h = await setup(t, { validation, testCommands: [{ command: 'trusted-check', timeoutMs: 1000 }] });
    let w = await h.create(); assert.equal(w.plan!.tests[0].command, 'trusted-check');
    assert.equal(w.status, validation === 'final' ? 'awaiting_final' : 'completed');
    if (validation === 'final') { w = await h.action(w, 'approve'); assert.equal(w.status, 'completed'); }
  }
});
test('no tests requires explicit acceptance and is recorded', async t => {
  const h = await setup(t); h.fake.responses.planner = [JSON.stringify({ ...plan, tests: [] })]; let w = await h.create();
  await assert.rejects(h.engine.action({ id: w.id, expectedRevision: w.revision, requestId: 'reject-no-tests', action: 'approve' }), /absence of tests/);
  w = await h.action(w, 'approve', { allowNoTests: true }); assert.equal(w.status, 'completed'); assert.equal(w.allowNoTests, true);
});
test('invalid output suspends and never dispatches a builder', async t => {
  const h = await setup(t); h.fake.responses.planner = ['not JSON']; const w = await h.create(); assert.equal(w.status, 'attention'); assert.equal(h.fake.calls.length, 1);
});
test('duplicate requests are idempotent; conflicting concurrent approvals are rejected', async t => {
  const h = await setup(t); const w = await h.create();
  const input = { id: w.id, expectedRevision: w.revision, requestId: 'approval', action: 'approve' as const };
  const results = await Promise.allSettled([h.engine.action(input), h.engine.action({ ...input, requestId: 'other-client' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); await h.engine.settle();
  await h.engine.action(input); assert.equal(h.fake.calls.filter(c => c.role === 'builder').length, 1);
  await assert.rejects(h.engine.action({ ...input, action: 'pause' }), /reused/);
  const duplicate = await h.engine.create('workspace', 'Implement OAuth2', h.config, 'create-1'); assert.equal(duplicate.id, w.id);
});
test('one workflow holds a repository lock even when paused', async t => {
  const h = await setup(t); const w = await h.create(); await h.action(w, 'pause');
  await assert.rejects(h.engine.create('second-workspace', 'Other task', h.config, 'create-2'), /holds this repository/);
});
test('pause/resume preserves a pending approval checkpoint', async t => {
  const h = await setup(t); let w = await h.create(); w = await h.action(w, 'pause'); w = await h.action(w, 'resume');
  assert.equal(w.status, 'awaiting_plan'); assert.equal(h.fake.calls.length, 1);
});
test('manual handoff includes prior response and uses a persistent target session', async t => {
  const h = await setup(t, { mode: 'manual' }); let w = await h.create(); const builder = w.agents.builder;
  w = await h.action(w, 'handoff', { role: 'builder' }); assert.equal(w.status, 'paused'); assert.equal(w.agents.builder, builder);
  assert.match(h.fake.calls[1].prompt, /Add OAuth2/); assert.match(h.fake.calls[1].prompt, /initial dirty state/);
  w = await h.action(w, 'finish'); assert.equal(w.status, 'completed');
});
test('permission suspends until resolved, then reconciles without resending', async t => {
  const h = await setup(t); h.fake.run = async (_w, role, prompt, id) => { h.fake.calls.push({ role, prompt, id }); return { status: 'permission' }; };
  let w = await h.create(); assert.equal(w.status, 'permission');
  h.fake.nextRecovery = { status: 'idle', text: JSON.stringify(plan) }; await h.engine.resolvePermission(w.agents.planner!); await h.engine.settle();
  w = await h.store.get(w.id); assert.equal(w.status, 'awaiting_plan'); assert.equal(h.fake.calls.length, 1);
});
test('lost response remains attached; explicit recovery completes without a second send', async t => {
  const h = await setup(t); h.fake.lost = true; let w = await h.create(); assert.equal(w.status, 'attention'); const op = w.operation!.id;
  h.fake.nextRecovery = { status: 'idle', text: JSON.stringify(plan) }; w = await h.action(w, 'resume');
  assert.equal(w.status, 'awaiting_plan'); assert.equal(h.fake.calls.length, 1); assert.equal(h.fake.calls[0].id, op);
});
test('restart recovery leaves ambiguous sends for intervention; duplicate receipts are ignored', async t => {
  const h = await setup(t); h.fake.lost = true; let w = await h.create();
  const op = w.operation!;
  await h.engine.receipt(w.agents.planner!, { status: 'idle' }, [{ type: 'user_message', text: `[agent-teams-operation:${op.id}]` }, { type: 'assistant_message', text: JSON.stringify(plan) }]);
  await h.engine.receipt(w.agents.planner!, { status: 'idle' }, [{ type: 'user_message', text: `[agent-teams-operation:${op.id}]` }]);
  w = await h.store.get(w.id); assert.equal(w.events.filter(e => e.kind === `receipt:${op.id}`).length, 1);
  const fresh = new Engine(h.store, h.fake); await fresh.action({ id: w.id, expectedRevision: w.revision, requestId: 'restart', action: 'resume' }); await fresh.settle(); fresh.close();
  w = await h.store.get(w.id); assert.equal(w.status, 'attention'); assert.equal(w.operation!.id, op.id); assert.equal(h.fake.calls.length, 1);
});
test('manual handoff waits for an active turn instead of interrupting it', async t => {
  const h = await setup(t, { mode: 'manual' }); let release!: () => void;
  h.fake.gate = new Promise<void>(resolve => { release = resolve; });
  const first = await h.engine.create('workspace', 'Implement OAuth2', h.config, 'create-1');
  while (!h.fake.calls.length) await new Promise(r => setTimeout(r, 5));
  let w = await h.store.get(first.id);
  await h.engine.action({ id: w.id, expectedRevision: w.revision, requestId: 'active-handoff', action: 'handoff', role: 'builder' });
  assert.equal(h.fake.calls.length, 1); h.fake.gate = undefined; release(); await h.engine.settle();
  w = await h.store.get(w.id); assert.deepEqual(h.fake.calls.map(c => c.role), ['planner', 'builder']); assert.equal(w.activeRole, 'builder');
});
test('automatic recovery reconciles an accepted operation without dispatching another prompt', async t => {
  const h = await setup(t, { recovery: 'automatic' }); h.fake.lost = true; let w = await h.create();
  w.status = 'running'; await h.store.put(w); h.fake.nextRecovery = { status: 'idle', text: JSON.stringify(plan) };
  const restarted = new Engine(h.store, h.fake); await restarted.recoverAutomatic(); await restarted.settle(); restarted.close();
  w = await h.store.get(w.id); assert.equal(w.status, 'awaiting_plan'); assert.equal(h.fake.calls.length, 1);
});
test('working tree changes after tests prevent completion even with a passing review', async t => {
  const h = await setup(t, { maxCorrections: 0 }); let fingerprintCalls = 0;
  h.fake.fingerprint = async () => ++fingerprintCalls === 1 ? 'tested-tree' : 'modified-after-tests';
  let w = await h.create(); w = await h.action(w, 'approve'); assert.equal(w.status, 'attention');
});
test('a manual message during a turn queues a follow-up for the same session', async t => {
  const h = await setup(t, { mode: 'manual' }); let release!: () => void;
  h.fake.gate = new Promise<void>(resolve => { release = resolve; });
  const first = await h.engine.create('workspace', 'Implement OAuth2', h.config, 'create-1');
  while (!h.fake.calls.length) await new Promise(r => setTimeout(r, 5));
  const w = await h.store.get(first.id);
  await h.engine.action({ id: w.id, expectedRevision: w.revision, requestId: 'follow-up', action: 'message', message: 'Also cover refresh tokens' });
  h.fake.gate = undefined; release(); await h.engine.settle();
  assert.deepEqual(h.fake.calls.map(c => c.role), ['planner', 'planner']); assert.match(h.fake.calls[1].prompt, /Also cover refresh tokens/);
});
test('provider presentation separators are accepted without accepting prose or invalid stage JSON', async () => {
  const { parseResult } = await import('../server/engine');
  assert.deepEqual(parseResult('builder', '\n\n---\n\n' + JSON.stringify(build)), build);
  assert.deepEqual(parseResult('builder', '\n---\n\n```json\n' + JSON.stringify(build) + '\n```'), build);
  assert.throws(() => parseResult('builder', 'Some explanation\n' + JSON.stringify(build)));
  assert.throws(() => parseResult('builder', '\n---\n\n' + JSON.stringify(build) + '\nTrailing explanation'));
});
test('shutdown preserves an accepted in-flight checkpoint when the SDK connection is closed', async t => {
  const h = await setup(t, { recovery: 'automatic' }); let rejectRun!: (error: Error) => void;
  h.fake.run = async (_w, role, prompt, id) => { h.fake.calls.push({ role, prompt, id }); return new Promise<Outcome>((_resolve, reject) => { rejectRun = reject; }); };
  const created = await h.engine.create('workspace', 'Implement OAuth2', h.config, 'create-1');
  while (!rejectRun) await new Promise(r => setTimeout(r, 5));
  h.engine.close(); rejectRun(new Error('Daemon client closed')); await h.engine.settle();
  let w = await h.store.get(created.id); assert.equal(w.status, 'running'); assert.ok(w.operation); assert.equal(w.error, undefined);
  h.fake.nextRecovery = { status: 'idle', text: JSON.stringify(plan) };
  const restarted = new Engine(h.store, h.fake); await restarted.recoverAutomatic(); await restarted.settle(); restarted.close();
  w = await h.store.get(created.id); assert.equal(w.status, 'awaiting_plan'); assert.equal(h.fake.calls.length, 1);
});
test('instruction-only read-only roles stop on repository changes and keep their checkpoint across recovery', async t => {
  const h = await setup(t, { recovery: 'automatic' });
  h.config.roles.planner = { provider: 'pi/connected/model', modeId: INSTRUCTION_READ_ONLY };
  h.fake.lost = true; let fingerprint = 'original-tree'; h.fake.fingerprint = async () => fingerprint;
  let w = await h.create(); assert.equal(w.operation?.readOnlyFingerprint, 'original-tree');
  fingerprint = 'changed-tree'; w.status = 'running'; await h.store.put(w); h.engine.close();
  h.fake.nextRecovery = { status: 'idle', text: JSON.stringify(plan) };
  const restarted = new Engine(h.store, h.fake); await restarted.recoverAutomatic(); await restarted.settle(); restarted.close();
  w = await h.store.get(w.id); assert.equal(w.status, 'attention'); assert.match(w.error!, /changed during a read-only turn/);
  assert.equal(w.operation?.readOnlyFingerprint, 'original-tree'); assert.equal(w.plan, undefined); assert.equal(h.fake.calls.length, 1);
});
