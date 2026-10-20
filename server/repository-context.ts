import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { TeamError } from '../shared/errors';
import type { Workflow } from '../shared/contracts';
import { snapshot, changes, workingDiff, type Snapshot } from './git';
import { workflowRepositories, type RepositoryTarget } from './scopes';
export type ScopeSnapshot = { version: 2; repositories: (RepositoryTarget & { snapshot: Snapshot })[] };
export async function captureRepositories(targets: RepositoryTarget[]): Promise<Snapshot | ScopeSnapshot> {
  const entries = [];
  for (const target of targets) entries.push({ ...target, snapshot: await snapshot(target.root) });
  return entries.length === 1 ? entries[0].snapshot : { version: 2, repositories: entries };
}
export async function scopeFingerprint(w: Workflow) {
  return createHash('sha256')
    .update(JSON.stringify(await captureRepositories(await workflowRepositories(w))))
    .digest('hex');
}
export async function repositoryContext(w: Workflow) {
  const targets = await workflowRepositories(w);
  let saved: Snapshot | ScopeSnapshot | undefined;
  try {
    saved = JSON.parse(await readFile(w.baseline, 'utf8')) as Snapshot | ScopeSnapshot;
  } catch (error) {
    if (w.phase !== 'followup' || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const entries = [];
  for (const target of targets) {
    const after = await snapshot(target.root);
    const before =
      saved &&
      ('version' in saved
        ? saved.repositories.find((r) => r.root === target.root && r.lock === target.lock)?.snapshot
        : saved);
    if (saved && !before)
      throw new TeamError('BASELINE_SCOPE_CHANGED', 'A repository is missing from the saved launch snapshot.');
    if (before)
      for (const file of Object.values(before.files))
        if (file.kind === 'file' && !/^[a-f0-9]{64}$/.test(file.content))
          file.content = createHash('sha256').update(Buffer.from(file.content, 'base64')).digest('hex');
    const { stat, diff } = await workingDiff(target.root, after.head, Math.floor((20 * 1024) / targets.length));
    entries.push({
      ...(targets.length > 1 ? { root: target.root } : {}),
      ...(before
        ? {
            note: 'Compact view. Read files yourself for anything not shown; the diff is truncated.',
            initialHead: before.head,
            initialStatus: before.status.slice(0, Math.floor(4096 / targets.length)),
            changedFiles: changes(before, after)
              .slice(0, 100)
              .map((c) => ({ path: c.path, change: !c.before ? 'added' : !c.after ? 'deleted' : 'modified' })),
          }
        : {
            warning:
              'The launch baseline was removed after completion. Ownership of uncommitted changes cannot be proved. Do not stage or commit uncommitted files; report this blocker if a PR needs them.',
            currentStatus: after.status.slice(0, 4096),
          }),
      currentHead: after.head,
      diffStat: stat,
      diff,
    });
  }
  const result = JSON.stringify(entries.length === 1 ? entries[0] : { workspaceRoot: w.cwd, repositories: entries });
  return Buffer.byteLength(result) <= 32 * 1024
    ? result
    : Buffer.from(result)
        .subarray(0, 32 * 1024)
        .toString('utf8') + '\n[Repository context truncated]';
}
