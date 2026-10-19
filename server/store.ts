import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { workflowSchema, type Workflow } from '../shared/contracts';

export class Store {
  constructor(readonly directory: string) {}
  async init() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); }
  private path(id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid workflow ID');
    return join(this.directory, `${id}.json`);
  }
  async get(id: string): Promise<Workflow> { return workflowSchema.parse(JSON.parse(await readFile(this.path(id), 'utf8'))); }
  async all() {
    await this.init();
    const files = (await readdir(this.directory)).filter(f => f.endsWith('.json'));
    // Fail closed on corrupt state; silently skipping it would lose repository locks.
    return Promise.all(files.map(f => this.get(f.slice(0, -5))));
  }
  async put(workflow: Workflow) {
    await this.init();
    const target = this.path(workflow.id), temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(workflowSchema.parse(workflow)), { mode: 0o600, flush: true });
    await rename(temp, target);
  }
}
