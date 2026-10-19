import type { PaseoApi, PaseoAgentHandle } from '@getpaseo/client';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { join, sep, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { roles, type Config, type Role, type Workflow } from '../shared/contracts';
import { repository, snapshot, changes, type Snapshot } from './git';
import { runCommand } from './commands';
import type { Outcome, Runtime } from './engine';

export const readOnlyMode = (provider: string, modeId: string) => (provider === 'claude' && modeId === 'plan') || (provider === 'codex' && modeId === 'read-only');
export class PaseoRuntime implements Runtime {
  constructor(private api: PaseoApi, private directory: string, private nativeApi: () => PaseoApi | undefined = () => api) {}
  async prepare(workspaceId: string, config: Config) {
    const workspace = await this.api.workspaces.ref(workspaceId).refresh();
    if (!workspace) throw new Error('Workspace no longer exists');
    const actualCwd = workspace.workspaceDirectory;
    if (!actualCwd) throw new Error('Workspace has no directory');
    const discovered = await this.api.providers.waitForReady({ cwd: actualCwd });
    for (const role of roles) {
      const selection = config.roles[role], separator = selection.provider.indexOf('/');
      const harness = selection.provider.slice(0, separator), model = selection.provider.slice(separator + 1);
      if (!['claude', 'codex'].includes(harness)) throw new Error('V1 supports Claude Code and Codex');
      const entry = discovered.entries.find(e => e.provider === harness && e.status === 'ready');
      if (!entry?.models?.some(m => m.id === model)) throw new Error(`Unavailable provider/model: ${selection.provider}`);
      const modes = await this.api.providers.listModes(harness, { cwd: actualCwd });
      if (!modes.modes?.some(m => m.id === selection.modeId)) throw new Error(`Unavailable mode: ${selection.modeId}`);
      if (role !== 'builder' && !readOnlyMode(harness, selection.modeId)) throw new Error(`${role} requires Claude plan or Codex read-only mode`);
    }
    const repo = await repository(actualCwd);
    if (!isAbsolute(this.directory)) throw new Error('The data directory must be absolute');
    const dataPath = await realpath(this.directory);
    if (dataPath === repo.root || dataPath.startsWith(repo.root + sep)) throw new Error('The data directory must be outside the workspace repository');
    const baseline = join(this.directory, `baseline-${crypto.randomUUID()}.snapshot`);
    await writeFile(baseline, JSON.stringify(await snapshot(repo.root)), { mode: 0o600, flush: true });
    return { cwd: actualCwd, repo: repo.lock, baseline };
  }
  async agent(w: Workflow, role: Role) {
    const agent = await this.api.workspaces.ref(w.workspaceId).agents.create({
      idempotencyKey: `${w.id}-${role}`, config: { ...w.config.roles[role], systemPrompt: role === 'builder' ? 'Preserve existing user changes. Only edit files required for the task.' : 'Read-only role: analyze and report. Never edit repository files.' },
      title: `Agent Teams · ${role}`, labels: { 'agent-teams-workflow': w.id, 'agent-teams-role': role },
    });
    return agent.id;
  }
  async run(w: Workflow, role: Role, prompt: string, operationId: string): Promise<Outcome> {
    const agent = this.api.agents.ref(w.agents[role]!); await agent.refresh();
    if (agent.status === 'running' || agent.pendingPermissions?.length) return { status: 'uncertain', error: 'Agent is already busy. Open its native session before resuming.' };
    const result = await agent.run(`[agent-teams-operation:${operationId}]\n${prompt}`, { messageId: operationId, activeTurnBehavior: 'steer', timeoutMs: 60_000 });
    return { status: result.status, text: result.lastMessage ?? undefined, error: result.error ?? undefined };
  }
  async reconcile(w: Workflow): Promise<Outcome> {
    const op = w.operation!;
    const agent = this.api.agents.ref(w.agents[op.role]!);
    if (!await agent.refresh()) return { status: 'uncertain', error: 'Saved agent is missing; operation will not be resent' };
    if (agent.pendingPermissions?.length) return { status: 'permission' };
    const history = await this.history(agent);
    const index = history.entries.findIndex(e => e.item.type === 'user_message' && (e.item.messageId === op.id || e.item.clientMessageId === op.id || e.item.text.includes(`[agent-teams-operation:${op.id}]`)));
    if (index < 0) return { status: 'uncertain', error: 'Cannot prove that the saved prompt was accepted; inspect the native session' };
    if (history.entries.slice(index + 1).some(e => e.item.type === 'user_message')) return { status: 'uncertain', error: 'Another prompt was sent to this session; review it before continuing' };
    const cursor = history.cursor;
    if (agent.status === 'running' && agent.activeTurn) {
      const result = await agent.waitForFinish(60_000);
      return { status: result.status, text: result.lastMessage ?? undefined, error: result.error ?? undefined, cursor };
    }
    // A stored hook receipt proves completion; idle alone does not.
    const receipt = w.events.find(e => e.kind === `receipt:${op.id}`);
    if (receipt) {
      const result = JSON.parse(receipt.text) as Outcome;
      return { ...result, cursor };
    }
    return { status: 'uncertain', error: 'No durable completion receipt. The operation is retained and will not be replayed.', cursor };
  }
  private async history(agent: PaseoAgentHandle) {
    let page = await agent.timeline.refetch({ direction: 'before', limit: 100, projection: 'canonical' });
    let entries = [...page.entries]; const cursor = page.endCursor ?? undefined;
    while (page.hasOlder && page.startCursor) {
      page = await agent.timeline.refetch({ direction: 'before', cursor: page.startCursor, limit: 100, projection: 'canonical' });
      if (page.reset || page.gap || page.staleCursor) throw new Error('Timeline history changed while reconciling');
      entries = [...page.entries, ...entries];
    }
    return { entries, cursor };
  }
  async tests(w: Workflow, signal: AbortSignal) {
    if (!w.testsApproved || !w.plan) throw new Error('Test commands are not approved');
    const results = [];
    for (const command of w.plan.tests) {
      if (signal.aborted) break;
      results.push(await runCommand(w.cwd, command, signal));
    }
    return results;
  }
  async context(w: Workflow) {
    const root = (await repository(w.cwd)).root;
    const before = JSON.parse(await readFile(w.baseline, 'utf8')) as Snapshot, after = await snapshot(root);
    return JSON.stringify({ encoding: 'File contents are base64; symlink contents are link targets.', initialHead: before.head, initialStatus: before.status, initialStagedDiff: before.staged, initialUnstagedDiff: before.unstaged,
      currentHead: after.head, currentStagedDiff: after.staged, currentUnstagedDiff: after.unstaged, changesSinceStart: changes(before, after) });
  }
  async fingerprint(w: Workflow) {
    return createHash('sha256').update(JSON.stringify(await snapshot((await repository(w.cwd)).root))).digest('hex');
  }
  async canClose(w: Workflow) {
    for (const id of Object.values(w.agents)) {
      if (!id) continue;
      const handle = this.api.agents.ref(id);
      if (!await handle.refresh() || handle.status === 'running' || handle.status === 'initializing' || handle.pendingPermissions?.length) return false;
    }
    return true;
  }
  async publish(w: Workflow) {
    const api = this.nativeApi();
    if (!api || !w.agents.planner) return;
    await api.agents.ref(w.agents.planner).timeline.append({ type: 'plugin', id: `${w.id}-${w.phase}-${w.cycle}`, kind: 'agent-teams-progress', version: 1,
      data: { workflowId: w.id, status: `${w.phase} · ${w.status}`, cycle: w.cycle, detail: (w.error ?? w.review?.summary ?? w.build?.summary ?? w.plan?.summary ?? w.task).slice(0, 8000) } });
  }
}
