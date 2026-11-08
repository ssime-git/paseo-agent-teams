import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { assertModelTimelineRestored } from './model-receipt.mjs';
import { createPaseoClient } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';

// Opt-in: one Planner turn, no Builder or replacement-model dispatch. Caller owns lifecycle.
const url = process.env.PASEO_TEAMS_SMOKE_URL;
const endpoint = new URL(url);
const dataDirectory = process.env.PASEO_TEAMS_SMOKE_DATA_DIR;
assert.match(dataDirectory ?? '', /^\/tmp\//, 'Explicit isolated data directory required');
assert.ok(endpoint.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname));
assert.ok(endpoint.port && endpoint.port !== '6767', 'Explicit isolated endpoint required');
const verify = process.argv[2] === '--verify' ? process.argv[3] : undefined;
const capture = process.argv[2] === '--capture' ? process.argv[3] : undefined;
const existing = verify ?? capture;
assert.ok(process.argv.length === 2 || (existing && process.argv.length === 4));
const proof = existing
  ? JSON.parse(await readFile(existing, 'utf8'))
  : { root: await mkdtemp('/tmp/teams-model-live-'), url };
assert.equal(proof.url, url);
assert.match(proof.root, /^\/tmp\/teams-model-live-[^/]+$/);
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
const wait = async (predicate) => {
  const deadline = Date.now() + 90000;
  do {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw Error('Bounded checkpoint timeout; inspect proof, never resend');
};
const input = (w, action, extra = {}) => ({
  id: w.id,
  workspaceId: w.workspaceId,
  expectedRevision: w.revision,
  requestId: randomUUID(),
  action,
  ...extra,
});
let agent;
const watchdog = setTimeout(() => {
  console.error('180 s budget exceeded; inspect proof without resending');
  process.exit(1);
}, 180000);
watchdog.unref();
try {
  console.log('Connecting isolated SDK');
  await api.connect();
  console.log('Connecting isolated Team RPC');
  await client.connect();
  console.log('Connected');
  if (verify) {
    assert.equal(proof.verified, true);
    assert.deepEqual(await record(), proof.finalRecord);
    assert.deepEqual(await rpc('action', proof.changeIntent), proof.changeReceipt);
    assert.deepEqual(await record(), proof.finalRecord);
    agent = api.agents.ref(proof.agentId);
    await agent.refresh();
    assert.equal(agent.activeTurn, null);
    assert.deepEqual(agent.pendingPermissions, []);
    assert.equal(agent.current().lastUserMessageAt, proof.finalAgent.lastUserMessageAt);
    const timeline = await agent.timeline.refetch({ direction: 'before', limit: 100, projection: 'canonical' });
    assertModelTimelineRestored(proof.timeline, timeline, proof.workflowId, proof.activeWorkflow.operation.id);
    await writeFile(
      file + '-restart.json',
      JSON.stringify({ verified: true, workflow: await read(), timeline, agent: agent.current() }, null, 2),
    );
    console.log('PASS restart and exact action replay: ' + file);
  } else {
    if (!capture) {
      execFileSync('git', ['init', '-q', proof.root]);
      proof.workspaceId = (await api.workspaces.open(proof.root)).id;
      proof.catalog = await rpc('catalog', { workspaceId: proof.workspaceId });
      const provider = proof.catalog.providers.find((p) => p.id === 'codex');
      assert.ok(provider?.modes.some((m) => m.id === 'read-only'));
      const models = provider.models;
      assert.ok(models.length >= 2, 'Two discovered models required; never invent a selection');
      const initial = models.find((m) => m.id === 'gpt-6.1-sol') ?? models[0];
      const replacement = models.find((m) => m.id !== initial.id);
      proof.initialSelection = { provider: 'codex/' + initial.id, modeId: 'read-only' };
      proof.replacementSelection = { provider: 'codex/' + replacement.id, modeId: 'read-only' };
      const plan = {
        summary: 'Isolated model receipt',
        tasks: ['No implementation required'],
        acceptance: ['Preserve initial model provenance'],
        tests: [{ command: 'git diff --check', timeoutMs: 10000 }],
      };
      proof.expectedPlan = plan;
      proof.createIntent = {
        workspaceId: proof.workspaceId,
        requestId: randomUUID(),
        config: {
          version: 1,
          mode: 'auto',
          validation: 'plan',
          recovery: 'explicit',
          autoFix: false,
          maxCorrections: 0,
          builderAutoAccept: false,
          roles: { planner: proof.initialSelection, builder: proof.initialSelection, reviewer: proof.initialSelection },
        },
        task: `Bounded isolated Planner exercise. No delegation, network, writes, commits or publication. First execute only the read-only shell command sleep 5 exactly once, then return exactly this plan JSON without any other tool or clarification: ${JSON.stringify(plan)}. Builder and Reviewer must not run.`,
      };
      await save();
      proof.workflowId = (await rpc('create', proof.createIntent)).id;
      await save();
      console.log(JSON.stringify({ file, workflowId: proof.workflowId }));
      const active = await wait(async () => {
        const w = await read();
        if (!w.operation || !w.agents.planner) return false;
        agent = api.agents.ref(w.agents.planner);
        await agent.refresh();
        return agent.activeTurn && w;
      });
      proof.agentId = agent.id;
      proof.activeWorkflow = active;
      proof.activeAgent = agent.current();
      proof.runningChangeIntent = input(active, 'reconfigure', {
        role: 'planner',
        selection: proof.replacementSelection,
      });
      await save();
      await assert.rejects(rpc('action', proof.runningChangeIntent), /Pause and wait/);
      proof.runningRejected = true;
      const beforePause = await read();
      assert.deepEqual(beforePause.operation, active.operation);
      proof.pauseIntent = input(beforePause, 'pause');
      await save();
      proof.pauseReceipt = await rpc('action', proof.pauseIntent);
      const paused = await read();
      assert.equal(paused.status, 'paused');
      assert.deepEqual(paused.operation, active.operation);
      proof.pausedChangeIntent = input(paused, 'reconfigure', {
        role: 'planner',
        selection: proof.replacementSelection,
      });
      await save();
      await assert.rejects(rpc('action', proof.pausedChangeIntent), /Pause and wait/);
      proof.pausedRejected = true;
      await save();
    } else {
      assert.ok(proof.runningRejected && proof.pauseReceipt && proof.pausedChangeIntent && !proof.verified);
      agent = api.agents.ref(proof.agentId);
      await agent.refresh();
      assert.equal(agent.activeTurn, null);
      const paused = await read();
      assert.equal(paused.status, 'paused');
      await assert.rejects(
        rpc('action', input(paused, 'reconfigure', { role: 'planner', selection: proof.replacementSelection })),
        /Pause and wait/,
      );
      proof.pausedRejected = true;
    }
    proof.receivedWorkflow = await wait(async () => {
      const w = await read();
      const persisted = JSON.parse(await readFile(join(dataDirectory, w.id + '.json'), 'utf8'));
      return w.status === 'paused' && w.operation && persisted.receipts?.[w.operation.id] && w;
    });
    proof.resumeIntent = input(proof.receivedWorkflow, 'resume');
    await save();
    proof.resumeReceipt = await rpc('action', proof.resumeIntent);
    const checkpoint = await wait(async () => {
      const w = await read();
      return w.status === 'awaiting_plan' && !w.operation && w;
    });
    proof.settledPauseIntent = input(checkpoint, 'pause');
    await save();
    proof.settledPauseReceipt = await rpc('action', proof.settledPauseIntent);
    proof.settledWorkflow = await wait(async () => {
      const w = await read();
      return w.status === 'paused' && !w.operation && w.plan && w;
    });
    await wait(async () => {
      await agent.refresh();
      return !agent.activeTurn && ['idle', 'closed'].includes(agent.status);
    });
    const expectedPlan =
      proof.expectedPlan ??
      JSON.parse(proof.createIntent.task.split('clarification: ')[1].split('. Builder and Reviewer')[0]);
    assert.deepEqual(proof.settledWorkflow.plan, expectedPlan);
    proof.changeIntent = input(proof.settledWorkflow, 'reconfigure', {
      role: 'planner',
      selection: proof.replacementSelection,
    });
    await save();
    proof.changeReceipt = await rpc('action', proof.changeIntent);
    proof.finalWorkflow = await read();
    assert.deepEqual(await rpc('action', proof.changeIntent), proof.changeReceipt);
    assert.deepEqual(proof.finalWorkflow.config.roles.planner, proof.replacementSelection);
    assert.equal(proof.finalWorkflow.agentGenerations.planner, 1);
    assert.equal(proof.finalWorkflow.agents.planner, undefined);
    assert.deepEqual(proof.finalWorkflow.planVersions, proof.settledWorkflow.planVersions);
    assert.equal(proof.finalWorkflow.planVersions[0].agentId, proof.agentId);
    assert.deepEqual(proof.finalWorkflow.planVersions[0].selection, proof.initialSelection);
    assert.equal(proof.finalWorkflow.events.filter((e) => e.kind === 'dispatch').length, 1);
    proof.finalRecord = await record();
    proof.timeline = await agent.timeline.refetch({ direction: 'before', limit: 100, projection: 'canonical' });
    assert.equal(proof.timeline.error, null);
    assert.equal(proof.timeline.hasOlder, false);
    assert.equal(proof.timeline.hasNewer, false);
    assert.equal(proof.timeline.gap, false);
    const prompts = proof.timeline.entries.map(({ item }) => item).filter((item) => item.type === 'user_message');
    assert.equal(prompts.length, 1);
    assert.ok(prompts[0].text.startsWith(`[agent-teams-operation:${proof.activeWorkflow.operation.id}]\n`));
    proof.finalAgent = agent.current();
    if (proof.failure) {
      proof.attemptFailures = [...(proof.attemptFailures ?? []), proof.failure];
      delete proof.failure;
    }
    proof.verified = true;
    await save();
    console.log('PASS active refusal, paused refusal and settled replacement: ' + file);
  }
} catch (error) {
  if (!verify) {
    proof.failure = String(error?.stack ?? error);
    await save();
  }
  throw error;
} finally {
  if (!verify && !proof.verified && agent) {
    try {
      execFileSync('paseo', ['stop', agent.id, '--host', url, '--json'], { timeout: 15000 });
    } catch {
      /* retain original proof */
    }
  }
  clearTimeout(watchdog);
  await client.close();
  await api.close();
}
