import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createPaseoClient } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { assertModelTimelineRestored } from './model-receipt.mjs';

// Continue once, with at most two configured format repairs. Never repeat the active-refusal exercise.
const url = process.env.PASEO_TEAMS_SMOKE_URL;
const endpoint = new URL(url);
assert.ok(endpoint.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname));
assert.ok(endpoint.port && endpoint.port !== '6767');
const verify = process.argv[2] === '--verify';
const capture = process.argv[2] === '--capture';
const sourceFile = process.argv[verify || capture ? 3 : 2];
assert.equal(process.argv.length, verify || capture ? 4 : 3);
const source = JSON.parse(await readFile(sourceFile, 'utf8'));
assert.equal(source.url, url);
assert.equal(source.verified, true);
assert.match(source.root, /^\/tmp\/teams-model-live-[^/]+$/);
const file = sourceFile + '-replacement.json';
let proof;
if (verify || capture) {
  proof = JSON.parse(await readFile(file, 'utf8'));
  if (verify) assert.equal(proof.verified, true);
  else assert.ok(proof.continueIntent && proof.continueReceipt && !proof.verified);
} else {
  // An existing intent may already have reached the daemon. Reconcile manually, never resend.
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  proof = { url, sourceFile, workflowId: source.workflowId };
}
const api = createPaseoClient({ url, reconnect: { enabled: false } });
const client = new DaemonClient({
  url,
  clientId: randomUUID(),
  clientType: 'cli',
  appVersion: '0.13.0',
  reconnect: { enabled: false },
});
const rpc = (name, input) => client.invokePluginRpc('paseo-agent-teams', 'teams.' + name, input);
const record = () => rpc('workflow_record', { id: source.workflowId });
const read = async () =>
  (await rpc('list', { workspaceId: source.workspaceId })).find((w) => w.id === source.workflowId);
const save = () => writeFile(file, JSON.stringify(proof, null, 2));
const wait = async (predicate) => {
  const deadline = Date.now() + 120000;
  do {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  throw Error('Checkpoint timeout; preserve intent and reconcile without resending');
};
const timeline = (id) =>
  api.agents.ref(id).timeline.refetch({ direction: 'before', limit: 100, projection: 'canonical' });
const watchdog = setTimeout(() => {
  console.error('180 s budget exceeded; reconcile saved intent');
  process.exit(1);
}, 180000);
watchdog.unref();
try {
  await api.connect();
  await client.connect();
  if (verify) {
    assert.deepEqual(await record(), proof.finalRecord);
    assert.deepEqual(await rpc('action', proof.continueIntent), proof.replayReceipt);
    assert.deepEqual(await record(), proof.finalRecord);
    assertModelTimelineRestored(proof.timeline, await timeline(proof.agentId), source.workflowId, proof.operationIds);
    assertModelTimelineRestored(
      source.timeline,
      await timeline(source.agentId),
      source.workflowId,
      source.activeWorkflow.operation.id,
    );
    await writeFile(file + '-restart.json', JSON.stringify({ verified: true, record: await record() }, null, 2));
  } else {
    if (!capture) {
      assert.deepEqual(await record(), source.finalRecord);
      const w = await read();
      assert.equal(w.status, 'paused');
      assert.equal(w.operation, undefined);
      assert.equal(w.agents.planner, undefined);
      const catalog = await rpc('catalog', { workspaceId: source.workspaceId });
      const [provider, model] = source.replacementSelection.provider.split('/');
      assert.ok(catalog.providers.find((p) => p.id === provider)?.models.some((m) => m.id === model));
      const revised = { ...source.finalWorkflow.plan, summary: 'Replacement model preserved prior plan context' };
      proof.continueIntent = {
        id: w.id,
        workspaceId: w.workspaceId,
        expectedRevision: w.revision,
        requestId: randomUUID(),
        action: 'continue',
        role: 'planner',
        message: `Explicit isolated replan with the replacement model. Supersedes the original sleep and original response instruction: no tools, writes, delegation or network. Retain the previous plan in context, return exactly this updated plan JSON: ${JSON.stringify(revised)}. Do not start Builder or Reviewer.`,
      };
      await save();
      proof.continueReceipt = await rpc('action', proof.continueIntent);
      await save();
    }
    const final = await wait(async () => {
      const state = await read();
      if (state.status === 'attention' || state.status === 'permission') throw Error(JSON.stringify(state.error));
      return state.status === 'awaiting_plan' && !state.operation && state;
    });
    assert.ok(final.plan.summary.trim());
    assert.ok(final.plan.tasks.length && final.plan.acceptance.length);
    assert.equal(final.planVersions.length, source.finalWorkflow.planVersions.length + 1);
    assert.equal(final.testsApproved, false);
    assert.equal(final.agentGenerations.planner, 1);
    assert.notEqual(final.agents.planner, source.agentId);
    assert.equal(final.agents.builder, source.finalWorkflow.agents.builder);
    assert.equal(final.agents.reviewer, source.finalWorkflow.agents.reviewer);
    assert.deepEqual(final.planVersions.slice(0, -1), source.finalWorkflow.planVersions);
    assert.deepEqual(final.planVersions.at(-1).selection, source.replacementSelection);
    assert.equal(final.planVersions.at(-1).agentId, final.agents.planner);
    const addedEvents = final.events.slice(source.finalWorkflow.events.length);
    const dispatches = addedEvents.filter((e) => e.kind === 'dispatch');
    assert.ok(dispatches.length >= 1 && dispatches.length <= 3, 'One continuation plus at most two format repairs');
    assert.equal(addedEvents.filter((e) => e.kind === 'result_repair').length, dispatches.length - 1);
    proof.operationIds = dispatches.map((e) => e.operationId);
    assert.ok(final.events.filter((e) => e.kind === 'dispatch').every((e) => e.role === 'planner'));
    proof.agentId = final.agents.planner;
    const agent = api.agents.ref(proof.agentId);
    await wait(async () => {
      await agent.refresh();
      return !agent.activeTurn && ['idle', 'closed'].includes(agent.status);
    });
    proof.agent = agent.current();
    proof.timeline = await timeline(proof.agentId);
    const prompts = proof.timeline.entries.map(({ item }) => item).filter((item) => item.type === 'user_message');
    assert.equal(prompts.length, proof.operationIds.length);
    assert.ok(
      proof.timeline.entries.every(({ item }) => item.type !== 'tool_call'),
      'Replacement does not use tools',
    );
    assert.ok(prompts[0].text.includes(source.finalWorkflow.plan.summary), 'Prior plan must reach the new session');
    assert.ok(
      prompts[0].text.includes(JSON.stringify(proof.continueIntent.message).slice(1, -1)),
      'Explicit continuation instruction must survive',
    );
    assertModelTimelineRestored(proof.timeline, proof.timeline, source.workflowId, proof.operationIds);
    assertModelTimelineRestored(
      source.timeline,
      await timeline(source.agentId),
      source.workflowId,
      source.activeWorkflow.operation.id,
    );
    proof.finalRecord = await record();
    proof.finalWorkflow = final;
    proof.replayReceipt = await rpc('action', proof.continueIntent);
    assert.deepEqual(await rpc('action', proof.continueIntent), proof.replayReceipt);
    assert.deepEqual(await record(), proof.finalRecord);
    if (proof.failure) {
      proof.attemptFailures = [...(proof.attemptFailures ?? []), proof.failure];
      delete proof.failure;
    }
    proof.verified = true;
    await save();
  }
  console.log('PASS replacement turn' + (verify ? ' restart' : '') + ': ' + file);
} catch (error) {
  if (!verify) {
    if (proof.failure) proof.attemptFailures = [...(proof.attemptFailures ?? []), proof.failure];
    proof.failure = String(error?.stack ?? error);
    await save();
  }
  throw error;
} finally {
  clearTimeout(watchdog);
  await client.close();
  await api.close();
}
