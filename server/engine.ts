import { TeamError } from '../shared/errors';
import { rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import {
  buildSchema,
  planSchema,
  reviewSchema,
  roles,
  type Action,
  type Config,
  type Role,
  type TestResult,
  type Workflow,
} from '../shared/contracts';
import {
  HUMAN_CHECKPOINTS,
  TERMINAL_OR_WAITING,
  DISPATCH_BLOCKED,
  PHASE_ROLES,
  STAGE_TRANSITIONS,
} from '../shared/state-machine';
import { buildPrompt, estimateTokens } from './prompt';
import { Store } from './store';
import { INSTRUCTION_READ_ONLY } from '../shared/provider-selection';

export interface Outcome {
  status: 'idle' | 'permission' | 'error' | 'timeout' | 'uncertain';
  text?: string;
  error?: string;
  cursor?: { epoch: string; seq: number };
}
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
const schemaFor = (role: Role) => (role === 'planner' ? planSchema : role === 'builder' ? buildSchema : reviewSchema);
export function parseResult(role: Role, text: string) {
  return schemaFor(role).parse(
    JSON.parse(
      text
        .trim()
        .replace(/^(?:---[ \t]*\r?\n\s*)+/, '')
        .replace(/^```(?:json)?\s*\n?/, '')
        .replace(/\n?```$/, ''),
    ),
  );
}
type Work = { w: Workflow; role?: Role; prompt?: string; reconcile?: boolean };
export class Engine {
  private queues = new Map<string, Promise<unknown>>();
  private jobs = new Map<string, Promise<void>>();
  private controllers = new Map<string, AbortController>();
  private closed = false;
  constructor(
    readonly store: Store,
    private runtime: Runtime,
  ) {}
  setRuntime(runtime: Runtime) {
    this.runtime = runtime;
  }
  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(key) ?? Promise.resolve()).then(fn);
    const tail = next.catch(() => {});
    this.queues.set(key, tail);
    void tail.finally(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return next;
  }
  private event(w: Workflow, kind: string, text: string, role?: Role) {
    w.events.push({ id: randomUUID(), at: new Date().toISOString(), kind, text, ...(role ? { role } : {}) });
  }
  private async save(w: Workflow) {
    const entries = Object.entries(w.requests);
    w.requests = Object.fromEntries([
      ...entries.filter(([key]) => key.startsWith('create:')),
      ...entries.filter(([key]) => !key.startsWith('create:')).slice(-199),
    ]);
    w.revision++;
    await this.store.put(w);
    if (w.status === 'completed') {
      try {
        await rm(w.baseline, { force: true });
      } catch (error) {
        console.error('Agent Teams baseline cleanup:', error);
      }
    }
    // Native cards are a projection: failures must never replay an agent turn.
    try {
      await this.runtime.publish(w);
    } catch (e) {
      console.error('Agent Teams native card:', e);
    }
  }
  async list(workspaceId: string) {
    return (await this.store.all()).filter((w) => w.workspaceId === workspaceId);
  }
  async create(workspaceId: string, task: string, config: Config, requestId: string) {
    const key = `create:${requestId}`,
      hash = digest({ workspaceId, task, config });
    const existing = (await this.store.all()).find((w) => key in w.requests);
    if (existing) {
      if (existing.requests[key] !== hash)
        throw new TeamError('REQUEST_ID_CONFLICT', 'Request ID reused with different input');
      this.kick(existing.id);
      return existing;
    }
    await this.store.assertCanCreate();
    const prepared = await this.runtime.prepare(workspaceId, config);
    let committed = false;
    try {
      const result = await this.serial('create', async () => {
        await this.store.assertCanCreate(prepared.repo);
        const all = await this.store.all();
        const previous = all.find((w) => key in w.requests);
        if (previous) {
          if (previous.requests[key] !== hash)
            throw new TeamError('REQUEST_ID_CONFLICT', 'Request ID reused with different input');
          return previous;
        }
        if (all.some((w) => w.repo === prepared.repo && w.status !== 'completed'))
          throw new TeamError(
            'REPOSITORY_LOCKED',
            'Another workflow holds this repository. Resume or finish it first.',
          );
        const w: Workflow = {
          version: 1,
          id: randomUUID(),
          revision: 0,
          workspaceId,
          task,
          config,
          ...prepared,
          agents: {},
          phase: config.mode === 'auto' ? 'planning' : 'manual',
          status: 'ready',
          cycle: 0,
          tests: [],
          testsApproved: false,
          allowNoTests: false,
          events: [],
          requests: { [key]: hash },
          cursors: {},
          activeRole: 'planner',
        };
        this.event(w, 'created', task);
        await this.save(w);
        committed = true;
        return w;
      });
      this.kick(result.id);
      return result;
    } finally {
      if (!committed) await rm(prepared.baseline, { force: true });
    }
  }
  async action(input: Action) {
    const w = await this.serial(input.id, async () => {
      const w = await this.store.get(input.id),
        { expectedRevision: _, ...payload } = input,
        hash = digest(payload);
      if (input.workspaceId !== undefined && input.workspaceId !== w.workspaceId)
        throw new TeamError('WORKSPACE_ACCESS_DENIED', 'Workspace access denied');
      if (input.requestId in w.requests) {
        if (w.requests[input.requestId] !== hash)
          throw new TeamError('REQUEST_ID_CONFLICT', 'Request ID reused with different input');
        return w;
      }
      if (w.revision !== input.expectedRevision)
        throw new TeamError('REVISION_CONFLICT', 'Workflow changed. Refresh before retrying.');
      if (w.status === 'completed') throw new TeamError('WORKFLOW_COMPLETED', 'Workflow already completed');
      switch (input.action) {
        case 'pause':
          w.resumeStatus = HUMAN_CHECKPOINTS.includes(w.status)
            ? (w.status as 'awaiting_plan' | 'awaiting_final' | 'attention')
            : 'ready';
          w.status = 'paused';
          this.controllers.get(w.id)?.abort();
          this.event(w, 'paused', 'Pause requested. An agent turn already running is allowed to finish.');
          break;
        case 'approve':
          if (w.status === 'awaiting_plan') {
            if (!w.plan) throw new TeamError('PLAN_MISSING', 'No plan to approve');
            if (input.tests) w.plan.tests = input.tests;
            w.allowNoTests = input.allowNoTests ?? false;
            if (!w.plan.tests.length && !w.allowNoTests)
              throw new TeamError('NO_TESTS_APPROVAL_REQUIRED', 'Explicitly accept the absence of tests');
            w.testsApproved = true;
            w.phase = STAGE_TRANSITIONS.planner;
            w.status = 'ready';
          } else if (w.status === 'awaiting_final') {
            w.phase = STAGE_TRANSITIONS.reviewer;
            w.status = 'completed';
          } else throw new TeamError('APPROVAL_NOT_PENDING', 'No approval pending');
          this.event(w, 'approved', 'Human approval recorded');
          break;
        case 'handoff':
          if (w.config.mode !== 'manual' || !input.role)
            throw new TeamError('HANDOFF_ROLE_REQUIRED', 'Manual handoff requires a role');
          w.pendingRole = input.role;
          if (!w.operation) {
            w.activeRole = input.role;
            delete w.pendingRole;
            w.status = 'ready';
          }
          this.event(w, 'handoff', `Pass the task to ${input.role} after the current turn`);
          break;
        case 'message':
          if (!input.message?.trim()) throw new TeamError('MESSAGE_EMPTY', 'Message cannot be empty');
          this.event(w, 'user', input.message);
          if (w.operation) w.pendingRole = w.config.mode === 'manual' ? w.activeRole : 'planner';
          else {
            if (w.config.mode === 'auto') {
              w.phase = 'planning';
              w.testsApproved = false;
            }
            w.status = 'ready';
            delete w.resumeStatus;
          }
          break;
        case 'finish':
          if (this.jobs.has(w.id))
            throw new TeamError('ACTIVE_STEP', 'Pause and wait for the active step before closing');
          if (w.operation && !(await this.runtime.canClose(w)))
            throw new TeamError('AGENT_UNAVAILABLE', 'An agent is still running or unreachable. Wait before closing.');
          delete w.operation;
          w.phase = STAGE_TRANSITIONS.reviewer;
          w.status = 'completed';
          this.event(w, 'closed', 'Workflow closed by user; working files retained');
          break;
        case 'resume':
          if (w.status === 'awaiting_plan' || w.status === 'awaiting_final')
            throw new TeamError('APPROVAL_REQUIRED', 'Approval is required');
          // A finished invalid turn may be repaired by an explicit user retry. Ambiguous operations stay attached.
          if (w.status === 'attention' && !w.operation && w.phase === 'reviewing') w.phase = STAGE_TRANSITIONS.builder;
          w.status = w.operation ? 'running' : (w.resumeStatus ?? 'ready');
          delete w.resumeStatus;
          delete w.error;
          this.event(w, 'resumed', 'Reconcile saved operations before continuing');
          break;
      }
      w.requests[input.requestId] = hash;
      await this.save(w);
      return w;
    });
    this.kick(w.id);
    return w;
  }
  async recoverAutomatic() {
    for (const w of await this.store.all()) {
      if (w.config.recovery !== 'automatic' || TERMINAL_OR_WAITING.includes(w.status)) continue;
      this.kick(w.id);
    }
  }
  private async forAgent(agentId: string, fn: (w: Workflow) => Promise<void>) {
    for (const id of await this.store.forAgent(agentId)) {
      await this.serial(id, async () => {
        const w = await this.store.get(id);
        if (w.operation && w.agents[w.operation.role] === agentId) await fn(w);
      });
    }
  }
  async permission(agentId: string) {
    await this.forAgent(agentId, async (w) => {
      if (w.status === 'paused' || w.status === 'permission') return;
      w.status = 'permission';
      this.event(w, 'permission', 'Answer the permission request in the native session');
      await this.save(w);
    });
  }
  async receipt(agentId: string, outcome: Outcome, timeline: readonly { type: string; text?: string }[]) {
    await this.forAgent(agentId, async (w) => {
      const op = w.operation!;
      if (
        !timeline.some(
          (item) => item.type === 'user_message' && item.text?.includes(`[agent-teams-operation:${op.id}]`),
        )
      )
        return;
      if (w.receipts?.[op.id] || w.events.some((e) => e.kind === `receipt:${op.id}`)) return;
      const text = timeline.filter((item) => item.type === 'assistant_message').at(-1)?.text;
      w.receipts = Object.fromEntries([
        ...Object.entries(w.receipts ?? {}).slice(-99),
        [op.id, JSON.stringify({ ...outcome, text })],
      ]);
      await this.save(w);
    });
  }
  async resolvePermission(agentId: string) {
    const ids: string[] = [];
    await this.forAgent(agentId, async (w) => {
      if (w.status !== 'permission') return;
      w.status = 'running';
      await this.save(w);
      ids.push(w.id);
    });
    for (const id of ids) this.kick(id);
  }
  private kick(id: string) {
    if (this.closed || this.jobs.has(id)) return;
    const job = this.drive(id)
      .catch(async (e) => {
        if (this.closed) return;
        await this.serial(id, async () => {
          if (this.closed) return;
          const w = await this.store.get(id);
          w.status = 'attention';
          w.error = String(e);
          this.event(w, 'error', String(e));
          await this.save(w);
        });
      })
      .catch(console.error)
      .finally(async () => {
        this.jobs.delete(id);
        if (!this.closed && (await this.store.get(id)).status === 'ready') this.kick(id);
      });
    this.jobs.set(id, job);
  }
  private async drive(id: string) {
    while (!this.closed) {
      const job = await this.dispatchNext(id);
      if (!job || this.closed) return;
      const op = job.w.operation!;
      if (op.phase === 'testing') {
        if (job.reconcile) {
          await this.fail(id, 'Tests were interrupted. Review their effects, then explicitly resume.', true);
          return;
        }
        await this.runTests(job);
        continue;
      }
      const outcome = job.reconcile
        ? await this.runtime.reconcile(job.w)
        : await this.runtime.run(job.w, job.role!, job.prompt!, op.id);
      if (this.closed || !(await this.applyOutcome(job, outcome))) return;
      if (outcome.status === 'timeout') await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  private async dispatchNext(id: string): Promise<Work | undefined> {
    const w = await this.serial(id, async () => this.store.get(id));
    if (DISPATCH_BLOCKED.includes(w.status)) return;
    if (w.operation) return { w, reconcile: true };
    if (w.status !== 'ready') return;
    if (w.phase === 'testing') return this.prepareTests(w);
    const role: Role = w.phase === 'manual' ? w.activeRole : PHASE_ROLES[w.phase];
    const revision = w.revision;
    for (const r of roles) {
      // Opt-in: a role dispatched in a later correction cycle restarts from a clean session to bound its history.
      const stale = w.config.freshSessionPerCycle && r === role && (w.agentCycles?.[r] ?? 0) < w.cycle;
      if (w.agents[r] && !stale) continue;
      w.agents[r] = await this.runtime.agent(w, r);
      w.agentCycles = { ...w.agentCycles, [r]: w.cycle };
    }
    const context = await this.runtime.context(w);
    const prompt = buildPrompt(w, role, context);
    const fingerprint =
      w.config.roles[role].modeId === INSTRUCTION_READ_ONLY ? await this.runtime.fingerprint(w) : undefined;
    return this.serial(id, async () => {
      const current = await this.store.get(id);
      if (this.closed || current.revision !== revision || current.operation) return;
      current.agents = w.agents;
      current.agentCycles = w.agentCycles;
      current.operation = {
        id: randomUUID(),
        role,
        phase: current.phase,
        state: 'prepared',
        startedAt: new Date().toISOString(),
        readOnlyFingerprint: fingerprint,
      };
      current.status = 'running';
      current.handoffTokens = estimateTokens(prompt);
      delete current.error;
      this.event(current, 'dispatch', `Starting ${role}`, role);
      await this.save(current);
      return { w: current, role, prompt };
    });
  }
  private async prepareTests(snapshot: Workflow): Promise<Work | undefined> {
    return this.serial(snapshot.id, async () => {
      const w = await this.store.get(snapshot.id);
      if (this.closed || w.revision !== snapshot.revision || w.operation) return;
      w.operation = {
        id: randomUUID(),
        role: 'builder',
        phase: 'testing',
        state: 'prepared',
        startedAt: new Date().toISOString(),
      };
      w.status = 'running';
      await this.save(w);
      return { w };
    });
  }
  private async runTests(job: Work) {
    const id = job.w.id,
      op = job.w.operation!;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    let results: TestResult[];
    try {
      results = await this.runtime.tests(job.w, controller.signal);
    } finally {
      this.controllers.delete(id);
    }
    const fingerprint = await this.runtime.fingerprint(job.w);
    await this.serial(id, async () => {
      const w = await this.store.get(id);
      if (w.operation?.id !== op.id) return;
      w.tests = results;
      w.testedFingerprint = fingerprint;
      delete w.operation;
      this.event(
        w,
        'tests',
        results.map((r) => `${r.command} → ${r.exitCode ?? 'interrompu'}`).join('\n') || 'No tests',
      );
      w.phase = controller.signal.aborted ? STAGE_TRANSITIONS.builder : STAGE_TRANSITIONS.tests;
      if (w.status !== 'paused') w.status = 'ready';
      await this.save(w);
    });
  }
  private async applyOutcome(job: Work, outcome: Outcome) {
    const op = job.w.operation!;
    const fingerprint =
      outcome.status === 'idle' && (op.readOnlyFingerprint || op.role === 'reviewer')
        ? await this.runtime.fingerprint(job.w)
        : undefined;
    return this.serial(job.w.id, async () => {
      const w = await this.store.get(job.w.id);
      if (w.operation?.id !== op.id) return true;
      if (outcome.cursor) w.cursors[op.role] = outcome.cursor;
      if (outcome.status !== 'idle') return this.applyPendingOutcome(w, outcome);
      await this.applyIdleOutcome(w, op, outcome.text ?? '', fingerprint);
      return true;
    });
  }
  private async applyPendingOutcome(w: Workflow, outcome: Outcome) {
    // Never retry sends after timeouts or transport errors; retain their operation ID.
    if (w.status !== 'paused') {
      w.status =
        outcome.status === 'permission' ? 'permission' : outcome.status === 'timeout' ? 'running' : 'attention';
    }
    if (outcome.status === 'error') delete w.operation;
    if (outcome.status === 'timeout' && w.operation) {
      w.operation.consecutiveTimeouts = (w.operation.consecutiveTimeouts ?? 0) + 1;
      if (w.operation.consecutiveTimeouts >= (w.config.maxConsecutiveTimeouts ?? 3) && w.status !== 'paused') {
        w.status = 'attention';
      }
    }
    w.error =
      outcome.error ??
      (w.status === 'attention' && outcome.status === 'timeout'
        ? 'Timeout limit reached; inspect the retained operation before resuming'
        : outcome.status);
    this.event(w, outcome.status, w.error);
    await this.save(w);
    return outcome.status === 'timeout' && w.status === 'running';
  }
  private async applyIdleOutcome(
    w: Workflow,
    op: NonNullable<Workflow['operation']>,
    text: string,
    fingerprint?: string,
  ) {
    this.event(w, 'assistant', text, op.role);
    if (op.readOnlyFingerprint && fingerprint !== op.readOnlyFingerprint) {
      w.status = 'attention';
      w.error =
        'Repository changed during a read-only turn. Inspect the files before continuing; no changes were reverted.';
      this.event(w, 'error', w.error, op.role);
      await this.save(w);
      return;
    }
    const paused = w.status === 'paused';
    delete w.operation;
    delete w.error;
    if (!this.applyHandoff(w, paused)) {
      await this.applyStageResult(w, op.role, text, fingerprint);
      if (paused && w.status !== 'completed') {
        w.resumeStatus = HUMAN_CHECKPOINTS.includes(w.status)
          ? (w.status as 'awaiting_plan' | 'awaiting_final' | 'attention')
          : 'ready';
        w.status = 'paused';
      }
    }
    await this.save(w);
  }
  private applyHandoff(w: Workflow, paused: boolean) {
    if (w.config.mode === 'auto' && w.pendingRole === 'planner') {
      delete w.pendingRole;
      w.phase = 'planning';
      w.testsApproved = false;
      w.status = paused ? 'paused' : 'ready';
      return true;
    }
    if (w.config.mode !== 'manual') return false;
    if (w.pendingRole) {
      w.activeRole = w.pendingRole;
      delete w.pendingRole;
      w.status = paused ? 'paused' : 'ready';
    } else w.status = 'paused';
    return true;
  }
  private async applyStageResult(w: Workflow, role: Role, text: string, fingerprint?: string) {
    try {
      const result = parseResult(role, text);
      if (role === 'planner') this.applyPlan(w, result);
      else if (role === 'builder') {
        w.build = buildSchema.parse(result);
        w.phase = STAGE_TRANSITIONS.builder;
        w.status = 'ready';
      } else this.applyReview(w, result, fingerprint);
    } catch (e) {
      w.status = 'attention';
      w.error = `Invalid ${role} result: ${String(e)}`;
      this.event(w, 'invalid', w.error);
    }
  }
  private applyPlan(w: Workflow, result: unknown) {
    w.plan = planSchema.parse(result);
    w.phase = STAGE_TRANSITIONS.planner;
    if (w.config.validation === 'plan') w.status = 'awaiting_plan';
    else {
      if (w.config.testCommands.length) w.plan.tests = w.config.testCommands;
      w.allowNoTests = w.config.allowNoTests;
      if ((!w.config.testCommands.length && w.plan.tests.length > 0) || (!w.plan.tests.length && !w.allowNoTests)) {
        w.status = 'awaiting_plan';
        this.event(
          w,
          'intervention',
          'Approve planner test commands, or explicitly accept the absence of tests, before continuing.',
        );
      } else {
        w.testsApproved = true;
        w.status = 'ready';
        this.event(
          w,
          'approved',
          w.config.testCommands.length
            ? 'Using test commands specified at launch'
            : 'Using test commands chosen by the planner',
        );
      }
    }
  }
  private applyReview(w: Workflow, result: unknown, fingerprint?: string) {
    w.review = reviewSchema.parse(result);
    const testsPass =
      w.testedFingerprint === fingerprint &&
      w.testsApproved &&
      (w.plan!.tests.length > 0
        ? w.tests.length === w.plan!.tests.length && w.tests.every((t) => t.exitCode === 0 && !t.timedOut)
        : w.allowNoTests);
    if (w.review.verdict === 'pass' && testsPass) {
      w.phase = STAGE_TRANSITIONS.reviewer;
      w.status = w.config.validation === 'final' ? 'awaiting_final' : 'completed';
    } else if (w.config.autoFix && w.cycle < w.config.maxCorrections) {
      w.cycle++;
      w.phase = STAGE_TRANSITIONS.planner;
      w.status = 'ready';
    } else {
      w.status = 'attention';
      w.error = 'Correction limit reached, or automatic correction disabled';
    }
  }
  private async fail(id: string, message: string, clearOperation = false) {
    await this.serial(id, async () => {
      const w = await this.store.get(id);
      if (clearOperation) delete w.operation;
      w.status = 'attention';
      w.error = message;
      this.event(w, 'error', message);
      await this.save(w);
    });
  }
  async settle() {
    while (this.jobs.size) await Promise.all(this.jobs.values());
  }
  close() {
    this.closed = true;
    for (const controller of this.controllers.values()) controller.abort();
  }
}
