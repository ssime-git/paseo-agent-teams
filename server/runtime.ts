import { relevantSkills } from './skills';
import { TeamError } from '../shared/errors';
import type { PaseoApi, PaseoAgentHandle } from '@getpaseo/client';
import { writeFile, realpath } from 'node:fs/promises';
import { join, sep, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { roles, type Config, type Role, type Workflow, type Permission } from '../shared/contracts';
import { resolveRepositories } from './scopes';
import { captureRepositories, repositoryContext, scopeFingerprint } from './repository-context';
import { runCommand } from './commands';
import { providerProfiles, nativeMode, builderMode } from './providers';
import { DEFAULT_MODEL, INSTRUCTION_READ_ONLY, readOnlyMode, parseProvider } from '../shared/provider-selection';
import type { Outcome, Runtime, CheckScope } from './engine';
import type { RoleAction } from './team-timeline';
import type { AgentTimelineItem } from '@getpaseo/protocol/agent-types';

export { readOnlyMode } from '../shared/provider-selection';
export class PaseoRuntime implements Runtime {
  private permissionReplies = new Map<string, Promise<void>>();
  constructor(
    private api: PaseoApi,
    private directory: string,
    private nativeApi: () => PaseoApi | undefined = () => api,
  ) {}
  async validateSelection(w: Workflow, role: Role, selection: Config['roles'][Role]) {
    const profiles = await providerProfiles(this.api);
    const { harness, model } = parseProvider(selection.provider);
    const family = profiles.families[harness] ?? harness;
    const discovered = await this.api.providers.waitForReady({ cwd: w.cwd });
    const entry = discovered.entries.find((e) => e.provider === harness && e.status === 'ready');
    if (!entry || !(entry.models?.some((m) => m.id === model) || (!entry.models?.length && model === DEFAULT_MODEL)))
      throw new TeamError('PROVIDER_UNAVAILABLE', `Unavailable provider/model: ${selection.provider}`);
    nativeMode(family, selection.modeId, (await this.api.providers.listModes(harness, { cwd: w.cwd })).modes ?? []);
    if (role !== 'builder' && !readOnlyMode(family, selection.modeId))
      throw new TeamError('READ_ONLY_REQUIRED', `${role} requires a read-only permission choice`);
  }
  async prepare(workspaceId: string, config: Config, checkScope?: CheckScope) {
    const workspace = await this.api.workspaces.ref(workspaceId).refresh();
    if (!workspace) throw new TeamError('WORKSPACE_NOT_FOUND', 'Workspace no longer exists');
    const actualCwd = workspace.workspaceDirectory;
    if (!actualCwd) throw new TeamError('WORKSPACE_DIRECTORY_MISSING', 'Workspace has no directory');
    const profiles = await providerProfiles(this.api);
    const discovered = await this.api.providers.waitForReady({ cwd: actualCwd });
    for (const role of roles) {
      const selection = config.roles[role];
      const { harness, model } = parseProvider(selection.provider);
      const family = profiles.families[harness] ?? harness;
      const entry = discovered.entries.find((e) => e.provider === harness && e.status === 'ready');
      if (!entry || !(entry.models?.some((m) => m.id === model) || (!entry.models?.length && model === DEFAULT_MODEL)))
        throw new TeamError('PROVIDER_UNAVAILABLE', `Unavailable provider/model: ${selection.provider}`);
      const modes = await this.api.providers.listModes(harness, { cwd: actualCwd });
      nativeMode(family, selection.modeId, modes.modes ?? []);
      if (role !== 'builder' && !readOnlyMode(family, selection.modeId))
        throw new TeamError('READ_ONLY_REQUIRED', `${role} requires a read-only permission choice`);
    }
    const targets = await resolveRepositories(actualCwd, config.repositoryPaths);
    if (!isAbsolute(this.directory))
      throw new TeamError('DATA_DIRECTORY_RELATIVE', 'The data directory must be absolute');
    const dataPath = await realpath(this.directory);
    if (targets.some((repo) => dataPath === repo.root || dataPath.startsWith(repo.root + sep)))
      throw new TeamError(
        'DATA_DIRECTORY_IN_REPOSITORY',
        'The data directory must be outside the workspace repository',
      );
    await checkScope?.({ cwd: actualCwd, repo: targets[0].lock, repositoryTargets: targets });
    const baseline = join(this.directory, `baseline-${randomUUID()}.snapshot`);
    const captured = JSON.stringify(await captureRepositories(targets));
    if (Buffer.byteLength(captured) > 20 * 1024 * 1024)
      throw new TeamError(
        'SNAPSHOT_TOO_LARGE',
        'The combined repository snapshot exceeds 20 MiB. Narrow the selected repositories.',
      );
    await writeFile(baseline, captured, { mode: 0o600, flush: true });
    return { cwd: actualCwd, repo: targets[0].lock, repositoryTargets: targets, baseline };
  }
  async agent(w: Workflow, role: Role) {
    const profiles = await providerProfiles(this.api);
    const selection = w.config.roles[role];
    const { harness, model } = parseProvider(selection.provider);
    const family = profiles.families[harness] ?? harness;
    const codexReadOnly = family === 'codex' && selection.modeId === 'read-only';
    let modeId =
      codexReadOnly || !['claude', 'codex'].includes(family)
        ? nativeMode(
            family,
            selection.modeId,
            (await this.api.providers.listModes(harness, { cwd: w.cwd })).modes ?? [],
          )
        : selection.modeId;
    let featureValues: Record<string, unknown> | undefined;
    if (role === 'builder' && w.config.builderAutoAccept) {
      const modes = (await this.api.providers.listModes(harness, { cwd: w.cwd })).modes ?? [];
      modeId = builderMode(family, modes, modeId, true);
      const { features } = await this.api.providers.listFeatures({
        provider: model === DEFAULT_MODEL ? harness : selection.provider,
        cwd: w.cwd,
        modeId,
      });
      if (features?.some((f) => f.id === 'auto_accept' && f.type === 'toggle')) featureValues = { auto_accept: true };
    }
    const options = {
      idempotencyKey: `${w.id}-${role}${w.config.freshSessionPerCycle && w.cycle ? `-c${w.cycle}` : ''}${w.agentGenerations?.[role] ? `-g${w.agentGenerations[role]}` : ''}`,
      config: {
        ...selection,
        provider: model === DEFAULT_MODEL ? harness : selection.provider,
        modeId,
        ...(featureValues ? { featureValues } : {}),
        ...(codexReadOnly && modeId !== 'full-access'
          ? { options: { sandbox_mode: 'read-only', approval_policy: 'never' } }
          : {}),
        ...(role !== 'builder' && family === 'claude'
          ? { options: { disallowedTools: ['ExitPlanMode', 'EnterPlanMode', 'Edit', 'Write', 'NotebookEdit'] } }
          : {}),
        systemPrompt:
          role === 'builder' && (w.config.builderAutoAccept || selection.modeId !== INSTRUCTION_READ_ONLY)
            ? 'Preserve existing user changes. Only edit files required for the task.'
            : 'Read-only pipeline role: analyze and report. Never edit files. Do not call EnterPlanMode or ExitPlanMode or request native plan approval. Return your result directly; human checkpoints are managed by the Agent Teams plugin.',
      },
      env: { GIT_OPTIONAL_LOCKS: '0' },
      // Inside a Team Auto thread the parent already names the team; the subagent list shows the role.
      title: w.ownerAgentId ? role[0].toUpperCase() + role.slice(1) : `Agent Teams · ${role}`,
      labels: { 'agent-teams-workflow': w.id, 'agent-teams-role': role },
    };
    const agents = this.api.workspaces.ref(w.workspaceId).agents;
    if (!w.ownerAgentId) return (await agents.create(options)).id;
    // Native Team Auto missions keep their roles as child agents of the orchestrator thread.
    try {
      return (await agents.create({ ...options, parent: w.ownerAgentId })).id;
    } catch (error) {
      // A closed orchestrator degrades to a regular role tab instead of blocking the mission.
      if (!/Caller agent .* not found/.test(String(error))) throw error;
      return (await agents.create(options)).id;
    }
  }
  async skillContext(w: Workflow, role: Role) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.api.agents.ref(w.agents[role]!).commands(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('skill discovery timeout')), 2000);
        }),
      ]);
      if (result.error) return 'Native skill discovery unavailable; use relevant skills already known in this harness.';
      return JSON.stringify(relevantSkills(w.task, result.commands));
    } catch {
      return 'Native skill discovery unavailable; use relevant skills already known in this harness.';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async run(w: Workflow, role: Role, prompt: string, operationId: string): Promise<Outcome> {
    const agent = this.api.agents.ref(w.agents[role]!);
    await agent.refresh();
    if (agent.status === 'running' || agent.pendingPermissions?.length)
      return { status: 'uncertain', error: 'Agent is already busy. Open its native session before resuming.' };
    const result = await agent.run(`[agent-teams-operation:${operationId}]\n${prompt}`, {
      messageId: operationId,
      activeTurnBehavior: 'steer',
      timeoutMs: 60_000,
    });
    // Claude may report authentication/entitlement failures as assistant replies with an idle turn.
    if (
      result.status === 'idle' &&
      (/^Failed to authenticate:/i.test(result.lastMessage ?? '') ||
        /^.{1,120} requires usage credits\./.test(result.lastMessage ?? ''))
    )
      return { status: 'error', error: result.lastMessage! };
    return { status: result.status, text: result.lastMessage ?? undefined, error: result.error ?? undefined };
  }
  async permissions(w: Workflow): Promise<Permission[]> {
    if (!w.operation) return [];
    const role = w.operation.role,
      agent = this.api.agents.ref(w.agents[role]!);
    if (!(await agent.refresh())) throw new TeamError('AGENT_UNAVAILABLE', 'Agent unavailable');
    return (agent.pendingPermissions ?? []).map((p) => ({
      id: p.id,
      role,
      title: p.title ?? p.name,
      description: p.description ?? '',
      kind: p.kind,
      details: JSON.stringify(p.input ?? p.detail ?? {}, null, 2).slice(0, 16000),
      actions: (p.actions ?? []).map((a) => ({ id: a.id, label: a.label, behavior: a.behavior })),
      canAllow:
        role === 'builder' || (!['plan', 'mode'].includes(p.kind) && !/^(EnterPlanMode|ExitPlanMode)$/.test(p.name)),
    }));
  }
  async respondPermission(w: Workflow, permissionId: string, behavior: 'allow' | 'deny', selectedActionId?: string) {
    const key = `${w.id}:${permissionId}`;
    const existing = this.permissionReplies.get(key);
    if (existing) return existing;
    const reply = this.replyPermission(w, permissionId, behavior, selectedActionId);
    this.permissionReplies.set(key, reply);
    try {
      await reply;
    } finally {
      this.permissionReplies.delete(key);
    }
  }
  private async replyPermission(
    w: Workflow,
    permissionId: string,
    behavior: 'allow' | 'deny',
    selectedActionId?: string,
  ) {
    const permissions = await this.permissions(w),
      request = permissions.find((p) => p.id === permissionId);
    // A retry can find an already resolved unique permission. Never answer a different request.
    if (!request) return;
    if (behavior === 'allow' && !request.canAllow)
      throw new TeamError('READ_ONLY_REQUIRED', 'This role must remain read-only. Reject the native mode change.');
    if (selectedActionId && !request.actions.some((a) => a.id === selectedActionId && a.behavior === behavior))
      throw new TeamError('INVALID_PERMISSION_ACTION', 'Permission action is no longer available');
    await this.api.agents.ref(w.agents[request.role]!).respondToPermission({
      requestId: permissionId,
      response: behavior === 'allow' ? { behavior, selectedActionId } : { behavior, selectedActionId, interrupt: true },
    });
  }
  async autoApprove(w: Workflow) {
    if (!w.config.builderAutoAccept || w.operation?.role !== 'builder') return false;
    const requests = (await this.permissions(w)).filter(
      (p) => p.kind === 'tool' && (!p.actions.length || p.actions.some((a) => a.behavior === 'allow')),
    );
    for (const request of requests)
      await this.respondPermission(w, request.id, 'allow', request.actions.find((a) => a.behavior === 'allow')?.id);
    return requests.length > 0;
  }
  async reconcile(w: Workflow): Promise<Outcome> {
    const op = w.operation!;
    const agent = this.api.agents.ref(w.agents[op.role]!);
    if (!(await agent.refresh()))
      return { status: 'uncertain', error: 'Saved agent is missing; operation will not be resent' };
    if (agent.pendingPermissions?.length) return { status: 'permission' };
    const history = await this.history(agent);
    const index = history.entries.findIndex(
      (e) =>
        e.item.type === 'user_message' &&
        (e.item.messageId === op.id ||
          e.item.clientMessageId === op.id ||
          e.item.text.includes(`[agent-teams-operation:${op.id}]`)),
    );
    if (index < 0)
      return {
        status: 'uncertain',
        error: 'Cannot prove that the saved prompt was accepted; inspect the native session',
      };
    if (history.entries.slice(index + 1).some((e) => e.item.type === 'user_message'))
      return { status: 'uncertain', error: 'Another prompt was sent to this session; review it before continuing' };
    const cursor = history.cursor;
    if (agent.status === 'running' && agent.activeTurn) {
      const result = await agent.waitForFinish(60_000);
      return { status: result.status, text: result.lastMessage ?? undefined, error: result.error ?? undefined, cursor };
    }
    // A stored hook receipt proves completion; idle alone does not.
    const receipt = w.receipts?.[op.id] ?? w.events.find((e) => e.kind === `receipt:${op.id}`)?.text;
    if (receipt) {
      const result = JSON.parse(receipt) as Outcome;
      return { ...result, cursor };
    }
    return {
      status: 'uncertain',
      error: 'No durable completion receipt. The operation is retained and will not be replayed.',
      cursor,
    };
  }
  async reviewerPlan(w: Workflow) {
    return this.nativeExchange(w, 'reviewer');
  }
  async plannerAnswers(w: Workflow) {
    return this.nativeExchange(w, 'planner');
  }
  private async nativeExchange(w: Workflow, role: Role) {
    const agent = this.api.agents.ref(w.agents[role]!);
    if (!(await agent.refresh()) || agent.status !== 'idle' || agent.activeTurn || agent.pendingPermissions?.length)
      throw new TeamError('ACTIVE_STEP', 'Native role must be idle without pending permissions');
    // Native imports are explicit and bounded. Never reconcile or resend a workflow operation here.
    const page = await agent.timeline.refetch({ direction: 'before', limit: 100, projection: 'canonical' });
    if (page.reset || page.gap || page.staleCursor || !page.endCursor)
      throw new TeamError('TIMELINE_CHANGED', 'Native timeline is incomplete or changed');
    const promptIndex = page.entries.findLastIndex((e) => e.item.type === 'user_message');
    const prompt = page.entries[promptIndex];
    if (!prompt || prompt.item.type !== 'user_message' || prompt.item.text.includes('[agent-teams-operation:'))
      throw new TeamError(
        'NATIVE_TURN_REQUIRED',
        'The latest prompt must be a native user turn visible in the last 100 entries',
      );
    const replies = page.entries.slice(promptIndex + 1).filter((e) => e.item.type === 'assistant_message');
    const last = replies.at(-1);
    if (
      !last?.turnId ||
      replies.some((e) => e.turnId !== last.turnId) ||
      (prompt.turnId && prompt.turnId !== last.turnId)
    )
      throw new TeamError('NATIVE_RESULT_AMBIGUOUS', 'No uniquely identified native response');
    // Accept the complete final object only. Earlier commentary is not a proposal.
    if (last.item.type !== 'assistant_message') throw new TeamError('NATIVE_RESULT_MISSING', 'No native reply');
    if (Buffer.byteLength(last.item.text) > 256 * 1024 || Buffer.byteLength(prompt.item.text) > 256 * 1024)
      throw new TeamError('NATIVE_RESULT_TOO_LARGE', 'Native exchange exceeds 256 KiB per message');
    return {
      text: last.item.text,
      prompt: prompt.item.text,
      source: { epoch: page.endCursor.epoch, seq: last.seqEnd, turnId: last.turnId },
    };
  }
  private async history(agent: PaseoAgentHandle) {
    let page = await agent.timeline.refetch({ direction: 'before', limit: 100, projection: 'canonical' });
    let entries = [...page.entries];
    const cursor = page.endCursor ?? undefined;
    while (page.hasOlder && page.startCursor) {
      page = await agent.timeline.refetch({
        direction: 'before',
        cursor: page.startCursor,
        limit: 100,
        projection: 'canonical',
      });
      if (page.reset || page.gap || page.staleCursor)
        throw new TeamError('TIMELINE_CHANGED', 'Timeline history changed while reconciling');
      entries = [...page.entries, ...entries];
    }
    return { entries, cursor };
  }
  /** Tool calls the role session made while handling one plugin operation, newest last. */
  async activity(w: Workflow, role: Role, operationId: string): Promise<RoleAction[]> {
    const id = w.agents[role];
    if (!id) return [];
    // Bounded read: a very long turn can push its prompt out of the page; the row then keeps only its result.
    const page = await this.api.agents
      .ref(id)
      .timeline.refetch({ direction: 'before', limit: 200, projection: 'canonical' });
    const marker = `[agent-teams-operation:${operationId}]`;
    const start = page.entries.findLastIndex((e) => e.item.type === 'user_message' && e.item.text.startsWith(marker));
    if (start < 0) return [];
    const calls = new Map<string, RoleAction>();
    for (const entry of page.entries.slice(start + 1)) {
      if (entry.item.type === 'user_message') break;
      if (entry.item.type === 'tool_call') calls.set(entry.item.callId, describeToolCall(entry.item));
    }
    return [...calls.values()];
  }
  async tests(w: Workflow, signal: AbortSignal) {
    if (!w.testsApproved || !w.plan) throw new TeamError('TESTS_NOT_APPROVED', 'Test commands are not approved');
    const results = [];
    for (const command of w.plan.tests) {
      if (signal.aborted) break;
      results.push(await runCommand(w.cwd, command, signal, w.config.testEnvironmentKeys));
    }
    return results;
  }
  async context(w: Workflow) {
    return repositoryContext(w);
  }
  async fingerprint(w: Workflow) {
    return scopeFingerprint(w);
  }
  async canClose(w: Workflow) {
    for (const id of Object.values(w.agents)) {
      if (!id) continue;
      const handle = this.api.agents.ref(id);
      if (
        !(await handle.refresh()) ||
        handle.status === 'running' ||
        handle.status === 'initializing' ||
        handle.activeTurn ||
        handle.pendingPermissions?.length
      )
        return false;
    }
    return true;
  }
  async publish(w: Workflow) {
    const api = this.nativeApi();
    if (!api || !w.agents.planner) return;
    await api.agents.ref(w.agents.planner).timeline.append({
      type: 'plugin',
      id: `${w.id}-${w.phase}-${w.cycle}`,
      kind: 'agent-teams-progress',
      version: 1,
      data: {
        workflowId: w.id,
        ...(w.workspaceId ? { workspaceId: w.workspaceId } : {}),
        ...(w.config ? { maxCorrections: w.config.maxCorrections } : {}),
        ...(w.handoffTokens != null ? { handoffTokens: w.handoffTokens } : {}),
        status: `${w.phase} · ${w.status}`,
        cycle: w.cycle,
        detail: (w.error ?? w.review?.summary ?? w.build?.summary ?? w.plan?.summary ?? w.task).slice(0, 8000),
      },
    });
  }
}

const clip = (text: string, max = 140) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
export function describeToolCall(item: Extract<AgentTimelineItem, { type: 'tool_call' }>): RoleAction {
  const d = item.detail;
  switch (d.type) {
    case 'shell':
      return { toolName: 'Shell', summary: clip(d.command) };
    case 'read':
      return { toolName: 'Read', summary: d.filePath };
    case 'edit':
      return { toolName: 'Edit', summary: d.filePath };
    case 'write':
      return { toolName: 'Write', summary: d.filePath };
    case 'search':
      return { toolName: 'Search', summary: clip(d.query) };
    case 'fetch':
      return { toolName: 'Fetch', summary: clip(d.url) };
    case 'sub_agent':
      return { toolName: 'Agent', summary: clip(d.description ?? d.subAgentType ?? '') || undefined };
    case 'plain_text':
      return { toolName: clip(d.label ?? item.name, 40), summary: d.text ? clip(d.text) : undefined };
    default:
      return { toolName: clip(item.name, 40) };
  }
}
