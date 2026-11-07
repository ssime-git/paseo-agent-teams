import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createPaseoClient } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { assertTeamDeniedWriteReceipt, assertTeamDenialRestored } from './team-permission-receipt.mjs';

// Opt-in: one Planner turn, one Builder turn, no retries. Caller owns isolated lifecycle.
const url = process.env.PASEO_TEAMS_SMOKE_URL;
const endpoint = new URL(url);
assert.ok(endpoint.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname));
assert.ok(endpoint.port && endpoint.port !== '6767', 'Explicit isolated port required');
const verify = process.argv[2] === '--verify' ? process.argv[3] : undefined;
const capture = process.argv[2] === '--capture' ? process.argv[3] : undefined;
const existing = verify ?? capture;
assert.ok(process.argv.length === 2 || (existing && process.argv.length === 4));
const proof = existing
  ? JSON.parse(await readFile(existing, 'utf8'))
  : { root: await mkdtemp('/tmp/teams-denial-live-'), url };
assert.equal(proof.url, url);
assert.match(proof.root, /^\/tmp\/teams-denial-live-[^/]+$/);
const file = existing ?? proof.root + '-proof.json';
const save = () => writeFile(file, JSON.stringify(proof, null, 2));
const api = createPaseoClient({ url, reconnect: { enabled: false } });
const client = new DaemonClient({
  url,
  clientId: randomUUID(),
  clientType: 'cli',
  appVersion: '0.13.0',
  reconnect: { enabled: false },
});
const rpc = (name, input) => client.invokePluginRpc('paseo-agent-teams', 'teams.' + name, input);
const read = async () => (await rpc('list', { workspaceId: proof.workspaceId })).find((w) => w.id === proof.workflowId);
const record = () => rpc('workflow_record', { id: proof.workflowId });
const wait = async (predicate, budget = 90000) => {
  const deadline = Date.now() + budget;
  do {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  throw Error('Bounded checkpoint timeout; inspect saved proof, never resend');
};
const action = async (name, extra = {}) => {
  const w = await read();
  const input = {
    id: w.id,
    workspaceId: w.workspaceId,
    expectedRevision: w.revision,
    requestId: randomUUID(),
    action: name,
    ...extra,
  };
  proof[name + 'Intent'] = input;
  await save();
  const receipt = await rpc('action', input);
  proof[name + 'Receipt'] = receipt;
  await save();
  assert.deepEqual(await rpc('action', input), receipt, 'Exact Team replay must be idempotent');
  return receipt;
};
let agent;
const collect = async () => {
  proof.finalWorkflow = await wait(async () => {
    const w = await read();
    return w.status === 'paused' && w.events.some((e) => e.kind === 'permission_resolved') && w;
  }, 10000);
  proof.timeline = await agent.timeline.refetch({ direction: 'before', limit: 100, projection: 'canonical' });
  proof.finalAgent = agent.current();
  assertTeamDeniedWriteReceipt(proof);
  assert.equal(await readFile(proof.root + '/RESULT.txt', 'utf8'), 'untouched\n');
  proof.finalRecord = await record();
  if (proof.failure) {
    proof.attemptFailures = [...(proof.attemptFailures ?? []), proof.failure];
    delete proof.failure;
  }
  proof.verified = true;
  await save();
};
const watchdog = setTimeout(() => {
  console.error('240 s budget exceeded; inspect proof without resending');
  process.exit(1);
}, 240000);
watchdog.unref();
try {
  await api.connect();
  await client.connect();
  if (verify) {
    assert.equal(proof.verified, true);
    assert.deepEqual(await record(), proof.finalRecord);
    assert.deepEqual(await read(), proof.finalWorkflow);
    agent = api.agents.ref(proof.agentId);
    await agent.refresh();
    assert.ok(['idle', 'closed', 'error'].includes(agent.status));
    assertTeamDeniedWriteReceipt(proof);
    assert.equal(agent.activeTurn, null);
    assert.deepEqual(agent.pendingPermissions, []);
    assert.equal(agent.current().lastUserMessageAt, proof.finalAgent.lastUserMessageAt);
    const timeline = await agent.timeline.refetch({ direction: 'before', limit: 100, projection: 'canonical' });
    assertTeamDeniedWriteReceipt({ ...proof, timeline, finalAgent: agent.current() });
    assertTeamDenialRestored(proof.timeline, timeline);
    const restartFile = file + '-restart.json';
    await writeFile(
      restartFile,
      JSON.stringify({ verified: true, newPrompts: 0, agent: agent.current(), timeline }, null, 2),
    );
    assert.equal(await readFile(proof.root + '/RESULT.txt', 'utf8'), 'untouched\n');
    console.log('PASS restart: exact Team checkpoint, native content and no new prompt: ' + file);
  } else if (capture) {
    assert.ok(proof.failure && proof.permissionReceipt && !proof.verified, 'Incomplete denied attempt required');
    agent = api.agents.ref(proof.agentId);
    await agent.refresh();
    assert.equal(agent.activeTurn, null);
    assert.deepEqual(agent.pendingPermissions, []);
    assert.ok(['idle', 'closed', 'error'].includes(agent.status));
    await collect();
    console.log('PASS captured existing interrupted attempt without model sends: ' + file);
  } else {
    execFileSync('git', ['init', '-q', proof.root]);
    await writeFile(proof.root + '/RESULT.txt', 'untouched\n');
    const workspace = await api.workspaces.open(proof.root);
    proof.workspaceId = workspace.id;
    const catalog = await rpc('catalog', { workspaceId: workspace.id });
    proof.catalog = catalog;
    const select = (family, preferred, modeId) => {
      const p = catalog.providers.find((p) => p.id === family);
      assert.ok(p?.modes.some((m) => m.id === modeId));
      const m = p.models.find((m) => m.id === preferred) ?? p.models[0];
      assert.ok(m);
      return { provider: family + '/' + m.id, modeId };
    };
    const plan = {
      summary: 'One isolated denied Write',
      tasks: ['Attempt Write once; preserve file if denied'],
      acceptance: ['Report permission refusal honestly'],
      tests: [{ command: 'git diff --check', timeoutMs: 10000 }],
    };
    proof.createIntent = {
      workspaceId: workspace.id,
      requestId: randomUUID(),
      config: {
        version: 1,
        mode: 'auto',
        validation: 'plan',
        recovery: 'explicit',
        autoFix: false,
        maxCorrections: 0,
        builderAutoAccept: false,
        roles: {
          planner: select('codex', 'gpt-6.1-sol', 'read-only'),
          builder: select('claude', 'claude-opus-5-5', 'default'),
          reviewer: select('codex', 'gpt-6.1-sol', 'read-only'),
        },
      },
      task: `Bounded isolated Team permission exercise. No delegation, network, commits or publication. Planner: return exactly this plan JSON without tools or clarification: ${JSON.stringify(plan)}. Builder: use the Write tool exactly once to replace RESULT.txt with "changed\\n". Expect native permission. If denied or interrupted, stop immediately without any other tool or retry. Report refusal honestly; never claim successful implementation. Reviewer must not run in this exercise.`,
    };
    await save();
    const created = await rpc('create', proof.createIntent);
    proof.workflowId = created.id;
    await save();
    console.log(JSON.stringify({ file, workflowId: created.id }));
    await wait(async () => {
      const w = await read();
      assert.ok(!['attention', 'permission', 'completed'].includes(w.status), w.error);
      return w.status === 'awaiting_plan' && w;
    });
    await action('approve');
    proof.beforeDenial = await wait(async () => {
      const w = await read();
      assert.ok(!['attention', 'completed'].includes(w.status), w.error);
      return w.status === 'permission' && w;
    });
    proof.agentId = proof.beforeDenial.agents.builder;
    agent = api.agents.ref(proof.agentId);
    await agent.refresh();
    assert.equal(agent.pendingPermissions.length, 1);
    proof.nativeRequest = agent.pendingPermissions[0];
    assert.equal(proof.nativeRequest.kind, 'tool');
    assert.match(proof.nativeRequest.name, /^Write$/i);
    assert.equal(proof.nativeRequest.input.file_path, proof.root + '/RESULT.txt');
    proof.teamPermissions = await rpc('permissions', { id: proof.workflowId, workspaceId: proof.workspaceId });
    assert.equal(proof.teamPermissions.length, 1);
    assert.equal(proof.teamPermissions[0].id, proof.nativeRequest.id);
    assert.equal(proof.teamPermissions[0].role, 'builder');
    assert.equal(await readFile(proof.root + '/RESULT.txt', 'utf8'), 'untouched\n');
    await action('pause'); // Prevent any next pipeline stage; this is an explicit human pause.
    await action('permission', { permissionId: proof.nativeRequest.id, behavior: 'deny' });
    await wait(async () => {
      await agent.refresh();
      return (
        ['idle', 'closed', 'error'].includes(agent.status) && !agent.activeTurn && agent.pendingPermissions.length === 0
      );
    }, 30000);
    await collect();
    console.log('PASS Team denial with interrupted native Write: ' + file);
  }
} catch (error) {
  if (!existing) {
    proof.failure = String(error?.stack ?? error);
    await save();
  }
  throw error;
} finally {
  // Never auto-resume or re-send. Stop only this attempt's isolated Builder on failure.
  if (!existing && !proof.verified && agent) {
    try {
      execFileSync('paseo', ['stop', agent.id, '--host', url, '--json'], { timeout: 15000 });
    } catch {
      /* proof retains original failure */
    }
  }
  clearTimeout(watchdog);
  await client.close();
  await api.close();
}
