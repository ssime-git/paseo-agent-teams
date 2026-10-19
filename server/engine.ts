import { createHash, randomUUID } from 'node:crypto';
import { buildSchema, planSchema, reviewSchema, roles, type Action, type Config, type Role, type TestResult, type Workflow } from '../shared/contracts';
import { Store } from './store';

export interface Outcome { status: 'idle' | 'permission' | 'error' | 'timeout' | 'uncertain'; text?: string; error?: string; cursor?: { epoch: string; seq: number }; }
export interface Runtime {
  prepare(workspaceId: string, config: Config): Promise<{ cwd: string; repo: string; baseline: string }>;
  agent(w: Workflow, role: Role): Promise<string>;
  run(w: Workflow, role: Role, prompt: string, operationId: string): Promise<Outcome>;
  reconcile(w: Workflow): Promise<Outcome>;
  tests(w: Workflow, signal: AbortSignal): Promise<TestResult[]>;
  context(w: Workflow): Promise<string>;
  publish(w: Workflow): Promise<void>;
  canClose(w: Workflow): Promise<boolean>;
  fingerprint(w: Workflow): Promise<string>;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const schemaFor = (role: Role) => role === 'planner' ? planSchema : role === 'builder' ? buildSchema : reviewSchema;
export function parseResult(role: Role, text: string) {
  return schemaFor(role).parse(JSON.parse(text.trim().replace(/^(?:---[ \t]*\r?\n\s*)+/, '').replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '')));
}
export class Engine {
  private queue: Promise<unknown> = Promise.resolve();
  private jobs = new Set<string>();
  private controllers = new Map<string, AbortController>();
  private closed = false;
  constructor(readonly store: Store, private runtime: Runtime) {}
  setRuntime(runtime: Runtime) { this.runtime = runtime; }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn); this.queue = next.catch(() => {}); return next;
  }
  private event(w: Workflow, kind: string, text: string, role?: Role) {
    w.events.push({ id: randomUUID(), at: new Date().toISOString(), kind, text, ...(role ? { role } : {}) });
  }
  private async save(w: Workflow) {
    w.revision++; await this.store.put(w);
    // Native cards are a projection: failures must never replay an agent turn.
    try { await this.runtime.publish(w); } catch (e) { console.error('Agent Teams native card:', e); }
  }
  async list(workspaceId: string) { return (await this.store.all()).filter(w => w.workspaceId === workspaceId); }
  async create(workspaceId: string, task: string, config: Config, requestId: string) {
    const result = await this.serial(async () => {
      const all = await this.store.all(), key = `create:${requestId}`, hash = digest({ workspaceId, task, config });
      const previous = all.find(w => key in w.requests);
      if (previous) { if (previous.requests[key] !== hash) throw new Error('Request ID reused with different input'); return previous; }
      if (config.mode === 'auto' && config.validation !== 'plan' && !config.testCommands.length && !config.allowNoTests) throw new Error('Supply trusted test commands or explicitly accept no tests before autonomous execution');
      const prepared = await this.runtime.prepare(workspaceId, config);
      if (all.some(w => w.repo === prepared.repo && w.status !== 'completed')) throw new Error('Another workflow holds this repository. Resume or finish it first.');
      const w: Workflow = { version: 1, id: randomUUID(), revision: 0, workspaceId, task, config, ...prepared,
        agents: {}, phase: config.mode === 'auto' ? 'planning' : 'manual', status: 'ready', cycle: 0,
        tests: [], testsApproved: false, allowNoTests: false, events: [], requests: { [key]: hash }, cursors: {}, activeRole: 'planner' };
      this.event(w, 'created', task); await this.save(w); return w;
    });
    this.kick(result.id); return result;
  }
  async action(input: Action) {
    const w = await this.serial(async () => {
      const w = await this.store.get(input.id), { expectedRevision: _, ...payload } = input, hash = digest(payload);
      if (input.requestId in w.requests) {
        if (w.requests[input.requestId] !== hash) throw new Error('Request ID reused with different input');
        return w;
      }
      if (w.revision !== input.expectedRevision) throw new Error('Workflow changed. Refresh before retrying.');
      if (w.status === 'completed') throw new Error('Workflow already completed');
      switch (input.action) {
        case 'pause':
          w.resumeStatus = ['awaiting_plan', 'awaiting_final', 'attention'].includes(w.status) ? w.status as 'awaiting_plan' | 'awaiting_final' | 'attention' : 'ready';
          w.status = 'paused'; this.controllers.get(w.id)?.abort();
          this.event(w, 'paused', 'Pause requested. An agent turn already running is allowed to finish.'); break;
        case 'approve':
          if (w.status === 'awaiting_plan') {
            if (!w.plan) throw new Error('No plan to approve');
            if (input.tests) w.plan.tests = input.tests;
            w.allowNoTests = input.allowNoTests ?? false;
            if (!w.plan.tests.length && !w.allowNoTests) throw new Error('Explicitly accept the absence of tests');
            w.testsApproved = true; w.phase = 'building'; w.status = 'ready';
          } else if (w.status === 'awaiting_final') { w.phase = 'done'; w.status = 'completed'; }
          else throw new Error('No approval pending');
          this.event(w, 'approved', 'Human approval recorded'); break;
        case 'handoff':
          if (w.config.mode !== 'manual' || !input.role) throw new Error('Manual handoff requires a role');
          w.pendingRole = input.role;
          if (!w.operation) { w.activeRole = input.role; delete w.pendingRole; w.status = 'ready'; }
          this.event(w, 'handoff', `Pass the task to ${input.role} after the current turn`); break;
        case 'message':
          if (!input.message?.trim()) throw new Error('Message cannot be empty');
          this.event(w, 'user', input.message);
          if (w.operation) w.pendingRole = w.config.mode === 'manual' ? w.activeRole : 'planner';
          else {
            if (w.config.mode === 'auto') { w.phase = 'planning'; w.testsApproved = false; }
            w.status = 'ready'; delete w.resumeStatus;
          }
          break;
        case 'finish':
          if (this.jobs.has(w.id)) throw new Error('Pause and wait for the active step before closing');
          if (w.operation && !await this.runtime.canClose(w)) throw new Error('An agent is still running or unreachable. Wait before closing.');
          delete w.operation;
          w.phase = 'done'; w.status = 'completed'; this.event(w, 'closed', 'Workflow closed by user; working files retained'); break;
        case 'resume':
          if (w.status === 'awaiting_plan' || w.status === 'awaiting_final') throw new Error('Approval is required');
          // A finished invalid turn may be repaired by an explicit user retry. Ambiguous operations stay attached.
          if (w.status === 'attention' && !w.operation && w.phase === 'reviewing') w.phase = 'testing';
          w.status = w.operation ? 'running' : w.resumeStatus ?? 'ready'; delete w.resumeStatus; delete w.error;
          this.event(w, 'resumed', 'Reconcile saved operations before continuing'); break;
      }
      w.requests[input.requestId] = hash; await this.save(w); return w;
    });
    this.kick(w.id); return w;
  }
  async recoverAutomatic() {
    for (const w of await this.store.all()) {
      if (w.config.recovery !== 'automatic' || ['completed', 'paused', 'attention', 'awaiting_plan', 'awaiting_final'].includes(w.status)) continue;
      this.kick(w.id);
    }
  }
  async permission(agentId: string) {
    return this.serial(async () => {
      for (const w of await this.store.all()) if (w.operation && w.agents[w.operation.role] === agentId && w.status !== 'paused') {
        if (w.status !== 'permission') { w.status = 'permission'; this.event(w, 'permission', 'Answer the permission request in the native session'); await this.save(w); }
      }
    });
  }
  async receipt(agentId: string, outcome: Outcome, timeline: readonly { type: string; text?: string }[]) {
    await this.serial(async () => {
      for (const w of await this.store.all()) {
        const op = w.operation;
        if (!op || w.agents[op.role] !== agentId || !timeline.some(item => item.type === 'user_message' && item.text?.includes(`[agent-teams-operation:${op.id}]`))) continue;
        if (w.events.some(e => e.kind === `receipt:${op.id}`)) continue;
        const text = timeline.filter(item => item.type === 'assistant_message').at(-1)?.text;
        this.event(w, `receipt:${op.id}`, JSON.stringify({ ...outcome, text })); await this.save(w);
      }
    });
  }
  async resolvePermission(agentId: string) {
    const ids = await this.serial(async () => {
      const ids: string[] = [];
      for (const w of await this.store.all()) if (w.operation && w.agents[w.operation.role] === agentId && w.status === 'permission') {
        w.status = 'running'; await this.save(w); ids.push(w.id);
      }
      return ids;
    });
    for (const id of ids) this.kick(id);
  }
  private kick(id: string) {
    if (this.closed || this.jobs.has(id)) return;
    this.jobs.add(id);
    void this.drive(id).catch(async e => {
      if (this.closed) return;
      await this.serial(async () => { if (this.closed) return; const w = await this.store.get(id); w.status = 'attention'; w.error = String(e); this.event(w, 'error', String(e)); await this.save(w); });
    }).catch(console.error).finally(() => { this.jobs.delete(id); });
  }
  private async drive(id: string) {
    while (!this.closed) {
      let work: { w: Workflow; role?: Role; prompt?: string; reconcile?: boolean } | undefined;
      await this.serial(async () => {
        const w = await this.store.get(id);
        if (['paused', 'attention', 'awaiting_plan', 'awaiting_final', 'completed', 'permission'].includes(w.status)) return;
        if (w.operation) { work = { w, reconcile: true }; return; }
        if (w.status !== 'ready') return;
        if (w.phase === 'testing') {
          w.operation = { id: randomUUID(), role: 'builder', phase: 'testing', state: 'prepared', startedAt: new Date().toISOString() };
          w.status = 'running'; await this.save(w); work = { w }; return;
        }
        const role: Role = w.phase === 'manual' ? w.activeRole : w.phase === 'planning' ? 'planner' : w.phase === 'building' ? 'builder' : 'reviewer';
        // Idempotency keys make a crash during creation recoverable.
        for (const r of roles) if (!w.agents[r]) { w.agents[r] = await this.runtime.agent(w, r); await this.save(w); }
        const context = await this.runtime.context(w);
        const prompt = this.prompt(w, role, context);
        w.operation = { id: randomUUID(), role, phase: w.phase, state: 'prepared', startedAt: new Date().toISOString() };
        w.status = 'running'; delete w.error; this.event(w, 'dispatch', `Starting ${role}`, role); await this.save(w);
        work = { w, role, prompt };
      });
      if (!work) return;
      const job: { w: Workflow; role?: Role; prompt?: string; reconcile?: boolean } = work;
      const op = job.w.operation!;
      if (this.closed) return;
      if (op.phase === 'testing') {
        if (job.reconcile) { await this.fail(id, 'Tests were interrupted. Review their effects, then explicitly resume.', true); return; }
        const controller = new AbortController(); this.controllers.set(id, controller);
        let results: TestResult[];
        try { results = await this.runtime.tests(job.w, controller.signal); } finally { this.controllers.delete(id); }
        await this.serial(async () => {
          const w = await this.store.get(id); if (w.operation?.id !== op.id) return;
          w.tests = results; w.testedFingerprint = await this.runtime.fingerprint(w); delete w.operation;
          this.event(w, 'tests', JSON.stringify(results));
          w.phase = controller.signal.aborted ? 'testing' : 'reviewing'; if (w.status !== 'paused') w.status = 'ready'; await this.save(w);
        });
        continue;
      }
      const outcome = job.reconcile ? await this.runtime.reconcile(job.w) : await this.runtime.run(job.w, job.role!, job.prompt!, op.id);
      if (this.closed) return;
      let continueLoop = true;
      await this.serial(async () => {
        const w = await this.store.get(id); if (w.operation?.id !== op.id) return;
        if (outcome.cursor) w.cursors[op.role] = outcome.cursor;
        if (outcome.status !== 'idle') {
          // Never retry sends after timeouts or transport errors; retain their operation ID.
          if (w.status !== 'paused') w.status = outcome.status === 'permission' ? 'permission' : outcome.status === 'timeout' ? 'running' : 'attention';
          if (outcome.status === 'error') delete w.operation;
          w.error = outcome.error ?? outcome.status; this.event(w, outcome.status, w.error); await this.save(w);
          continueLoop = outcome.status === 'timeout' && w.status !== 'paused'; return;
        }
        const text = outcome.text ?? '';
        this.event(w, 'assistant', text, op.role);
        const paused = w.status === 'paused'; delete w.operation; delete w.error;
        if (w.config.mode === 'auto' && w.pendingRole === 'planner') {
          delete w.pendingRole; w.phase = 'planning'; w.testsApproved = false; w.status = paused ? 'paused' : 'ready';
          await this.save(w); return;
        }
        if (w.config.mode === 'manual') {
          if (w.pendingRole) { w.activeRole = w.pendingRole; delete w.pendingRole; w.status = paused ? 'paused' : 'ready'; }
          else w.status = 'paused';
          await this.save(w); return;
        }
        try {
          const result = parseResult(op.role, text);
          if (op.role === 'planner') {
            w.plan = planSchema.parse(result);
            w.phase = 'building';
            if (w.config.validation === 'plan') w.status = 'awaiting_plan';
            else {
              w.plan.tests = w.config.testCommands; w.allowNoTests = w.config.allowNoTests;
              w.testsApproved = true; w.status = 'ready';
              this.event(w, 'approved', 'Using test commands explicitly trusted at launch');
            }
          } else if (op.role === 'builder') {
            w.build = buildSchema.parse(result); w.phase = 'testing'; w.status = 'ready';
          } else {
            w.review = reviewSchema.parse(result);
            const testsPass = w.testedFingerprint === await this.runtime.fingerprint(w) && w.testsApproved && (w.plan!.tests.length > 0 ? w.tests.length === w.plan!.tests.length && w.tests.every(t => t.exitCode === 0 && !t.timedOut) : w.allowNoTests);
            if (w.review.verdict === 'pass' && testsPass) {
              w.phase = 'done'; w.status = w.config.validation === 'final' ? 'awaiting_final' : 'completed';
            } else if (w.config.autoFix && w.cycle < w.config.maxCorrections) {
              w.cycle++; w.phase = 'building'; w.status = 'ready';
            } else { w.status = 'attention'; w.error = 'Correction limit reached, or automatic correction disabled'; }
          }
        } catch (e) { w.status = 'attention'; w.error = `Invalid ${op.role} result: ${String(e)}`; this.event(w, 'invalid', w.error); }
        if (paused && w.status !== 'completed') {
          w.resumeStatus = ['awaiting_plan', 'awaiting_final', 'attention'].includes(w.status) ? w.status as 'awaiting_plan' | 'awaiting_final' | 'attention' : 'ready';
          w.status = 'paused';
        }
        await this.save(w);
      });
      if (!continueLoop) return;
    }
  }
  private prompt(w: Workflow, role: Role, context: string) {
    const instructions = role === 'planner' ? 'Analyze the repository. Propose architecture, tasks, acceptance criteria and test commands. Do not edit files.' : role === 'builder' ? 'Implement the approved plan. Address the review and failed tests. Preserve pre-existing user changes.' : 'Review the actual changes against the plan and initial repository state. Inspect test output. Do not edit files. Fail if tests fail or criteria are unmet.';
    return `${instructions}\nTrusted launch test commands: ${JSON.stringify(w.config.testCommands)}\nTask: ${w.task}\nLogical conversation (including decisions and remaining work):\n${JSON.stringify(w.events.filter(e => ['user', 'assistant', 'approved'].includes(e.kind)))}\nPlan: ${JSON.stringify(w.plan)}\nBuild: ${JSON.stringify(w.build)}\nReview: ${JSON.stringify(w.review)}\nTests: ${JSON.stringify(w.tests)}\nRepository context:\n${context}\n${w.config.mode === 'auto' ? `Return ONLY a JSON object matching this schema: ${JSON.stringify(schemaFor(role).toJSONSchema())}` : 'Return a useful handoff briefing covering progress, decisions, relevant files and remaining work.'}`;
  }
  private async fail(id: string, message: string, clearOperation = false) {
    await this.serial(async () => { const w = await this.store.get(id); if (clearOperation) delete w.operation; w.status = 'attention'; w.error = message; this.event(w, 'error', message); await this.save(w); });
  }
  async settle() { while (this.jobs.size) await new Promise(resolve => setTimeout(resolve, 5)); }
  close() { this.closed = true; for (const controller of this.controllers.values()) controller.abort(); }
}
