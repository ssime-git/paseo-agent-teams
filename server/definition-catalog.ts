import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { definitionRecordSchema, saveDefinitionRpc, type DefinitionRecord } from '../shared/definition-catalog';
import { TeamError } from '../shared/errors';

// Separate from V1 execution files: definitions never reinterpret running workflows.
// Revisions are immutable. An atomic hard link publishes a fully written file and
// arbitrates competing writers across catalog instances without removable locks.
export class DefinitionCatalog {
  constructor(readonly directory: string) {}

  private path(id: string) {
    const parsed = definitionRecordSchema.shape.id.parse(id);
    return join(this.directory, parsed);
  }

  private async records(id: string): Promise<DefinitionRecord[]> {
    const directory = this.path(id);
    let files: string[];
    try {
      files = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    try {
      const records: DefinitionRecord[] = [];
      for (const file of files) {
        if (file.endsWith('.tmp')) continue; // Never remove another writer's temporary file.
        if (!/^[1-9][0-9]*\.json$/.test(file)) throw new Error('Unexpected catalog file');
        const record = definitionRecordSchema.parse(JSON.parse(await readFile(join(directory, file), 'utf8')));
        if (record.id !== id || file !== `${record.revision}.json`) throw new Error('Revision identity mismatch');
        records.push(record);
      }
      records.sort((a, b) => a.revision - b.revision);
      for (let i = 0; i < records.length; i++) {
        if (records[i].revision !== i + 1 || records[i].workspaceId !== records[0].workspaceId)
          throw new Error('Revision history mismatch');
      }
      return records;
    } catch (cause) {
      throw new TeamError('CORRUPT_DEFINITION', 'Saved workflow definition is corrupt; repair it before editing.', {
        cause,
      });
    }
  }

  async history(id: string, workspaceId: string) {
    const records = await this.records(id);
    if (!records.length) throw new TeamError('DEFINITION_NOT_FOUND', 'Workflow definition not found');
    if (records[0].workspaceId !== workspaceId)
      throw new TeamError('WORKSPACE_ACCESS_DENIED', 'Workspace access denied');
    return records;
  }

  async list(workspaceId: string) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const records: DefinitionRecord[] = [];
    for (const entry of await readdir(this.directory)) {
      const history = await this.records(entry);
      const latest = history.at(-1);
      if (latest?.workspaceId === workspaceId) records.push(latest);
    }
    return records.sort((a, b) => a.definition.name.localeCompare(b.definition.name) || a.id.localeCompare(b.id));
  }

  async save(raw: unknown) {
    const input = saveDefinitionRpc.input.parse(raw);
    if (!input.id && input.expectedRevision !== 0)
      throw new TeamError('DEFINITION_CONFLICT', 'A new definition requires revision zero');
    const id = input.id ?? randomUUID();
    const previous = input.id ? (await this.history(id, input.workspaceId)).at(-1)! : undefined;
    if ((previous?.revision ?? 0) !== input.expectedRevision)
      throw new TeamError('DEFINITION_CONFLICT', 'Workflow definition changed; reload before saving');
    const record = definitionRecordSchema.parse({
      version: 1,
      id,
      workspaceId: input.workspaceId,
      revision: input.expectedRevision + 1,
      savedAt: new Date().toISOString(),
      definition: input.definition,
    });
    const directory = this.path(id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx', flush: true });
      try {
        await link(temporary, join(directory, `${record.revision}.json`));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw new TeamError('DEFINITION_CONFLICT', 'Workflow definition changed; reload before saving');
        throw error;
      }
    } finally {
      await rm(temporary, { force: true });
    }
    return record;
  }
}
