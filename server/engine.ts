import { TeamError } from '../shared/errors';
import { rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import {
  buildSchema,
  planSchema,
  planRevisionSchema,
  reviewSchema,
  roles,
  type Action,
  type Config,
  type Role,
  type TestResult,
  type Workflow,
  type Permission,
} from '../shared/contracts';
import {
  HUMAN_CHECKPOINTS,
  TERMINAL_OR_WAITING,
  DISPATCH_BLOCKED,
  PHASE_ROLES,
  STAGE_TRANSITIONS,
} from '../shared/state-machine';
import { buildPrompt, repairPrompt, estimateTokens } from './prompt';
import { Store } from './store';
import { repositoryLocks, scopesOverlap, type RepositoryTarget } from './scopes';
import { INSTRUCTION_READ_ONLY } from '../shared/provider-selection';

export interface Outcome {
  status: 'idle' | 'permission' | 'error' | 'timeout' | 'uncertain';
  text?: string;
  error?: string;
  cursor?: { epoch: string; seq: number };
}
export type PreparedScope = { cwd: string; repo: string; repositoryTargets?: RepositoryTarget[] };
export type CheckScope = (scope: PreparedScope) => Promise<void>;
export interface Runtime {
  prepare(workspaceId: string, config: Config, checkScope?: CheckScope): Promise<PreparedScope & { baseline: string }>;
  agent(w: Workflow, role: Role): Promise<string>;
  run(w: Workflow, role: Role, prompt: string, operationId: string): Promise<Outcome>;
  reconcile(w: Workflow): Promise<Outcome>;
  tests(w: Workflow, signal: AbortSignal): Promise<TestResult[]>;
  context(w: Workflow): Promise<string>;
  skillContext?(w: Workflow, role: Role): Promise<string>;
  publish(w: Workflow): Promise<void>;
  canClose(w: Workflow): Promise<boolean>;
  fingerprint(w: Workflow): Promise<string>;
  permissions?(w: Workflow): Promise<Permission[]>;
  respondPermission?(w: Workflow, id: string, behavior: 'allow' | 'deny', selectedActionId?: string): Promise<void>;
  autoApprove?(w: Workflow): Promise<boolean>;
  validateSelection?(w: Workflow, role: Role, selection: Config['roles'][Role]): Promise<void>;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export { parseResult } from './result-parser';
import { parseResult, parseJson } from './result-parser';
type Work = { w: Workflow; role?: Role; prompt?: string; reconcile?: boolean };
export class Engine {
  private queues = new Map<string, Promise<unknown>>();
  private jobs = new Map<string, Promise<void>>();
  private controllers = new Map<string, AbortController>();
  private closed = false;
  private observed = new Set<string>();
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
    // Keep the launch snapshot for post-validation delivery; an explicit close disposes it.
    if (w.status === 'completed' && w.events.some((event) => event.kind === 'closed')) {
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
    const result = await this.serial('create', async () => {
      const previous = (await this.store.all()).find((w) => key in w.requests);
      if (previous) {
        if (previous.requests[key] !== hash)
          throw new TeamError('REQUEST_ID_CONFLICT', 'Request ID reused with different input');
        return previous;
      }
      const checkScope: CheckScope = async (scope) => {
        for (const lock of repositoryLocks(scope)) await this.store.assertCanCreate(lock);
        const blocker = (await this.store.all()).find((w) => scopesOverlap(w, scope) && w.status !== 'completed');
        if (blocker)
          throw new TeamError(
            'REPOSITORY_LOCKED',
            `Another workflow holds this repository: ${blocker.id} (workspace ${blocker.workspaceId ?? 'unknown'}). Open Agent Teams there to resume or close it.`,
          );
      };
      let prepared: (PreparedScope & { baseline: string }) | undefined;
      let committed = false;
      try {
        // The creation lock is held through snapshot capture and persistence. The runtime
        // checks the resolved target locks before reading any launch snapshot.
        prepared = await this.runtime.prepare(workspaceId, config, checkScope);
        await checkScope(prepared);
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
      } finally {
        if (prepared && !committed) await rm(prepared.baseline, { force: true });
      }
    });
    this.kick(result.id);
    return result;
  }
  async action(input: Action) {
    // Reopening a completed record must acquire the same repository lock as creation.
    if (input.action === 'followup') return this.serial('create', () => this.performAction(input));
    return this.performAction(input);
  }
  private async performAction(input: Action) {
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
      if (w.status === 'completed' && input.action !== 'followup')
        throw new TeamError('WORKFLOW_COMPLETED', 'Workflow already completed');
      switch (input.action) {
        case 'followup': {
          if (
            !['completed', 'paused', 'attention', 'awaiting_plan', 'awaiting_final'].includes(w.status) ||
            w.operation ||
            w.phase === 'followup' ||
            this.jobs.has(w.id)
          )
            throw new TeamError(
              'CHECKPOINT_REQUIRED',
              'Wait for the current turn or reconcile its saved operation before sending a follow-up.',
            );
          if (!input.message?.trim()) throw new TeamError('MESSAGE_EMPTY', 'Message cannot be empty');
          for (const lock of repositoryLocks(w)) await this.store.assertCanCreate(lock);
          const blocker = (await this.store.all()).find(
            (other) => other.id !== w.id && scopesOverlap(other, w) && other.status !== 'completed',
          );
          if (blocker)
            throw new TeamError('REPOSITORY_LOCKED', `Another workflow holds this repository: ${blocker.id}`);
          if (!(await this.runtime.canClose(w)))
            throw new TeamError('ACTIVE_STEP', 'A native agent is still active or awaiting permissions.');
          const purpose = input.purpose ?? 'message';
          if (purpose === 'plan_revision' && (w.config.mode !== 'auto' || !w.plan || w.status === 'completed'))
            throw new TeamError('PLAN_REVISION_UNAVAILABLE', 'A live automatic workflow with a plan is required');
          const testsPassed =
            w.plan &&
            w.testsApproved &&
            (w.plan.tests.length
              ? w.tests.length === w.plan.tests.length && w.tests.every((t) => t.exitCode === 0 && !t.timedOut)
              : w.allowNoTests);
          if (
            purpose === 'pull_request' &&
            (w.status !== 'completed' ||
              w.review?.verdict !== 'pass' ||
              !testsPassed ||
              w.events.some((e) => e.kind === 'closed') ||
              w.testedFingerprint !== (await this.runtime.fingerprint(w)))
          )
            throw new TeamError(
              'VALIDATION_REQUIRED',
              'The repository must still match a successfully validated workflow before creating a PR. Replan and validate current changes first.',
            );
          w.followup = {
            purpose,
            returnPhase: w.phase,
            returnStatus: w.status as NonNullable<Workflow['followup']>['returnStatus'],
            previousError: w.error,
            previousResumeStatus: w.resumeStatus,
          };
          w.phase = 'followup';
          w.activeRole =
            purpose === 'plan_revision'
              ? 'reviewer'
              : purpose === 'pull_request'
                ? 'builder'
                : (input.role ?? 'planner');
          w.status = 'ready';
          delete w.error;
          this.event(w, 'user', input.message.trim());
          this.event(
            w,
            'message_accepted',
            `Message transmis à ${w.activeRole} · ${w.config.roles[w.activeRole].provider}`,
            w.activeRole,
          );
          break;
        }
        case 'adopt_plan': {
          if (
            w.operation ||
            this.jobs.has(w.id) ||
            w.phase === 'followup' ||
            !['paused', 'attention', 'awaiting_plan', 'awaiting_final'].includes(w.status)
          )
            throw new TeamError('CHECKPOINT_REQUIRED', 'Wait for the current turn before adopting a plan');
          const proposal = w.planProposal;
          if (!proposal || proposal.baseVersion !== w.planVersions?.at(-1)?.version)
            throw new TeamError('PLAN_PROPOSAL_STALE', 'No current Reviewer proposal to adopt');
          if (!(await this.runtime.canClose(w)))
            throw new TeamError('ACTIVE_STEP', 'A native agent is still active or awaiting permissions.');
          const paused = w.status === 'paused';
          this.applyPlan(w, proposal.plan, proposal.operationId, 'reviewer', proposal);
          delete w.resumeStatus;
          if (paused) {
            w.resumeStatus = w.status === 'awaiting_plan' ? 'awaiting_plan' : 'ready';
            w.status = 'paused';
          }
          this.event(
            w,
            'plan_adopted',
            `Proposition Reviewer adoptée depuis le plan v${proposal.baseVersion}.`,
            'reviewer',
          );
          break;
        }
        case 'start_goal': {
          if (
            w.config.mode !== 'auto' ||
            !['paused', 'attention'].includes(w.status) ||
            w.operation ||
            this.jobs.has(w.id)
          )
            throw new TeamError('CHECKPOINT_REQUIRED', 'Wait for a safe checkpoint before starting goal execution');
          if (!(await this.runtime.canClose(w))) throw new TeamError('ACTIVE_STEP', 'A native agent is still active');
          // Older plugin versions rejected otherwise valid fenced reports. Recover their facts
          // for diagnosis without treating them as tested work or replaying the Builder turn.
          const lastBuild = w.events.filter((e) => e.kind === 'assistant' && e.role === 'builder').at(-1);
          if (lastBuild) {
            try {
              w.build = buildSchema.parse(parseResult('builder', lastBuild.text));
            } catch {
              /* The Planner still has the actual repository and previous validated artifacts. */
            }
          }
          w.config.goalMode = true;
          w.config.autoFix = true;
          w.config.recovery = 'automatic';
          w.config.freshSessionPerCycle = true;
          w.goal = { startedAt: new Date().toISOString(), turns: 0, corrections: 0, replans: 0 };
          delete w.resultRepair;
          delete w.error;
          delete w.resumeStatus;
          w.phase = 'planning';
          w.status = 'ready';
          this.event(
            w,
            'goal_started',
            'Poursuite de l’objectif : diagnostic Planner, développement, tests et revue indépendants.',
          );
          break;
        }
        case 'reconfigure':
        case 'continue': {
          if (!['paused', 'attention'].includes(w.status) || w.operation || this.jobs.has(w.id))
            throw new TeamError(
              'CHECKPOINT_REQUIRED',
              'Pause and wait for the current turn before changing or restarting a phase. Reconcile any retained operation first.',
            );
          if (!(await this.runtime.canClose(w)))
            throw new TeamError('ACTIVE_STEP', 'A native agent is still active or has pending permissions.');
          if (!input.role) throw new TeamError('ROLE_REQUIRED', 'Choose a phase');
          const role = input.role;
          if (input.action === 'reconfigure') {
            if (!input.selection || !this.runtime.validateSelection)
              throw new TeamError('SELECTION_REQUIRED', 'Choose a discovered harness, model and permission mode');
            await this.runtime.validateSelection(w, role, input.selection);
            if (JSON.stringify(w.config.roles[role]) !== JSON.stringify(input.selection)) {
              const previousAgent = w.agents[role];
              w.config.roles[role] = input.selection;
              w.agentGenerations = { ...w.agentGenerations, [role]: (w.agentGenerations?.[role] ?? 0) + 1 };
              w.agents = Object.fromEntries(Object.entries(w.agents).filter(([key]) => key !== role));
              w.cursors = Object.fromEntries(Object.entries(w.cursors).filter(([key]) => key !== role));
              this.event(w, 'reconfigured', JSON.stringify({ role, selection: input.selection, previousAgent }), role);
            }
            break;
          }
          if (w.config.mode === 'auto' && role !== 'planner' && (!w.plan || !w.testsApproved))
            throw new TeamError('APPROVAL_REQUIRED', 'Approve the plan and tests before restarting this phase');
          delete w.resultRepair;
          if (w.config.goalMode)
            w.goal = { startedAt: new Date().toISOString(), turns: 0, corrections: 0, replans: w.goal?.replans ?? 0 };
          w.config.maxCorrections = Math.max(w.config.maxCorrections, w.cycle + (input.extraCorrections ?? 2));
          if (input.message?.trim()) this.event(w, 'user', input.message.trim());
          if (w.config.mode === 'manual') {
            w.phase = 'manual';
            w.activeRole = role;
          } else {
            w.phase = role === 'planner' ? 'planning' : role === 'builder' ? 'building' : 'reviewing';
            if (role === 'planner') w.testsApproved = false;
            if (role === 'builder' && w.build) w.cycle++;
          }
          delete w.pendingRole;
          delete w.resumeStatus;
          delete w.error;
          w.status = 'ready';
          this.event(w, 'continued', `Restart ${role}; correction limit extended to ${w.config.maxCorrections}`, role);
          break;
        }
        case 'permission':
          if (!w.operation || !input.permissionId || !input.behavior || !this.runtime.respondPermission)
            throw new TeamError('PERMISSION_UNAVAILABLE', 'Permission is no longer available');
          await this.runtime.respondPermission(w, input.permissionId, input.behavior, input.selectedActionId);
          if (w.status !== 'paused') w.status = 'running';
          delete w.error;
          this.event(
            w,
            'permission_resolved',
            `Permission ${input.behavior === 'allow' ? 'approved' : 'rejected'} in Agent Teams`,
            w.operation.role,
          );
          break;
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
            if (input.tests && JSON.stringify(input.tests) !== JSON.stringify(w.plan.tests)) {
              this.recordPlan(w, { ...w.plan, tests: input.tests }, 'human');
            }
            w.allowNoTests = input.allowNoTests ?? false;
            if (!w.plan.tests.length && !w.allowNoTests)
              throw new TeamError('NO_TESTS_APPROVAL_REQUIRED', 'Explicitly accept the absence of tests');
            this.approvePlan(w, 'human');
            if (w.config.goalMode && w.goal?.turns === 1) w.goal.startedAt = new Date().toISOString();
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
          if (w.phase === 'followup')
            throw new TeamError('ACTIVE_STEP', 'Wait for the follow-up response before sending another message.');
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
          this.event(
            w,
            'message_accepted',
            w.status === 'paused'
              ? 'Message enregistré. Cliquez sur Reprendre pour le transmettre.'
              : w.status === 'permission'
                ? 'Message enregistré. Répondez à la permission puis reprenez ; le Planner le recevra après le tour courant.'
                : w.operation
                  ? 'Message enregistré ; transmission après le tour courant.'
                  : 'Message transmis à l’agent.',
            w.config.mode === 'manual' ? w.activeRole : 'planner',
          );
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
    if (input.action !== 'reconfigure') this.kick(w.id);
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
    const wake: string[] = [];
    await this.forAgent(agentId, async (w) => {
      if (w.status === 'paused') return;
      if (await this.runtime.autoApprove?.(w)) {
        w.status = 'running';
        this.event(w, 'permission_auto', 'Builder tool permission auto-approved', 'builder');
        await this.save(w);
        wake.push(w.id);
        return;
      }
      if (w.status === 'permission') return;
      w.status = 'permission';
      this.event(w, 'permission', 'Permission requise : répondez depuis Agent Teams.', w.operation!.role);
      await this.save(w);
    });
    for (const id of wake) this.kick(id);
  }
  async receipt(agentId: string, outcome: Outcome, timeline: readonly { type: string; text?: string }[]) {
    const wake: string[] = [];
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
      if (w.status === 'permission' && this.observed.has(w.id)) {
        w.status = 'running';
        delete w.error;
        wake.push(w.id);
      }
      await this.save(w);
    });
    for (const id of wake) this.kick(id);
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
    this.observed.add(id);
    if (this.closed || this.jobs.has(id)) return;
    const job = this.drive(id)
      .catch(async (e) => {
        if (this.closed) return;
        await this.serial(id, async () => {
          if (this.closed) return;
          const w = await this.store.get(id);
          const reconnect =
            w.config.goalMode &&
            w.config.recovery === 'automatic' &&
            w.operation &&
            w.status !== 'paused' &&
            /connection|disconnect|socket|ECONN|EPIPE|network|transport/i.test(String(e));
          w.status = w.status === 'paused' ? 'paused' : reconnect ? 'running' : 'attention';
          w.error = String(e);
          this.event(
            w,
            reconnect ? 'reconnecting' : 'error',
            reconnect
              ? 'Connexion interrompue : réconciliation automatique de l’opération enregistrée, sans renvoi de la tâche.'
              : String(e),
          );
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
      let outcome = job.reconcile
        ? await this.runtime.reconcile(job.w)
        : await this.runtime.run(job.w, job.role!, job.prompt!, op.id);
      if (outcome.status === 'permission') {
        const current = await this.store.get(id);
        if (current.operation?.id === op.id && current.status !== 'paused') {
          await this.runtime.autoApprove?.(current);
          job.w = current;
          outcome = await this.runtime.reconcile(current);
        }
      }
      if (this.closed || !(await this.applyOutcome(job, outcome))) return;
      if (outcome.status === 'timeout') await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  private async dispatchNext(id: string): Promise<Work | undefined> {
    const w = await this.serial(id, async () => this.store.get(id));
    if (DISPATCH_BLOCKED.includes(w.status)) return;
    if (w.operation) return { w, reconcile: true };
    if (w.status !== 'ready') return;
    if (w.config.goalMode && w.phase !== 'followup') {
      const elapsed = Date.now() - Date.parse(w.goal?.startedAt ?? new Date().toISOString());
      if (
        (w.phase !== 'testing' && (w.goal?.turns ?? 0) >= (w.config.goalMaxTurns ?? 30)) ||
        elapsed >= (w.config.goalTimeBudgetMs ?? 7_200_000)
      ) {
        await this.fail(
          id,
          'Budget de poursuite de l’objectif atteint. Consultez le bilan puis prolongez explicitement.',
        );
        return;
      }
    }
    if (w.phase === 'testing') return this.prepareTests(w);
    const role: Role = w.phase === 'manual' || w.phase === 'followup' ? w.activeRole : PHASE_ROLES[w.phase];
    const revision = w.revision;
    for (const r of roles) {
      // Opt-in: a role dispatched in a later correction cycle restarts from a clean session to bound its history.
      const stale = w.config.freshSessionPerCycle && r === role && (w.agentCycles?.[r] ?? 0) < w.cycle;
      if (w.agents[r] && !stale) continue;
      w.agents[r] = await this.runtime.agent(w, r);
      w.agentCycles = { ...w.agentCycles, [r]: w.cycle };
    }
    const [context, skillContext] = await Promise.all([
      w.resultRepair ? '' : this.runtime.context(w),
      w.resultRepair ? '' : (this.runtime.skillContext?.(w, role) ?? ''),
    ]);
    const prompt = w.resultRepair ? repairPrompt(w) : buildPrompt(w, role, context, skillContext);
    const fingerprint =
      w.resultRepair ||
      w.config.roles[role].modeId === INSTRUCTION_READ_ONLY ||
      (w.phase === 'followup' && w.followup?.purpose !== 'pull_request')
        ? await this.runtime.fingerprint(w)
        : undefined;
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
      if (current.config.goalMode && current.phase !== 'followup') {
        current.goal ??= { startedAt: new Date().toISOString(), turns: 0, corrections: 0, replans: 0 };
        current.goal.turns++;
      }
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
      if (w.status !== 'paused') {
        w.status = 'ready';
        if (
          w.config.goalMode &&
          w.config.autoFix &&
          !controller.signal.aborted &&
          results.some((r) => r.exitCode !== 0 || r.timedOut)
        ) {
          this.retryGoal(w);
          this.event(
            w,
            'verification_failed',
            'Vérification échouée : diagnostic et correction avant de demander une revue indépendante.',
          );
        }
      }
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
      // A completion hook can arrive while the SDK is still returning a permission outcome.
      // Observe the newly saved receipt once instead of overwriting its wake-up with a stale pause.
      if (outcome.status === 'permission' && w.receipts?.[op.id] && !job.w.receipts?.[op.id]) {
        if (w.status === 'paused') return false;
        w.status = 'running';
        await this.save(w);
        return true;
      }
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
      if (
        (w.config.goalMode
          ? Date.now() - Date.parse(w.goal?.startedAt ?? w.operation.startedAt) >=
            (w.config.goalTimeBudgetMs ?? 7_200_000)
          : w.operation.consecutiveTimeouts >= (w.config.maxConsecutiveTimeouts ?? 3)) &&
        w.status !== 'paused'
      ) {
        w.status = 'attention';
      }
    }
    w.error =
      outcome.error ??
      (w.status === 'attention' && outcome.status === 'timeout'
        ? w.config.goalMode
          ? 'Budget de temps atteint ; opération conservée, sans renvoi automatique.'
          : 'Timeout limit reached; inspect the retained operation before resuming'
        : outcome.status);
    if (outcome.status !== 'permission' || w.events.at(-1)?.kind !== 'permission')
      this.event(
        w,
        outcome.status,
        outcome.status === 'permission' ? 'Permission requise : répondez depuis Agent Teams.' : w.error,
      );
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
    if (op.phase === 'followup' && w.followup) {
      const revision = w.followup.purpose === 'plan_revision';
      w.followupResult = text;
      w.phase = w.followup.returnPhase;
      w.status = w.followup.returnStatus === 'completed' ? 'completed' : paused ? 'paused' : w.followup.returnStatus;
      w.resumeStatus =
        w.followup.previousResumeStatus ??
        (paused && HUMAN_CHECKPOINTS.includes(w.followup.returnStatus)
          ? (w.followup.returnStatus as 'awaiting_plan' | 'awaiting_final' | 'attention')
          : undefined);
      if (w.followup.previousError) w.error = w.followup.previousError;
      delete w.followup;
      if (revision) {
        delete w.planProposal;
        try {
          const result = planRevisionSchema.parse(parseJson(text));
          if (result.kind === 'proposal') {
            w.planProposal = {
              plan: result.plan,
              summary: result.summary,
              baseVersion: w.planVersions!.at(-1)!.version,
              operationId: op.id,
              agentId: w.agents.reviewer!,
              selection: structuredClone(w.config.roles.reviewer),
              at: new Date().toISOString(),
            };
            this.event(
              w,
              'plan_proposed',
              'Proposition Reviewer enregistrée ; adoption explicite requise.',
              'reviewer',
            );
          }
        } catch (error) {
          w.error = `Invalid plan revision: ${String(error)}`;
          this.event(w, 'invalid', w.error, 'reviewer');
        }
      }
      await this.save(w);
      return;
    }
    if (!this.applyHandoff(w, paused)) {
      await this.applyStageResult(w, op.role, text, fingerprint, op.id);
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
  private async applyStageResult(w: Workflow, role: Role, text: string, fingerprint?: string, operationId?: string) {
    try {
      const result = parseResult(role, text);
      delete w.resultRepair;
      if (role === 'planner') this.applyPlan(w, result, operationId);
      else if (role === 'builder') {
        w.build = buildSchema.parse(result);
        if (
          w.config.goalMode &&
          w.build.tests &&
          !w.config.testCommands.length &&
          JSON.stringify(w.build.tests) !== JSON.stringify(w.plan!.tests)
        ) {
          w.plan!.tests = w.build.tests;
          this.recordPlan(w, w.plan, 'builder');
          this.approvePlan(w, 'configuration');
          this.event(
            w,
            'verification_updated',
            'Commandes de vérification mises à jour par le Builder ; contrôle indépendant à suivre.',
            'builder',
          );
        }
        w.phase = STAGE_TRANSITIONS.builder;
        w.status = 'ready';
      } else this.applyReview(w, result, fingerprint);
    } catch (e) {
      const attempts = (w.resultRepair?.attempts ?? 0) + 1;
      w.error = `Invalid ${role} result: ${String(e)}`;
      if (attempts <= 2) {
        w.resultRepair = { role, attempts, error: w.error, text: text.slice(-32 * 1024) };
        w.status = 'ready';
        this.event(
          w,
          'result_repair',
          `Rapport ${role} illisible : remise en forme automatique ${attempts}/2, sans réexécuter le travail.`,
          role,
        );
      } else {
        delete w.resultRepair;
        w.status = 'attention';
        this.event(w, 'invalid', w.error);
      }
    }
  }
  private recordPlan(
    w: Workflow,
    plan: Workflow['plan'],
    source: 'planner' | 'builder' | 'human' | 'reviewer',
    operationId?: string,
    provenance?: Workflow['planProposal'],
  ) {
    if (!plan) throw new TeamError('PLAN_MISSING', 'No plan to record');
    // Seed records created before plan versioning without inventing a native provenance.
    if (w.plan && !w.planVersions?.length) {
      const at = w.events.at(-1)?.at ?? '1970-01-01T00:00:00.000Z';
      w.planVersions = [
        {
          version: 1,
          plan: structuredClone(w.plan),
          source: 'legacy',
          at,
          ...(w.testsApproved ? { approval: { at, policy: 'legacy' as const, allowNoTests: w.allowNoTests } } : {}),
        },
      ];
    }
    const version = (w.planVersions?.at(-1)?.version ?? 0) + 1;
    w.planVersions = [
      ...(w.planVersions ?? []),
      {
        version,
        plan: structuredClone(plan),
        source,
        at: new Date().toISOString(),
        ...(source !== 'human'
          ? {
              agentId: provenance?.agentId ?? w.agents[source],
              operationId,
              selection: structuredClone(provenance?.selection ?? w.config.roles[source]),
            }
          : {}),
      },
    ];
    w.plan = structuredClone(plan);
    delete w.planProposal;
    w.testsApproved = false;
    w.allowNoTests = false;
    delete w.testedFingerprint;
    this.event(w, 'plan_version', `Plan v${version} enregistré (${source}). Une nouvelle approbation est requise.`);
  }
  private approvePlan(w: Workflow, policy: 'human' | 'configuration') {
    const version = w.planVersions?.at(-1);
    if (version) {
      version.approval = { at: new Date().toISOString(), policy, allowNoTests: w.allowNoTests };
      this.event(w, 'plan_approved', `Plan v${version.version} approuvé (${policy}).`);
    }
    w.testsApproved = true;
  }
  private applyPlan(
    w: Workflow,
    result: unknown,
    operationId?: string,
    source: 'planner' | 'reviewer' = 'planner',
    provenance?: Workflow['planProposal'],
  ) {
    const plan = planSchema.parse(result);
    const acceptedNoTests = w.allowNoTests || w.config.allowNoTests;
    const goalApproved =
      w.config.goalMode && (w.config.validation !== 'plan' || !!w.planVersions?.some((v) => v.approval));
    if (w.config.validation !== 'plan' && w.config.testCommands.length) plan.tests = w.config.testCommands;
    this.recordPlan(w, plan, source, operationId, provenance);
    w.phase = STAGE_TRANSITIONS.planner;
    if (w.config.validation === 'plan' && !goalApproved) w.status = 'awaiting_plan';
    else {
      w.allowNoTests = goalApproved ? acceptedNoTests : w.config.allowNoTests;
      if (
        (!w.config.goalMode && !w.config.testCommands.length && plan.tests.length > 0) ||
        (!plan.tests.length && !w.allowNoTests)
      ) {
        w.status = 'awaiting_plan';
        this.event(
          w,
          'intervention',
          'Approve planner test commands, or explicitly accept the absence of tests, before continuing.',
        );
      } else {
        this.approvePlan(w, 'configuration');
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
    } else if (w.config.goalMode && w.config.autoFix) {
      this.retryGoal(w);
    } else if (w.config.autoFix && w.cycle < w.config.maxCorrections) {
      w.cycle++;
      w.phase = STAGE_TRANSITIONS.planner;
      w.status = 'ready';
      this.event(
        w,
        'correction',
        `Correction ${w.cycle}/${w.config.maxCorrections} : ${w.review.verdict === 'fail' ? 'review refusée' : 'tests non validés'}. Retour au Builder.`,
        'builder',
      );
    } else {
      w.status = 'attention';
      w.error = 'Correction limit reached, or automatic correction disabled';
    }
  }
  private retryGoal(w: Workflow) {
    w.goal ??= { startedAt: new Date().toISOString(), turns: 0, corrections: 0, replans: 0 };
    w.cycle++;
    w.goal.corrections++;
    const replan = w.goal.corrections >= Math.max(1, w.config.maxCorrections);
    w.phase = replan ? 'planning' : 'building';
    if (replan) {
      w.goal.replans++;
      w.goal.corrections = 0;
    }
    // Each review gets an independent session and the current artifact, not its previous conversation.
    delete w.agents.reviewer;
    delete w.cursors.reviewer;
    w.agentGenerations = { ...w.agentGenerations, reviewer: (w.agentGenerations?.reviewer ?? 0) + 1 };
    w.status = 'ready';
    this.event(
      w,
      replan ? 'goal_replan' : 'correction',
      replan
        ? 'Blocage persistant : retour au Planner pour diagnostiquer le plan, les commandes et les dépendances, puis poursuivre.'
        : 'Revue ou tests non validés : correction et vérification par le Builder.',
      replan ? 'planner' : 'builder',
    );
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
