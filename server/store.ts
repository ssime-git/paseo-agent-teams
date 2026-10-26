import { isDeepStrictEqual } from 'node:util';
import { TeamError } from '../shared/errors';
import { mkdir, readFile, readdir, rename, writeFile, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GraphCheckpoints } from './graph-checkpoints';
import { scopesOverlap } from './scopes';
import type { createGraphCheckpoint } from '../shared/graph-checkpoint';
import { workflowSchema, type Workflow } from '../shared/contracts';

export function migrateWorkflow(raw: unknown): Workflow {
  const w = workflowSchema.parse(raw);
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
  for (const event of w.events) {
    if (!event.kind.startsWith('receipt:')) continue;
    w.receipts ??= {};
    w.receipts[event.kind.slice('receipt:'.length)] ??= event.text;
  }
  w.events = w.events.filter((event) => !event.kind.startsWith('receipt:'));
  return w;
}

export class Store {
  private cache = new Map<string, Workflow>();
  private agents = new Map<string, Set<string>>();
  private initialization?: Promise<void>;
  private corrupt = false;
  private corruptRepositories = new Set<string>();
  // One Store owns the plugin's V1 cache and all repository admissions.
  private admission: Promise<unknown> = Promise.resolve();
  readonly graphs: GraphCheckpoints;
  constructor(readonly directory: string) {
    this.graphs = new GraphCheckpoints(join(directory, 'graphs'));
  }
  async withRepositoryAdmission<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.admission.then(fn);
    this.admission = next.catch(() => {});
    return next;
  }

  // Internal admission only, not a launcher: callers must resolve the canonical
  // Git common-directory identity and validate native permissions before dispatch.
  async createGraph(input: Parameters<typeof createGraphCheckpoint>[0]) {
    return this.withRepositoryAdmission(async () => {
      if (input.admission) {
        const existing = (await this.graphs.all()).find((graph) => graph.id === input.id);
        if (existing) {
          if (
            existing.repo !== input.repo ||
            existing.task !== input.task ||
            !isDeepStrictEqual(existing.source, input.source) ||
            !isDeepStrictEqual(existing.admission, input.admission)
          )
            throw new TeamError('GRAPH_CONFLICT', 'Graph admission was already used differently');
          return existing;
        }
      }
      await this.assertCanCreate(input.repo);
      const blocker = (await this.all()).find((w) => w.status !== 'completed' && scopesOverlap(w, input));
      if (blocker) throw new TeamError('REPOSITORY_LOCKED', `Another workflow holds this repository: ${blocker.id}`);
      return this.graphs.create(input);
    });
  }
  async init() {
    this.initialization ??= this.load();
    return this.initialization;
  }
  private async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const file of await readdir(this.directory)) {
      if (file.endsWith('.tmp')) {
        await rm(join(this.directory, file), { force: true });
        continue;
      }
      if (file.endsWith('.corrupt')) await this.reserveCorrupt(file);
      if (!file.endsWith('.json')) continue;
      try {
        const w = migrateWorkflow(JSON.parse(await readFile(join(this.directory, file), 'utf8')));
        if (file !== `${w.id}.json`) throw new TeamError('STATE_FILENAME_MISMATCH', 'Workflow filename mismatch');
        this.cache.set(w.id, w);
        this.indexAgents(w);
      } catch (error) {
        await this.reserveCorrupt(file);
        await rename(join(this.directory, file), join(this.directory, `${file}.${randomUUID()}.corrupt`));
        console.error('Agent Teams quarantined corrupt state:', file, error);
      }
    }
  }
  private indexAgents(w: Workflow) {
    for (const ids of this.agents.values()) ids.delete(w.id);
    for (const id of Object.values(w.agents)) {
      if (!id) continue;
      const ids = this.agents.get(id) ?? new Set<string>();
      ids.add(w.id);
      this.agents.set(id, ids);
    }
  }
  async forAgent(agentId: string) {
    await this.init();
    return [...(this.agents.get(agentId) ?? [])];
  }
  private async reserveCorrupt(file: string) {
    try {
      const raw: unknown = JSON.parse(await readFile(join(this.directory, file), 'utf8'));
      if (raw && typeof raw === 'object' && 'repo' in raw && typeof raw.repo === 'string' && isAbsolute(raw.repo)) {
        this.corruptRepositories.add(raw.repo);
        if ('repositoryTargets' in raw) {
          if (!Array.isArray(raw.repositoryTargets) || !raw.repositoryTargets.length) this.corrupt = true;
          else
            for (const target of raw.repositoryTargets) {
              if (target && typeof target === 'object' && typeof target.lock === 'string' && isAbsolute(target.lock))
                this.corruptRepositories.add(target.lock);
              else this.corrupt = true;
            }
        }
      } else this.corrupt = true;
    } catch {
      this.corrupt = true;
    }
  }
  async assertCanCreate(repo?: string) {
    await this.init();
    const graphs = await this.graphs.all();
    const blocker = graphs.find(
      (graph) => graph.repo === repo && ['ready', 'running', 'waiting_human'].includes(graph.status),
    );
    if (blocker) throw new TeamError('REPOSITORY_LOCKED', `Another graph holds this repository: ${blocker.id}`);
    if (this.corrupt || (repo !== undefined && this.corruptRepositories.has(repo)))
      throw new TeamError(
        'CORRUPT_STATE',
        'Corrupt workflow state may hold a repository lock. Repair quarantined state before creating workflows.',
      );
  }
  private path(id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new TeamError('INVALID_WORKFLOW_ID', 'Invalid workflow ID');
    return join(this.directory, `${id}.json`);
  }
  async get(id: string): Promise<Workflow> {
    this.path(id);
    await this.init();
    const w = this.cache.get(id);
    if (!w) throw new TeamError('WORKFLOW_NOT_FOUND', 'Workflow not found');
    return structuredClone(w);
  }
  async authorize(id: string, workspaceId: string | undefined) {
    const w = await this.get(id);
    if (!workspaceId || w.workspaceId !== workspaceId)
      throw new TeamError('WORKSPACE_ACCESS_DENIED', 'Workspace access denied');
    return w;
  }
  async all() {
    await this.init();
    return [...this.cache.values()].map((w) => structuredClone(w));
  }
  async put(workflow: Workflow) {
    await this.init();
    const parsed = workflowSchema.parse(workflow);
    const target = this.path(workflow.id),
      temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(parsed), { mode: 0o600, flush: true });
    await rename(temp, target);
    this.cache.set(parsed.id, structuredClone(parsed));
    this.indexAgents(parsed);
  }
}
