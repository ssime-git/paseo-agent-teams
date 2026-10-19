import { TeamError } from '../shared/errors';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readlink, realpath, readdir } from 'node:fs/promises';
import { join } from 'node:path';
const exec = promisify(execFile);
const LIMIT = 20 * 1024 * 1024;
export async function git(cwd: string, args: string[]) {
  return (
    await exec('git', ['-C', cwd, ...args], { maxBuffer: LIMIT, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
  ).stdout;
}
export async function repository(cwd: string) {
  let root: string;
  try {
    root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  } catch (cause) {
    throw new TeamError(
      'NOT_GIT_REPOSITORY',
      `Directory is not an accessible Git repository: ${cwd}. Open the repository workspace.`,
      {
        cause,
      },
    );
  }
  const common = (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
  return { root: await realpath(root), lock: await realpath(common) };
}
export async function repositoryPreflight(cwd: string) {
  try {
    return { gitRoot: (await repository(cwd)).root, repositories: [] as string[] };
  } catch (error) {
    const entries = await readdir(cwd, { withFileTypes: true }).catch(() => []);
    const candidates = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).slice(0, 50);
    const found = await Promise.all(
      candidates.map(async (e) => {
        const path = join(cwd, e.name);
        try {
          await lstat(join(path, '.git'));
          return (await repository(path)).root;
        } catch {
          return undefined;
        }
      }),
    );
    return {
      gitRoot: null,
      launchIssue: String(error),
      repositories: [...new Set(found.filter((p): p is string => !!p))],
    };
  }
}
export interface Snapshot {
  head: string;
  status: string;
  staged: string;
  unstaged: string;
  files: Record<string, { kind: string; content: string; mode: number }>;
}
export async function snapshot(cwd: string): Promise<Snapshot> {
  const [head, status, staged, unstaged, names] = await Promise.all([
    git(cwd, ['rev-parse', '--verify', 'HEAD']).catch(() => 'unborn'),
    git(cwd, ['status', '--porcelain=v1', '-z']),
    git(cwd, ['diff', '--cached', '--binary', '--no-ext-diff']),
    git(cwd, ['diff', '--binary', '--no-ext-diff']),
    git(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
  ]);
  const files: Snapshot['files'] = {};
  let size = Buffer.byteLength(staged + unstaged);
  for (const name of new Set(names.split('\0').filter(Boolean))) {
    const path = join(cwd, name);
    let stat;
    try {
      stat = await lstat(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw e;
    }
    if (!stat.isFile() && !stat.isSymbolicLink()) continue;
    size += stat.size;
    if (size > LIMIT)
      throw new TeamError(
        'SNAPSHOT_TOO_LARGE',
        'Repository snapshot exceeds 20 MiB; narrow the tracked/untracked working set first.',
      );
    files[name] = {
      kind: stat.isSymbolicLink() ? 'symlink' : 'file',
      content: stat.isSymbolicLink() ? await readlink(path) : await hashFile(path),
      mode: stat.mode,
    };
  }
  return { head: head.trim(), status, staged, unstaged, files };
}
export function changes(before: Snapshot, after: Snapshot) {
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])]
    .filter((name) => JSON.stringify(before.files[name]) !== JSON.stringify(after.files[name]))
    .map((name) => ({ path: name, before: before.files[name] ?? null, after: after.files[name] ?? null }));
}

async function hashFile(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
