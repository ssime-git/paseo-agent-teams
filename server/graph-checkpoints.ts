import { link, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import {
  createGraphCheckpoint,
  decideGraphHuman,
  consumeGraphEvidence,
  claimGraphTests,
  completeGraphTests,
  bindGraphDispatch,
  claimGraphDispatch,
  recordGraphReceipt,
  assessGraphReceipt,
  recordGraphIntegrity,
  graphCheckpointSchema,
  reserveGraphActivation,
  resolveGraphActivation,
  resolveGraphArtifact,
  type GraphCheckpoint,
  type GraphOutcome,
} from '../shared/graph-checkpoint';
import { TeamError } from '../shared/errors';

// Foundation only: no dispatch or launch API yet. Keep outside Store's V1 JSON
// namespace. Immutable revisions arbitrate writers without deleting any locks.
export class GraphCheckpoints {
  constructor(readonly directory: string) {}

  private path(id: string) {
    return join(this.directory, z.uuid().parse(id));
  }

  async get(id: string, workspaceId: string): Promise<GraphCheckpoint> {
    const state = await this.read(id);
    if (state.source.workspaceId !== workspaceId)
      throw new TeamError('WORKSPACE_ACCESS_DENIED', 'Workspace access denied');
    return state;
  }

  // Admission must inspect every workspace; this is internal, never an unscoped RPC.
  async all(): Promise<GraphCheckpoint[]> {
    let entries;
    try {
      entries = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    try {
      return await Promise.all(entries.map((id) => this.read(id)));
    } catch (error) {
      throw new TeamError('CORRUPT_GRAPH', `Graph state may hold a repository lock: ${String(error)}`);
    }
  }

  private async read(id: string): Promise<GraphCheckpoint> {
    const directory = this.path(id);
    const files = (await readdir(directory)).filter((file) => !file.endsWith('.tmp'));
    if (!files.length) throw new TeamError('GRAPH_NOT_FOUND', 'Graph checkpoint not found');
    if (files.some((file) => !/^[1-9][0-9]*\.json$/.test(file)))
      throw new TeamError('CORRUPT_GRAPH', 'Unexpected graph checkpoint file');
    files.sort((a, b) => Number.parseInt(a) - Number.parseInt(b));
    for (let i = 0; i < files.length; i++)
      if (files[i] !== `${i + 1}.json`) throw new TeamError('CORRUPT_GRAPH', 'Incomplete graph checkpoint history');
    const state = graphCheckpointSchema.parse(JSON.parse(await readFile(join(directory, files.at(-1)!), 'utf8')));
    if (state.id !== id || state.revision !== files.length)
      throw new TeamError('CORRUPT_GRAPH', 'Graph checkpoint identity mismatch');
    return state;
  }

  private async publish(state: GraphCheckpoint) {
    const directory = this.path(state.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600, flush: true });
      try {
        await link(temporary, join(directory, `${state.revision}.json`));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw new TeamError('GRAPH_CONFLICT', 'Graph checkpoint changed; reload before retrying');
        throw error;
      }
    } finally {
      await rm(temporary, { force: true });
    }
    return state;
  }

  async create(input: Parameters<typeof createGraphCheckpoint>[0]) {
    return this.publish(createGraphCheckpoint(input));
  }

  async reserve(id: string, workspaceId: string, expectedRevision: number, operationId: string) {
    return this.update(id, workspaceId, expectedRevision, (state) => reserveGraphActivation(state, operationId));
  }

  async bindDispatch(
    id: string,
    workspaceId: string,
    expectedRevision: number,
    operationId: string,
    dispatch: NonNullable<GraphCheckpoint['activations'][number]['dispatch']>,
  ) {
    return this.update(id, workspaceId, expectedRevision, (state) => bindGraphDispatch(state, operationId, dispatch));
  }

  async claimDispatch(
    id: string,
    workspaceId: string,
    expectedRevision: number,
    operationId: string,
    attemptId: string,
    baseline?: string,
  ) {
    return this.update(id, workspaceId, expectedRevision, (state) =>
      claimGraphDispatch(state, operationId, attemptId, baseline),
    );
  }

  async receipt(
    id: string,
    workspaceId: string,
    expectedRevision: number,
    operationId: string,
    receipt: Parameters<typeof recordGraphReceipt>[2],
  ) {
    return this.update(id, workspaceId, expectedRevision, (state) => recordGraphReceipt(state, operationId, receipt));
  }

  async resolve(
    id: string,
    workspaceId: string,
    expectedRevision: number,
    operationId: string,
    result: { outcome: GraphOutcome; summary: string },
  ) {
    return this.update(id, workspaceId, expectedRevision, (state) =>
      resolveGraphActivation(state, operationId, result),
    );
  }

  async decideHuman(
    id: string,
    workspaceId: string,
    expectedRevision: number,
    operationId: string,
    decision: Parameters<typeof decideGraphHuman>[2],
  ) {
    return this.update(id, workspaceId, expectedRevision, (state) => decideGraphHuman(state, operationId, decision));
  }

  async assessReceipt(id: string, workspaceId: string, expectedRevision: number, operationId: string) {
    return this.update(id, workspaceId, expectedRevision, (state) => assessGraphReceipt(state, operationId));
  }

  async recordIntegrity(
    id: string,
    workspaceId: string,
    expectedRevision: number,
    operationId: string,
    fingerprint: string,
  ) {
    return this.update(id, workspaceId, expectedRevision, (state) =>
      recordGraphIntegrity(state, operationId, fingerprint),
    );
  }

  async claimTests(
    id: string,
    workspaceId: string,
    expectedRevision: number,
    operationId: string,
    attemptId: string,
    fingerprint: string,
  ) {
    return this.update(id, workspaceId, expectedRevision, (state) =>
      claimGraphTests(state, operationId, attemptId, fingerprint),
    );
  }

  async completeTests(
    id: string,
    workspaceId: string,
    expectedRevision: number,
    operationId: string,
    attemptId: string,
    completion: Parameters<typeof completeGraphTests>[3],
  ) {
    return this.update(id, workspaceId, expectedRevision, (state) =>
      completeGraphTests(state, operationId, attemptId, completion),
    );
  }

  async consumeEvidence(
    id: string,
    workspaceId: string,
    expectedRevision: number,
    operationId: string,
    fingerprint: string,
  ) {
    return this.update(id, workspaceId, expectedRevision, (state) =>
      consumeGraphEvidence(state, operationId, fingerprint),
    );
  }

  async resolveArtifact(id: string, workspaceId: string, expectedRevision: number, operationId: string, text: string) {
    return this.update(id, workspaceId, expectedRevision, (state) => resolveGraphArtifact(state, operationId, text));
  }

  private async update(
    id: string,
    workspaceId: string,
    expectedRevision: number,
    change: (state: GraphCheckpoint) => GraphCheckpoint,
  ) {
    const current = await this.get(id, workspaceId);
    const next = change(current);
    if (next.revision === current.revision) return current; // Idempotent replay, including stale response retries.
    if (current.revision !== expectedRevision)
      throw new TeamError('GRAPH_CONFLICT', 'Graph checkpoint changed; reload before retrying');
    return this.publish(next);
  }
}
