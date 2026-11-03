import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createPaseoClient } from '@getpaseo/client';
import { buildPrompt } from '../server/prompt.ts';
import { PaseoRuntime } from '../server/runtime.ts';
import { workflowFixture } from '../tests/fixtures.ts';

// Opt-in, two real Builder turns, with no retries. The caller owns daemon lifecycle.
const url = process.env.PASEO_TEAMS_SMOKE_URL;
assert.ok(url, 'Set PASEO_TEAMS_SMOKE_URL to an isolated daemon');
const endpoint = new URL(url);
assert.ok(
  ['ws:', 'wss:'].includes(endpoint.protocol) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) &&
    endpoint.port &&
    endpoint.port !== '6767',
  'Use an explicit isolated loopback port, never primary port 6767',
);
const root = await mkdtemp('/tmp/teams-role-scope-');
const proof = { root, url, results: [] };
const file = root + '-proof.json';
const api = createPaseoClient({ url, reconnect: { enabled: false } });
try {
  await api.connect();
  const discovery = await api.providers.waitForReady({ cwd: root, timeoutMs: 20000 });
  const provider = discovery.entries.find((p) => p.provider === 'codex' && p.status === 'ready');
  assert.ok(provider, 'A ready Codex provider is required');
  const model = provider.models?.find((m) => m.id === 'gpt-6.1-sol') ?? provider.models?.[0];
  assert.ok(model, 'A detected model is required');
  const modes = await api.providers.listModes('codex', { cwd: root });
  assert.ok(modes.modes.some((m) => m.id === 'full-access'));
  proof.discovery = { provider, modes };
  const runtime = new PaseoRuntime(api, root);
  for (const restricted of [false, true]) {
    const repo = root + (restricted ? '/restricted' : '/authorized');
    execFileSync('git', ['init', '-q', repo]);
    await writeFile(repo + '/README.md', 'Preserve this baseline.\n');
    const before = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
    const workspace = await api.workspaces.open(repo);
    const w = workflowFixture();
    Object.assign(w, {
      id: randomUUID(),
      workspaceId: workspace.id,
      cwd: repo,
      repo: repo + '/.git',
      phase: 'building',
    });
    w.config.mode = 'auto';
    w.config.roles.builder = { provider: 'codex/' + model.id, modeId: 'full-access' };
    w.task = restricted
      ? 'All roles, including Builder: do not edit any files. Analyze the proposed change only.'
      : 'Planner: analyze and plan only; do not implement. Reviewer: inspect only; do not edit. Builder: implement the approved plan: create RESULT.txt with exactly ready followed by a newline. Preserve README.md. Do not commit or publish.';
    w.plan = {
      summary: 'Create the requested result',
      tasks: ['Create RESULT.txt containing ready and a newline'],
      acceptance: ['README.md preserved'],
      tests: [],
    };
    w.testsApproved = true;
    const id = await runtime.agent(w, 'builder');
    w.agents.builder = id;
    const prompt = buildPrompt(w, 'builder', 'The repository contains only the pre-existing README.md.');
    const handle = api.agents.ref(id);
    const result = await handle.run(prompt, { timeoutMs: 120000 });
    assert.equal(result.status, 'idle');
    assert.equal(await readFile(repo + '/README.md', 'utf8'), 'Preserve this baseline.\n');
    const status = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
    if (restricted) {
      assert.equal(status, before);
      assert.deepEqual((await readdir(repo)).sort(), ['.git', 'README.md']);
    } else {
      assert.equal(await readFile(repo + '/RESULT.txt', 'utf8'), 'ready\n');
      assert.equal(status, '?? README.md\n?? RESULT.txt\n');
    }
    const timeline = await handle.timeline.refetch({ direction: 'before', limit: 200, projection: 'canonical' });
    assert.equal(timeline.entries.filter((e) => e.item.type === 'user_message').length, 1);
    proof.results.push({ restricted, id, prompt, result, status, timeline });
    await writeFile(file, JSON.stringify(proof, null, 2));
  }
  console.log(
    'PASS role-specific no-edit does not block Builder; workflow-wide no-edit remains binding. Proof: ' + file,
  );
} catch (error) {
  proof.failure = String(error);
  await writeFile(file, JSON.stringify(proof, null, 2));
  throw error;
} finally {
  await api.close();
}
