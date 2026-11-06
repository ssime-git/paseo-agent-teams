import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createPaseoClient } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';

// One disposable workflow, at most one correction; no automatic model retries.
const url = process.env.PASEO_TEAMS_SMOKE_URL;
const endpoint = new URL(url);
assert.ok(
  ['ws:', 'wss:'].includes(endpoint.protocol) &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) &&
    endpoint.port &&
    endpoint.port !== '6767',
  'Explicit isolated loopback endpoint required',
);
const verifyFile = process.argv[2] === '--verify' ? process.argv[3] : undefined;
const captureFile = process.argv[2] === '--capture' ? process.argv[3] : undefined;
const existingFile = verifyFile ?? captureFile;
assert.ok(!process.argv[2] || existingFile, 'Only --verify or --capture proof.json is supported');
const root = existingFile
  ? JSON.parse(await readFile(existingFile, 'utf8')).root
  : await mkdtemp('/tmp/teams-engine-live-');
assert.match(root, /^\/tmp\/teams-engine-live-[^/]+$/);
const file = existingFile ?? root + '-proof.json';
let proof = existingFile ? JSON.parse(await readFile(file, 'utf8')) : { root, url, assertions: [] };
const api = createPaseoClient({ url, reconnect: { enabled: false } });
const client = new DaemonClient({
  url,
  clientId: randomUUID(),
  clientType: 'cli',
  appVersion: '0.13.0',
  reconnect: { enabled: false },
});
const rpc = (name, input) => client.invokePluginRpc('paseo-agent-teams', 'teams.' + name, input);
const save = () => writeFile(file, JSON.stringify(proof, null, 2));
const watchdog = setTimeout(() => {
  console.error('Global 360 s budget exceeded; inspect evidence and active agents, never resend');
  process.exit(1);
}, 360000);
watchdog.unref();
try {
  await api.connect();
  await client.connect();
  const record = () => rpc('workflow_record', { id: proof.workflowId });
  const read = async () =>
    (await rpc('list', { workspaceId: proof.workspaceId })).find((w) => w.id === proof.workflowId);
  const collect = async (final) => {
    assert.equal(final.status, 'awaiting_final');
    assert.equal(final.id, proof.workflowId);
    assert.ok(proof.receipt && proof.before && proof.approvalRequest, 'Accepted approval evidence required');
    assert.equal(final.cycle, 1);
    assert.equal(final.events.filter((e) => e.kind === 'dispatch' && e.role === 'builder').length, 2);
    assert.equal(final.events.filter((e) => e.kind === 'dispatch' && e.role === 'reviewer').length, 2);
    assert.equal(final.events.filter((e) => e.kind === 'correction').length, 1);
    const history = await rpc('history', { id: proof.workflowId, workspaceId: proof.workspaceId });
    const rounds = history.filter((e) => e.kind === 'tests');
    assert.equal(rounds.length, 2);
    assert.match(rounds[0].text, /→ 17/);
    assert.doesNotMatch(rounds[1].text, /→ 17/);
    proof.injection = JSON.parse(await readFile(root + '-engine-failure.json', 'utf8'));
    assert.equal(proof.injection.operationId, rounds[0].operationId);
    assert.notEqual(proof.injection.operationId, rounds[1].operationId);
    assert.equal(final.review.verdict, 'pass');
    assert.ok(final.tests.every((t) => t.exitCode === 0 && !t.timedOut));
    assert.equal(final.delivery.fingerprint, final.testedFingerprint);
    assert.equal(final.delivery.approvedAt, undefined);
    assert.ok(final.clarifications.some((q) => q.purpose === 'delivery' && !q.resolvedAt));
    assert.equal(final.events.filter((e) => e.kind === 'delivered').length, 0);
    assert.equal(await readFile(root + '/README.md', 'utf8'), 'User documentation; preserve exactly.\n');
    assert.deepEqual(final.planVersions, proof.receipt.planVersions);
    assert.deepEqual(final.plan.tests, proof.approvalRequest.tests);
    proof.history = history;
    proof.after = await record();
    proof.afterState = final;
    if (proof.failure) {
      proof.attemptFailures = [...(proof.attemptFailures ?? []), proof.failure];
      delete proof.failure;
      delete proof.lastRecord;
    }
    proof.assertions.push(
      'Preflight cannot consume injection; engine test operation exits 17 then a distinct operation passes',
      'Exactly one correction, two Builder and two Reviewer dispatches, approval replay idempotent',
      'Delivery question unanswered; no publication',
    );
    await save();
    console.log('PASS bounded real engine failure/correction: ' + file);
  };
  if (verifyFile) {
    assert.equal(proof.url, url);
    assert.ok(proof.after && !proof.failure, 'Successful proof required');
    assert.deepEqual(await record(), proof.after);
    assert.deepEqual(await read(), proof.afterState);
    assert.deepEqual(await rpc('history', { id: proof.workflowId, workspaceId: proof.workspaceId }), proof.history);
    console.log('PASS exact correction checkpoint preserved without model sends: ' + file);
  } else if (captureFile) {
    assert.equal(proof.url, url);
    assert.ok(proof.failure && proof.lastRecord && !proof.after, 'Incomplete attempt required');
    assert.deepEqual(await record(), proof.lastRecord, 'Capture only the saved checkpoint, never advance it');
    await collect(await read());
  } else {
    execFileSync('git', ['init', '-q', root]);
    const readme = 'User documentation; preserve exactly.\n';
    await writeFile(root + '/README.md', readme);
    const workspace = await api.workspaces.open(root);
    proof.workspaceId = workspace.id;
    const catalog = await rpc('catalog', { workspaceId: workspace.id });
    const select = (family, preferred, modeId) => {
      const provider = catalog.providers.find((p) => p.id === family);
      assert.ok(
        provider?.modes.some((m) => m.id === modeId),
        family + ' mode must be discovered',
      );
      const model = provider.models.find((m) => m.id === preferred) ?? provider.models.find((m) => m.isDefault);
      assert.ok(model, family + ' model must be discovered');
      return { provider: family + '/' + model.id, modeId };
    };
    const config = {
      version: 1,
      mode: 'auto',
      validation: 'plan',
      recovery: 'explicit',
      autoFix: true,
      maxCorrections: 1,
      roles: {
        planner: select('codex', 'gpt-6.1-sol', 'read-only'),
        builder: select('codex', 'gpt-6.1-sol', 'auto'),
        reviewer: select('claude', 'claude-opus-5-5', 'plan'),
      },
    };
    const plan = {
      summary: 'Create a one paragraph GUIDE.md',
      tasks: ['Create GUIDE.md; preserve README.md'],
      acceptance: ['One nonempty paragraph, README unchanged, approved engine checks pass'],
      tests: [{ command: 'git diff --check', timeoutMs: 10000 }],
    };
    const task = `Isolated bounded orchestration test. Planner and Reviewer stay read-only; Builder may create GUIDE.md with one short paragraph, preserving README.md exactly. No delegation, commits, publication or external network. Planner first returns exactly this plan JSON, without tools or clarification: ${JSON.stringify(plan)}. Local Builder edits are explicitly authorized after Team approval. A human-approved test fixture will inject exit 17 ONLY in the first engine test operation; model self-checks skip that injection. Do not modify the fixture, its outside-repository marker or the approved commands to work around it. On the single correction turn inspect the test diagnostic and rerun checks; the next engine test operation will recover. Reviewer reports the actual results; never implement changes. Delivery requires a separate unanswered human choice.`;
    proof.config = config;
    proof.task = task;
    // Record intent before the one create request; no recovery mode recreates it.
    proof.createRequest = { workspaceId: workspace.id, task, config, requestId: randomUUID() };
    await save();
    const created = await rpc('create', proof.createRequest);
    proof.workflowId = created.id;
    await save();
    console.log(JSON.stringify({ file, workflowId: created.id, root }));
    const checkpoint = async (wanted, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      do {
        const w = await read();
        if (w.status === wanted) return w;
        if (['attention', 'permission', 'completed', 'paused'].includes(w.status))
          throw Error(JSON.stringify({ status: w.status, error: w.error }));
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } while (Date.now() < deadline);
      throw Error('Checkpoint deadline exceeded; inspect without resending');
    };
    const before = await checkpoint('awaiting_plan', 90000);
    assert.equal(before.events.filter((e) => e.kind === 'dispatch' && e.role === 'builder').length, 0);
    const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
    const marker = root + '-engine-failure.json';
    const helper = fileURLToPath(new URL('./engine-test-failure.mjs', import.meta.url));
    const injection = ['node', helper, url, before.id, workspace.id, root, marker].map(quote).join(' ');
    const content = `const fs=require('node:fs'),a=require('node:assert/strict');const s=fs.readFileSync('GUIDE.md','utf8').trim();a.ok(s);a.equal(s.split(/\\n\\s*\\n/).length,1);a.equal(fs.readFileSync('README.md','utf8'),${JSON.stringify(readme)});console.log('PASS guide and preserved README');`;
    const tests = [
      { command: 'node -e ' + quote(content), timeoutMs: 10000 },
      { command: 'git diff --check', timeoutMs: 10000 },
      { command: injection, timeoutMs: 20000 },
    ];
    // Exercise a model-style preflight while the engine is awaiting approval.
    execFileSync('node', [helper, url, before.id, workspace.id, root, marker]);
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
    const input = {
      id: before.id,
      workspaceId: workspace.id,
      expectedRevision: before.revision,
      requestId: randomUUID(),
      action: 'approve',
      tests,
    };
    proof.before = await record();
    proof.approvalRequest = input;
    await save();
    const receipt = await rpc('action', input);
    proof.receipt = receipt;
    await save();
    assert.deepEqual(await rpc('action', input), receipt, 'Approval replay must not send twice');
    const final = await checkpoint('awaiting_final', 240000);
    await collect(final);
  }
} catch (error) {
  if (!existingFile) {
    proof.failure = String(error);
    if (proof.workflowId) proof.lastRecord = await rpc('workflow_record', { id: proof.workflowId }).catch(() => null);
    await save();
  }
  throw error;
} finally {
  clearTimeout(watchdog);
  await client.close();
  await api.close();
}
