import { TeamError } from '../shared/errors';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readlink, realpath, readdir } from 'node:fs/promises';
import { join } from 'node:path';
const exec = promisify(execFile);
const LIMIT = 20 * 1024 * 1024;
export async function git(cwd: string, args: string[], maxBuffer = LIMIT) {
  return (await exec('git', ['-C', cwd, ...args], { maxBuffer, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }))
    .stdout;
}
async function gitHash(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', cwd, ...args], {
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const hash = createHash('sha256');
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => hash.update(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-64 * 1024);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`git ${args.join(' ')} exited with ${code}: ${stderr}`));
      else resolve(hash.digest('hex'));
    });
  });
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
    const found: string[] = [];
    const queue = [{ path: cwd, depth: 0 }];
    const excluded = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'venv', '__pycache__']);
    let visited = 0,
      truncated = false;
    while (queue.length && visited < 300 && found.length < 50) {
      const current = queue.shift()!;
      visited++;
      if (current.depth > 0) {
        try {
          await lstat(join(current.path, '.git'));
          found.push((await repository(current.path)).root);
          continue;
        } catch {}
      }
      if (current.depth >= 4) {
        truncated = true;
        continue;
      }
      const entries = await readdir(current.path, { withFileTypes: true }).catch(() => []);
      const children = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !excluded.has(e.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      const capacity = Math.max(0, 300 - visited - queue.length);
      if (children.length > capacity) truncated = true;
      for (const entry of children.slice(0, capacity))
        queue.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
    }
    return {
      gitRoot: null,
      ...(found.length ? {} : { launchIssue: String(error) }),
      repositories: [...new Set(found)],
      searchTruncated: truncated || queue.length > 0,
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
    git(cwd, ['status', '--porcelain=v1', '-z'], Infinity),
    gitHash(cwd, ['diff', '--cached', '--binary', '--no-ext-diff']),
    gitHash(cwd, ['diff', '--binary', '--no-ext-diff']),
    git(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], Infinity),
  ]);
  const files: Snapshot['files'] = {};
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

/** Compact, bounded view of the working tree against HEAD: stat summary plus a truncated textual diff. */
export async function workingDiff(cwd: string, head: string, limit = 24 * 1024) {
  const base = head === 'unborn' ? [] : [head];
  const run = async (extra: string[]) =>
    head === 'unborn'
      ? (await git(cwd, ['diff', '--cached', '--no-ext-diff', ...extra]).catch(() => '')) +
        (await git(cwd, ['diff', '--no-ext-diff', ...extra]).catch(() => ''))
      : await git(cwd, ['diff', '--no-ext-diff', ...extra, ...base]).catch(() => '');
  const [stat, diff] = await Promise.all([run(['--stat=100']), run([])]);
  const truncated = Buffer.byteLength(diff) > limit;
  return {
    stat: stat.trim(),
    diff: truncated ? Buffer.from(diff).subarray(0, limit).toString('utf8') + '\n[diff truncated]' : diff,
  };
}
