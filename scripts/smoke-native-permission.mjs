import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createPaseoClient } from '@getpaseo/client';
import { assertDeniedWriteReceipt } from './native-permission-receipt.mjs';

// One real turn, one explicit denial. The caller owns the isolated daemon.
const url = process.env.PASEO_TEAMS_SMOKE_URL;
if (!url) throw Error('Set PASEO_TEAMS_SMOKE_URL to an isolated daemon');
const endpoint = new URL(url);
assert.ok(
  endpoint.protocol === 'ws:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) &&
    endpoint.port &&
    endpoint.port !== '6767',
  'An explicit isolated loopback port is required',
);
if (process.argv[2] === '--verify') {
  const saved = JSON.parse(await readFile(process.argv[3], 'utf8'));
  assert.equal(saved.url, url);
  assert.equal(saved.verified, true);
  assert.equal(saved.afterDenial.status, 'idle');
  assert.equal(saved.denialIntent.requestId, saved.request.id);
  assert.equal(saved.denialIntent.response.behavior, 'deny');
  assertDeniedWriteReceipt(saved);
  const check = createPaseoClient({ url, reconnect: { enabled: false } });
  try {
    await check.connect();
    const ref = check.agents.ref(saved.agentId);
    await ref.refresh();
    assert.equal(ref.cwd, saved.root);
    assert.ok(['idle', 'closed'].includes(ref.status));
    assert.equal(ref.activeTurn, null);
    assert.deepEqual(ref.pendingPermissions, []);
    assert.equal(ref.current().lastUserMessageAt, saved.finalAgent.lastUserMessageAt);
    const timeline = await ref.timeline.refetch({ direction: 'before', limit: 100, projection: 'canonical' });
    // Provider rehydration regenerates envelope sequence/timestamp/message IDs.
    // Compare content and tool receipts, including native call ID and denial.
    const content = (entries) =>
      entries.map(({ item }) => {
        const { messageId, clientMessageId, ...rest } = item;
        return rest;
      });
    assertDeniedWriteReceipt({ ...saved, timeline });
    assert.deepEqual(content(timeline.entries), content(saved.timeline.entries));
    assert.equal(await readFile(saved.root + '/RESULT.txt', 'utf8'), 'untouched\n');
    console.log(JSON.stringify({ verified: true, agentId: saved.agentId, newTurns: 0 }));
  } finally {
    await check.close();
  }
  process.exit(0);
}
assert.equal(process.argv.length, 2, 'Use no arguments or --verify proof.json');
const root = await mkdtemp('/tmp/teams-permission-live-');
const proofFile = root + '-proof.json';
const proof = { root, url, startedAt: new Date().toISOString() };
const save = () => writeFile(proofFile, JSON.stringify(proof, null, 2));
const api = createPaseoClient({ url, reconnect: { enabled: false } });
let agent;
const watchdog = setTimeout(() => {
  console.error('180 s budget exceeded; inspect proof and stop only its isolated agent; never resend');
  process.exit(1);
}, 180000);
watchdog.unref();
try {
  execFileSync('git', ['init', '-q', root]);
  await writeFile(root + '/RESULT.txt', 'untouched\n');
  await save();
  await api.connect();
  proof.discovery = await api.providers.waitForReady({ cwd: root, timeoutMs: 20000 });
  const provider = proof.discovery.entries.find((e) => e.provider === 'claude' && e.status === 'ready');
  assert.ok(provider?.models?.length, 'A detected Claude model is required');
  proof.modes = await api.providers.listModes('claude', { cwd: root });
  assert.ok(
    proof.modes.modes.some((m) => m.id === 'default'),
    'Claude default mode must be detected',
  );
  const model = provider.models.find((m) => m.id === 'claude-opus-5-5') ?? provider.models[0];
  proof.config = { provider: 'claude/' + model.id, modeId: 'default' };
  proof.creationIntent = randomUUID();
  await save();
  agent = await api.agents.create({
    cwd: root,
    config: proof.config,
    idempotencyKey: proof.creationIntent,
    title: 'Isolated native permission denial',
  });
  proof.agentId = agent.id;
  proof.turnIntent = {
    prompt:
      'Use the Write tool once to replace RESULT.txt with "changed\\n". This isolated test expects a permission request. If denied, stop immediately and report the denial; do not retry, use another tool, or ask a question.',
    attemptedAt: new Date().toISOString(),
  };
  await save();
  proof.turn = await agent.run(proof.turnIntent.prompt, { timeoutMs: 90000 });
  await agent.refresh();
  proof.beforeDenial = agent.current();
  await save();
  assert.equal(proof.turn.status, 'permission', 'No permission emitted: this is not a denial proof');
  const requests = agent.pendingPermissions;
  assert.equal(requests?.length, 1, 'Exactly one native request expected');
  proof.request = requests[0];
  assert.equal(proof.request.kind, 'tool');
  assert.match(proof.request.name, /write/i);
  assert.equal(await readFile(root + '/RESULT.txt', 'utf8'), 'untouched\n');
  proof.denialIntent = {
    requestId: proof.request.id,
    response: {
      behavior: 'deny',
      message: 'Isolated validation: deny this write and stop without retry.',
    },
  };
  await save();
  await agent.respondToPermission(proof.denialIntent);
  proof.afterDenial = await agent.waitForFinish(30000);
  await agent.refresh();
  proof.finalAgent = agent.current();
  proof.timeline = await agent.timeline.refetch({ direction: 'before', limit: 100, projection: 'canonical' });
  assertDeniedWriteReceipt(proof);
  assert.equal(proof.afterDenial.status, 'idle');
  assert.equal(agent.pendingPermissions.length, 0);
  assert.equal(await readFile(root + '/RESULT.txt', 'utf8'), 'untouched\n');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), '?? RESULT.txt\n');
  proof.verified = true;
} catch (error) {
  proof.failure = String(error?.stack ?? error);
  throw error;
} finally {
  await save();
  // No user agents are touched. A failed bounded attempt must not wait indefinitely.
  if (agent) {
    try {
      execFileSync('paseo', ['stop', agent.id, '--host', url, '--json'], { timeout: 15000 });
      proof.cleanup = 'owned isolated agent stopped';
    } catch (error) {
      proof.cleanupError = String(error);
    }
  }
  await save();
  await api.close();
  clearTimeout(watchdog);
  console.log(JSON.stringify({ proofFile, verified: proof.verified ?? false, agentId: proof.agentId }));
}
