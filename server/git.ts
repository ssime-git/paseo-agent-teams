import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import { join } from 'node:path';
const exec = promisify(execFile);
const LIMIT = 20 * 1024 * 1024;
export async function git(cwd: string, args: string[]) { return (await exec('git', ['-C', cwd, ...args], { maxBuffer: LIMIT, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })).stdout; }
export async function repository(cwd: string) {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const common = (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
  return { root: await realpath(root), lock: await realpath(common) };
}
export interface Snapshot { head: string; status: string; staged: string; unstaged: string; files: Record<string, { kind: string; content: string; mode: number }>; }
export async function snapshot(cwd: string): Promise<Snapshot> {
  const [head, status, staged, unstaged, names] = await Promise.all([
    git(cwd, ['rev-parse', '--verify', 'HEAD']).catch(() => 'unborn'), git(cwd, ['status', '--porcelain=v1', '-z']),
    git(cwd, ['diff', '--cached', '--binary', '--no-ext-diff']), git(cwd, ['diff', '--binary', '--no-ext-diff']),
    git(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
  ]);
  const files: Snapshot['files'] = {}; let size = Buffer.byteLength(staged + unstaged);
  for (const name of new Set(names.split('\0').filter(Boolean))) {
    const path = join(cwd, name);
    let stat;
    try { stat = await lstat(path); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e; }
    if (!stat.isFile() && !stat.isSymbolicLink()) continue;
    size += stat.size;
    if (size > LIMIT) throw new Error('Repository snapshot exceeds 20 MiB; narrow the tracked/untracked working set first.');
    files[name] = { kind: stat.isSymbolicLink() ? 'symlink' : 'file', content: stat.isSymbolicLink() ? await readlink(path) : (await readFile(path)).toString('base64'), mode: stat.mode };
  }
  return { head: head.trim(), status, staged, unstaged, files };
}
export function changes(before: Snapshot, after: Snapshot) {
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].filter(name => JSON.stringify(before.files[name]) !== JSON.stringify(after.files[name])).map(name => ({ path: name, before: before.files[name] ?? null, after: after.files[name] ?? null }));
}
