import { spawn } from 'node:child_process';
import type { Plan, TestResult } from '../shared/contracts';
export async function runCommand(cwd: string, test: Plan['tests'][number], signal?: AbortSignal): Promise<TestResult> {
  const start = Date.now(); let stdout = '', stderr = '', truncated = false, timedOut = false;
  const limit = 128 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(test.command, { cwd, shell: '/bin/sh', detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = () => { try { process.kill(-child.pid!, 'SIGTERM'); } catch {} };
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = () => { stop(); killTimer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} }, 1000); };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, test.timeoutMs);
    signal?.addEventListener('abort', terminate, { once: true });
    if (signal?.aborted) terminate();
    const collect = (previous: string, chunk: Buffer) => { const next = previous + chunk.toString(); if (next.length > limit) truncated = true; return next.slice(0, limit); };
    child.stdout.on('data', c => { stdout = collect(stdout, c); }); child.stderr.on('data', c => { stderr = collect(stderr, c); });
    const cleanup = () => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); signal?.removeEventListener('abort', terminate); };
    child.on('error', e => { cleanup(); reject(e); });
    child.on('close', exitCode => { cleanup(); resolve({ ...test, stdout, stderr, exitCode, durationMs: Date.now() - start, timedOut, truncated }); });
  });
}
