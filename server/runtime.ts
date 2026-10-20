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
    const agent = await this.api.workspaces.ref(w.workspaceId).agents.create({
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
          role === 'builder' && selection.modeId !== INSTRUCTION_READ_ONLY
            ? 'Preserve existing user changes. Only edit files required for the task.'
            : 'Read-only pipeline role: analyze and report. Never edit files. Do not call EnterPlanMode or ExitPlanMode or request native plan approval. Return your result directly; human checkpoints are managed by the Agent Teams plugin.',
      },
      env: { GIT_OPTIONAL_LOCKS: '0' },
      title: `Agent Teams · ${role}`,
      labels: { 'agent-teams-workflow': w.id, 'agent-teams-role': role },
    });
    return agent.id;
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
        handle.pendingPermissions?.length
      )
        return false;
    }
    return true;
  }
  async publish(w: Workflow) {
    const api = this.nativeApi();
    if (!api || !w.agents.planner) return;
    const latest = w.events.filter((e) => e.kind === 'assistant' && e.role).at(-1);
    await api.agents.ref(w.agents.planner).timeline.append({
      type: 'plugin',
      id: `${w.id}-${w.phase}-${w.cycle}`,
      kind: 'agent-teams-progress',
      version: 1,
      data: {
        workflowId: w.id,
        ...(latest?.role && latest.text.length <= 24000 ? { artifact: { role: latest.role, text: latest.text } } : {}),
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
