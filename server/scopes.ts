import { isAbsolute, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { TeamError } from '../shared/errors';
import { repository, repositoryPreflight } from './git';
import type { Workflow } from '../shared/contracts';
export type RepositoryTarget = { root: string; lock: string };
export function repositoryLocks(scope: { repo: string; repositoryTargets?: RepositoryTarget[] }) {
  return [...new Set(scope.repositoryTargets?.length ? scope.repositoryTargets.map((r) => r.lock) : [scope.repo])];
}
export function scopesOverlap(
  a: { repo: string; repositoryTargets?: RepositoryTarget[] },
  b: { repo: string; repositoryTargets?: RepositoryTarget[] },
) {
  const keys = new Set(repositoryLocks(a));
  return repositoryLocks(b).some((key) => keys.has(key));
}
export async function resolveRepositories(cwd: string, paths?: string[]) {
  let candidates = paths;
  if (!candidates) {
    const preflight = await repositoryPreflight(cwd);
    candidates = preflight.gitRoot ? [preflight.gitRoot] : preflight.repositories;
  }
  if (!candidates.length)
    throw new TeamError('REPOSITORIES_REQUIRED', 'Choose at least one accessible Git repository for this workspace.');
  if (candidates.length > 20) throw new TeamError('REPOSITORY_LIMIT', 'Select at most 20 repositories per workflow.');
  const targets = await Promise.all(candidates.map((path) => repository(isAbsolute(path) ? path : resolve(cwd, path))));
  return [...new Map(targets.map((target) => [target.root, target])).values()].sort((a, b) =>
    a.root.localeCompare(b.root),
  );
}
/** Scope is frozen at launch. Never absorb a repository the agent happened to discover later. */
export async function workflowRepositories(w: Workflow) {
  const saved = w.repositoryTargets?.length ? w.repositoryTargets : [await repository(w.cwd)];
  for (const target of saved) {
    const current = await repository(target.root);
    if (current.lock !== target.lock || (await realpath(target.root)) !== current.root)
      throw new TeamError('REPOSITORY_CHANGED', 'A saved repository moved or its Git identity changed.');
  }
  return saved;
}
