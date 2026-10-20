import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { createPaseoClient } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
const url = process.env.PASEO_TEAMS_SMOKE_URL;
if (!url)
  throw Error('Set PASEO_TEAMS_SMOKE_URL to a separate daemon with this plugin installed. This test runs real models.');
const endpoint = new URL(url);
if (
  !['ws:', 'wss:'].includes(endpoint.protocol) ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
  !endpoint.port ||
  endpoint.port === '6767'
)
  throw Error('Use an explicit isolated loopback daemon port, never the primary daemon port 6767');
const root = await mkdtemp('/tmp/teams-goal-live-');
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
git('init', '-q');
git('config', 'user.name', 'Isolated Test');
git('config', 'user.email', 'test@example.invalid');
await writeFile(root + '/package.json', '{"type":"module","scripts":{"test":"node --test"}}\n');
await writeFile(root + '/label.js', 'export function normalizeLabel(value) { return value; }\n');
await writeFile(root + '/README.md', 'User-owned documentation.\n');
git('add', '.');
git('commit', '-qm', 'Baseline');
await writeFile(root + '/README.md', 'User-owned documentation.\nStaged user note.\n');
git('add', 'README.md');
await writeFile(root + '/README.md', 'User-owned documentation.\nStaged user note.\nUnstaged note.\n');
const protectedHashes = {};
for (const p of ['README.md', '.git/index'])
  protectedHashes[p] = createHash('sha256')
    .update(await readFile(root + '/' + p))
    .digest('hex');
const api = createPaseoClient({ url }),
  client = new DaemonClient({ url, clientId: 'goal-live-integration', clientType: 'cli', appVersion: '0.11.2' });
const rpc = (name, input) => client.invokePluginRpc('paseo-agent-teams', 'teams.' + name, input);
try {
  await api.connect();
  await client.connect();
  const ws = await api.workspaces.open(root);
  const cat = await rpc('catalog', { workspaceId: ws.id });
  const claude = cat.providers.find((p) => p.id === 'claude'),
    codex = cat.providers.find((p) => p.id === 'codex');
  const cm = claude?.models.find((m) => /sonnet/i.test(m.id)) ?? claude?.models.find((m) => m.isDefault);
  const gm = codex?.models.find((m) => m.id === 'gpt-6.1-sol') ?? codex?.models.find((m) => m.isDefault);
  if (!cm || !gm) throw Error('Both real harnesses must be discovered');
  const config = {
    version: 1,
    mode: 'auto',
    goalMode: true,
    goalMaxTurns: 12,
    goalTimeBudgetMs: 900000,
    roles: {
      planner: { provider: 'claude/' + cm.id, modeId: 'plan' },
      builder: { provider: 'codex/' + gm.id, modeId: 'auto' },
      reviewer: { provider: 'claude/' + cm.id, modeId: 'plan' },
    },
    builderAutoAccept: true,
    validation: 'autonomous',
    autoFix: true,
    maxCorrections: 1,
    recovery: 'automatic',
    freshSessionPerCycle: true,
  };
  const task = `Implement normalizeLabel(value) in label.js: trim outer whitespace, collapse any internal whitespace (including tabs/newlines) to a single space, lowercase, and throw TypeError for non-string input. Add behavior regression tests and run them yourself before handoff. Preserve README.md staged and unstaged content and Git index exactly. Only edit label.js and label.test.js. No dependencies, network, commits, staging, publication or delegation. Use node --test. Keep reports concise.
This is an explicitly authorized isolated fault-injection exercise for the orchestration engine. On the FIRST Builder turn only (no previous review), deliberately implement value.trim() and add only a trim test, run it, and honestly report the unimplemented behavior under remaining. Do not implement other requirements in this first turn. Reviewer must independently reproduce the missing behaviors and fail this first artifact. After that failed review, the Planner must diagnose the real implementation gap and propose a complete correction; subsequent Builder turns must implement ALL original requirements with meaningful edge-case tests. Do not repeat the injection after a previous review exists. Do not relax acceptance. The final Reviewer must check the real implementation and regression tests. Planner should use exactly node --test as verification. Use your own native tools and applicable local skills if relevant.`;
  const start = Date.now(),
    created = await rpc('create', { workspaceId: ws.id, config, task, requestId: randomUUID() });
  await writeFile(
    root + '/run.json',
    JSON.stringify({ root, workspaceId: ws.id, workflowId: created.id, providers: config.roles }, null, 2),
  );
  console.log(JSON.stringify({ root, id: created.id, providers: config.roles }));
  let w,
    last = '';
  const deadline = Date.now() + 15 * 60000;
  while (Date.now() < deadline) {
    w = (await rpc('list', { workspaceId: ws.id })).find((w) => w.id === created.id);
    const key = [w.phase, w.status, w.goal?.turns, w.goal?.replans].join('|');
    if (key !== last) {
      console.log(
        JSON.stringify({
          seconds: Math.round((Date.now() - start) / 1000),
          phase: w.phase,
          status: w.status,
          turns: w.goal?.turns,
          replans: w.goal?.replans,
          error: w.error,
        }),
      );
      last = key;
    }
    if (['completed', 'attention', 'permission', 'awaiting_plan', 'awaiting_final'].includes(w.status)) break;
    await new Promise((r) => setTimeout(r, 1200));
  }
  const all = await rpc('workflow_record', { id: created.id });
  await writeFile(root + '/workflow.json', JSON.stringify(all, null, 2));
  const result = {
    status: w.status,
    error: w.error,
    elapsedSeconds: (Date.now() - start) / 1000,
    turns: w.goal?.turns,
    replans: w.goal?.replans,
    cycle: w.cycle,
    review: w.review?.verdict,
    tests: w.tests.map((t) => ({ command: t.command, exitCode: t.exitCode })),
    manualActions: 0,
    protectedPreserved: (
      await Promise.all(
        Object.entries(protectedHashes).map(
          async ([p, h]) =>
            createHash('sha256')
              .update(await readFile(root + '/' + p))
              .digest('hex') === h,
        ),
      )
    ).every(Boolean),
    events: all.events
      .filter((e) =>
        ['goal_replan', 'correction', 'result_repair', 'plan_approved', 'verification_failed'].includes(e.kind),
      )
      .map((e) => ({ kind: e.kind, text: e.text })),
  };
  await writeFile(root + '/result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (
    w.status !== 'completed' ||
    !result.protectedPreserved ||
    !w.goal?.replans ||
    w.review?.verdict !== 'pass' ||
    w.tests.some((t) => t.exitCode !== 0)
  )
    throw Error('Live autonomous correction was not proven');
  console.log(execFileSync('node', ['--test'], { cwd: root, encoding: 'utf8' }));
} finally {
  await api.close();
  await client.close();
}
