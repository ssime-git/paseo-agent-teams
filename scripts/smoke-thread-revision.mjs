import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createPaseoClient } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { assertModelTimelineRestored } from './model-receipt.mjs';

// Opt-in: continue an isolated native Team plan, two Reviewer turns maximum.
// An existing intent is never resent automatically. The caller owns daemon restarts.
const verify = process.argv[2] === '--verify';
const checkpoint = process.argv[2] === '--checkpoint';
const capture = process.argv[2] === '--capture';
const sourceFile = process.argv[verify || checkpoint || capture ? 3 : 2];
assert.equal(process.argv.length, verify || checkpoint || capture ? 4 : 3);
const source = JSON.parse(await readFile(sourceFile, 'utf8'));
const url = process.env.PASEO_TEAMS_SMOKE_URL;
assert.equal(source.url, url);
const endpoint = new URL(url);
assert.ok(endpoint.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname));
assert.ok(endpoint.port && endpoint.port !== '6767');
assert.match(source.root, /^\/tmp\/teams-[^/]+\/repo$/);
const natural = source.natural === true;
const file = sourceFile + '-revision.json';
let proof;
let restartEvidence;
if (verify || checkpoint || capture) proof = JSON.parse(await readFile(file, 'utf8'));
else {
  await assert.rejects(readFile(file), { code: 'ENOENT' }, 'Existing attempt: inspect it, never resend');
  proof = { source, intents: [], assertions: [] };
}
const watchdog = setTimeout(() => {
  console.error('180 s budget exceeded; preserve intents and inspect, never resend');
  process.exit(1);
}, 180000);
watchdog.unref();
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
const timeline = (id) =>
  api.agents.ref(id).timeline.refetch({ direction: 'before', limit: 100, projection: 'canonical' });
const assertTools = (page) => {
  const tools = page.entries.filter((e) => e.item.type === 'tool_call').map((e) => e.item);
  if (!source.activityDelay) return assert.equal(tools.length, 0);
  const bash = tools.filter((tool) => tool.name === 'Bash');
  assert.equal(bash.length, 1);
  assert.equal(bash[0].detail.command, 'sleep 8');
  assert.equal(bash[0].status, 'completed');
  assert.equal(bash[0].error, null);
  for (const tool of tools.filter((tool) => tool !== bash[0])) {
    assert.equal(tool.name, 'task_notification');
    assert.equal(tool.metadata?.synthetic, true);
    assert.equal(tool.metadata?.source, 'claude_task_notification');
    assert.equal(tool.metadata?.toolUseId, bash[0].callId);
  }
};
const wait = async (predicate) => {
  const deadline = Date.now() + 65000;
  do {
    const w = await read();
    if (predicate(w)) return w;
    assert.ok(!['attention', 'permission'].includes(w.status), JSON.stringify({ status: w.status, error: w.error }));
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw Error('Checkpoint timeout; inspect the saved intent without resending');
};
const send = async (text) => {
  const intent = { text, messageId: randomUUID() };
  proof.intents.push(intent);
  await save();
  const result = await api.agents.ref(source.agentId).run(text, { messageId: intent.messageId, timeoutMs: 65000 });
  assert.equal(result.status, 'idle');
  intent.receipt = result;
  await save();
};
try {
  await api.connect();
  await client.connect();
  if (capture) {
    assert.ok(proof.failure && proof.lastRecord && !proof.after);
    assert.ok(proof.intents.every((intent) => intent.receipt?.status === 'idle'));
    const current = await record();
    assert.deepEqual(current, proof.lastRecord);
    assert.equal(current.status, 'awaiting_plan');
    assert.equal(current.planVersions.length, proof.before.planVersions.length + 1);
    assert.deepEqual(current.planVersions.slice(0, -1), proof.before.planVersions);
    assert.equal(current.planVersions.at(-1).source, 'reviewer');
    assert.equal(current.events.filter((e) => e.kind === 'dispatch' && e.role === 'builder').length, 0);
    const state = await read();
    assert.equal(state.testsApproved, false);
    proof.reviewerTimeline = await timeline(proof.reviewerId);
    assertTools(proof.reviewerTimeline);
    assertModelTimelineRestored(proof.reviewerTimeline, proof.reviewerTimeline, source.workflowId, proof.operationIds);
    assert.equal((await timeline(proof.builderId)).agent.lastUserMessageAt, null);
    assert.equal(
      execFileSync('git', ['-C', source.root, 'status', '--porcelain'], { encoding: 'utf8' }),
      proof.gitStatus,
    );
    proof.attemptFailures = [...(proof.attemptFailures ?? []), proof.failure];
    delete proof.failure;
    proof.after = current;
    await save();
    console.log('PASS captured exact completed natural conversation without command or model resend: ' + file);
  } else if (checkpoint) {
    assert.ok(proof.after && !proof.failure);
    const current = await record();
    assert.equal(current.status, 'paused');
    assert.equal(current.events.length, proof.after.events.length + 1);
    assert.equal(current.events.at(-1).kind, 'paused');
    assert.deepEqual(
      { ...current, status: proof.after.status, events: current.events.slice(0, -1) },
      proof.after,
      'Only the native session-close pause may precede this restart checkpoint',
    );
    proof.restartCheckpoint = current;
    await save();
    console.log('PASS exact paused checkpoint captured, no command or model sent: ' + file);
  } else if (verify) {
    assert.ok(proof.after && !proof.failure);
    const expected = proof.restartCheckpoint ?? proof.after;
    assert.deepEqual(await record(), expected);
    // Replay the exact already accepted native command; no new approval or prompt.
    const intent = proof.intents.at(-1);
    assert.equal(intent.text, natural ? 'cette version me convient' : '/team-adopt');
    await api.agents.ref(source.agentId).run(intent.text, { messageId: intent.messageId, timeoutMs: 15000 });
    assert.deepEqual(await record(), expected);
    const restoredTimeline = await timeline(proof.reviewerId);
    restartEvidence = {
      recordReplayVerified: true,
      nativeTimelineVerified: false,
      record: expected,
      reviewerTimeline: restoredTimeline,
    };
    await writeFile(file + '-restart-state.json', JSON.stringify(restartEvidence, null, 2));
    assertModelTimelineRestored(proof.reviewerTimeline, restoredTimeline, source.workflowId, proof.operationIds);
    assert.equal((await timeline(proof.builderId)).agent.lastUserMessageAt, null);
    assert.equal(
      execFileSync('git', ['-C', source.root, 'status', '--porcelain'], { encoding: 'utf8' }),
      proof.gitStatus,
    );
    await writeFile(
      file + '-restart.json',
      JSON.stringify(
        { verified: true, record: await record(), reviewerTimeline: await timeline(proof.reviewerId) },
        null,
        2,
      ),
    );
    console.log('PASS native adoption replay and Reviewer context after isolated restart: ' + file);
  } else {
    let w = await read();
    assert.ok(w && w.ownerAgentId === source.agentId);
    assert.ok(w.plan && !w.operation && !w.testsApproved && !w.planProposal);
    assert.ok(w.config.validation !== 'autonomous' && !w.config.builderAutoAccept);
    assert.ok(['paused', 'awaiting_plan'].includes(w.status));
    const catalog = await rpc('catalog', { workspaceId: source.workspaceId });
    assert.ok(
      catalog.providers.some((p) => p.models.some((m) => p.id + '/' + m.id === w.config.roles.reviewer.provider)),
    );
    proof.before = await record();
    proof.gitStatus = execFileSync('git', ['-C', source.root, 'status', '--porcelain'], { encoding: 'utf8' });
    proof.reviewerId = w.agents.reviewer;
    proof.builderId = w.agents.builder;
    assert.equal((await timeline(proof.builderId)).agent.lastUserMessageAt, null);
    if (w.status === 'paused') {
      await send(natural ? 'reprends' : '/team-resume');
      w = await wait((v) => v.status === 'awaiting_plan');
    }
    const before = structuredClone(w);
    const previousDispatches = before.events.filter((e) => e.kind === 'dispatch' && e.role === 'reviewer').length;
    await send(
      (natural ? '' : '/team-revise ') +
        (source.activityDelay
          ? 'Avant de répondre, exécute une seule commande Bash sleep 8, sans lire ni modifier de fichier. '
          : '') +
        'Discussion uniquement, sans modification. Retourne exactement {"kind":"discussion","summary":"Conserver le périmètre et préciser les critères avant adoption."}.',
    );
    w = await wait(
      (v) => !v.operation && v.phase !== 'followup' && v.followupResult?.includes('Conserver le périmètre'),
    );
    assert.deepEqual(w.plan, before.plan);
    assert.deepEqual(w.planVersions, before.planVersions);
    assert.equal(w.planProposal, undefined);
    proof.discussion = await record();
    const plan = {
      ...w.plan,
      summary: 'Plan révisé dans le fil Team',
      tasks: ['Vérifier la feuille de route et préserver le dépôt'],
      tests: [{ command: 'git diff --check -- README.md', timeoutMs: 10000 }],
    };
    const envelope = { kind: 'proposal', summary: 'Préciser le contrôle sans changer les fichiers', plan };
    await send(
      (natural ? '' : '/team-revise ') +
        'Propose cette version complète. Aucun outil, aucune modification. Retourne exactement ce JSON : ' +
        JSON.stringify(envelope),
    );
    w = await wait((v) => !!v.planProposal && !v.operation && v.phase !== 'followup');
    assert.deepEqual(w.plan, before.plan);
    assert.deepEqual(w.planVersions, before.planVersions);
    assert.deepEqual(w.planProposal.plan, plan);
    proof.proposal = await record();
    await save();
    if (source.observeMs) {
      assert.ok(source.observeMs > 0 && source.observeMs <= 20000);
      await new Promise((resolve) => setTimeout(resolve, source.observeMs));
    }
    await send(natural ? 'cette version me convient' : '/team-adopt');
    w = await wait(
      (v) =>
        v.status === 'awaiting_plan' && !v.planProposal && v.planVersions.length === before.planVersions.length + 1,
    );
    assert.deepEqual(w.plan, plan);
    assert.deepEqual(w.planVersions.slice(0, -1), before.planVersions);
    assert.equal(w.planVersions.at(-1).source, 'reviewer');
    assert.equal(w.testsApproved, false);
    assert.equal(w.events.filter((e) => e.kind === 'dispatch' && e.role === 'builder').length, 0);
    const dispatches = w.events.filter((e) => e.kind === 'dispatch' && e.role === 'reviewer');
    assert.equal(dispatches.length - previousDispatches, 2, 'Exactly two new Reviewer turns, no format repair loop');
    proof.operationIds = dispatches.map((e) => e.operationId);
    proof.reviewerTimeline = await timeline(proof.reviewerId);
    assertTools(proof.reviewerTimeline);
    assertModelTimelineRestored(proof.reviewerTimeline, proof.reviewerTimeline, source.workflowId, proof.operationIds);
    assert.equal((await timeline(proof.builderId)).agent.lastUserMessageAt, null);
    assert.equal(
      execFileSync('git', ['-C', source.root, 'status', '--porcelain'], { encoding: 'utf8' }),
      proof.gitStatus,
    );
    proof.after = await record();
    proof.assertions.push(
      'Two real read-only Reviewer turns through native Team commands; discussion and proposal preserve the current plan',
      'Explicit adoption preserves previous versions, creates a Reviewer version, still requires test approval and never dispatches Builder',
    );
    await save();
    console.log('PASS native Team discussion → proposal → explicit adoption; awaiting approval: ' + file);
  }
} catch (error) {
  if (verify && restartEvidence) {
    restartEvidence.failure = String(error);
    await writeFile(file + '-restart-state.json', JSON.stringify(restartEvidence, null, 2));
  }
  if (!verify && !checkpoint && !capture) {
    proof.failure = String(error);
    proof.lastRecord = await record().catch(() => null);
    await save();
  }
  throw error;
} finally {
  clearTimeout(watchdog);
  await client.close();
  await api.close();
}
