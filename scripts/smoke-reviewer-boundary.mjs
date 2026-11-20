import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createPaseoClient } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
const url = process.env.PASEO_TEAMS_SMOKE_URL,
  endpoint = new URL(url);
assert.ok(endpoint.hostname === '127.0.0.1' && endpoint.port && endpoint.port !== '6767');
const dataDirectory = process.env.PASEO_TEAMS_SMOKE_DATA_DIR;
assert.match(dataDirectory ?? '', /^\/tmp\/teams-/);
const [mode, file] = process.argv.slice(2);
assert.ok(['start', 'continue', 'verify', 'adopt'].includes(mode));
assert.match(file ?? '', /^\/tmp\/teams-.*\.json$/);
let proof = mode === 'start' ? { url, intents: [] } : JSON.parse(await readFile(file));
assert.equal(proof.url, url);
if (mode === 'start') await assert.rejects(readFile(file), { code: 'ENOENT' });
const save = () => writeFile(file, JSON.stringify(proof, null, 2));
const api = createPaseoClient({ url, reconnect: { enabled: false } }),
  raw = new DaemonClient({ url, clientId: randomUUID(), clientType: 'cli', appVersion: '0.16.2' });
const rpc = (n, i) => raw.invokePluginRpc('paseo-agent-teams', 'teams.' + n, i);
const state = async () => (await rpc('list', { workspaceId: proof.workspaceId })).find((w) => w.id === proof.id);
const input = (w, action, extra = {}) => ({
  id: w.id,
  workspaceId: w.workspaceId,
  expectedRevision: w.revision,
  requestId: randomUUID(),
  action,
  ...extra,
});
const action = async (name, extra = {}) => {
  const i = input(await state(), name, extra);
  proof.intents.push(i);
  await save();
  return rpc('action', i);
};
const wait = async (p, seconds = 100) => {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const w = await state();
    if (await p(w)) return w;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw Error('Bounded checkpoint timeout');
};
const timer = setTimeout(() => {
  console.error('360 s bound reached, do not resend');
  process.exit(1);
}, 360000);
const native = async (agentId, prompt) => {
  const id = randomUUID();
  proof.intents.push({ agentId, prompt, id });
  await save();
  const result = await api.agents.ref(agentId).run(prompt, { messageId: id, timeoutMs: 90000 });
  assert.equal(result.status, 'idle');
  return result;
};
try {
  await api.connect();
  await raw.connect();
  if (mode === 'start') {
    proof.repo = file.replace(/\.json$/, '') + '/repo';
    await mkdir(proof.repo, { recursive: true });
    await writeFile(proof.repo + '/README.md', 'Preserve user documentation.\n');
    execFileSync('git', ['init', '-q', proof.repo]);
    proof.workspaceId = (await api.workspaces.open(proof.repo)).id;
    const choices = await rpc('choices', { workspaceId: proof.workspaceId });
    proof.choices = choices;
    const select = (p, m, modeId) => {
      assert.ok(choices.find((c) => c.id === p)?.models.some((c) => c.id === m));
      return { provider: p + '/' + m, modeId };
    };
    const planner = select('claude', 'claude-sonnet-5-5', 'plan'),
      reviewer = select('claude', 'claude-haiku-5-5', 'plan'),
      replacement = select('codex', 'gpt-6.1-sol', 'read-only');
    proof.replacement = replacement;
    const plan = {
      summary: 'Plan initial',
      tasks: ['Créer GUIDE.md sans modifier README.md'],
      acceptance: ['README.md inchangé'],
      tests: [{ command: 'git diff --check', timeoutMs: 5000 }],
    };
    proof.expectedPlan = plan;
    const config = {
      version: 1,
      mode: 'auto',
      validation: 'plan',
      maxCorrections: 0,
      recovery: 'explicit',
      roles: { planner, builder: replacement, reviewer },
    };
    proof.create = {
      workspaceId: proof.workspaceId,
      requestId: randomUUID(),
      config,
      task:
        'Fixture de lecture seule. Planner retourne exactement ' +
        JSON.stringify(plan) +
        '. Aucun Builder avant accord humain. Aucun outil nécessaire, ne modifie rien.',
    };
    await save();
    proof.id = (await rpc('create', proof.create)).id;
    await save();
    let w = await wait((w) => w.status === 'awaiting_plan' && w.plan);
    proof.initial = w;
    await action('followup', {
      purpose: 'plan_revision',
      message:
        'Discussion en lecture seule. Pour laisser observer le tour actif, exécute seulement Bash sleep 15 une fois, puis retourne exactement {"kind":"discussion","summary":"Conserver README.md et clarifier la vérification."}. Aucun autre outil ni modification.',
    });
    w = await wait((w) => w.operation?.role === 'reviewer' && w.operation.state === 'sent');
    proof.active = w;
    await action('pause');
    const blocked = await state();
    await assert.rejects(
      rpc('action', input(blocked, 'reconfigure', { role: 'reviewer', selection: replacement })),
      /checkpoint|turn|active|running/i,
    );
    assert.deepEqual(await state(), blocked);
  }
  if (mode === 'start' || mode === 'continue') {
    const plan = proof.expectedPlan ?? proof.initial.plan,
      replacement = proof.replacement;
    let w = await state();
    if (w.operation) {
      await wait(async (w) => {
        const persisted = JSON.parse(await readFile(dataDirectory + '/' + w.id + '.json'));
        return persisted.receipts?.[w.operation?.id];
      });
      await action('resume');
      await wait((w) => w.status === 'awaiting_plan' && !w.operation);
      await action('pause');
    }
    w = await wait((w) => w.status === 'paused' && !w.operation);
    proof.originalReviewer = w.agents.reviewer;
    await native(
      w.agents.reviewer,
      'Lecture seule, aucun outil. Retourne exactement {"unexpected":"invalid plan response"}.',
    );
    const beforeInvalid = await state();
    await assert.rejects(action('import_reviewer_plan'));
    assert.deepEqual(await state(), beforeInvalid);
    proof.invalidRejected = true;
    await action('reconfigure', { role: 'reviewer', selection: replacement });
    const revised = {
      ...plan,
      summary: 'Plan proposé par le nouveau Reviewer',
      tests: [{ command: 'git diff --check -- README.md GUIDE.md', timeoutMs: 5000 }],
    };
    await action('followup', {
      purpose: 'plan_revision',
      message:
        'Lecture seule, aucun outil. Retourne exactement ' +
        JSON.stringify({ kind: 'proposal', summary: 'Vérification limitée aux fichiers du plan', plan: revised }),
    });
    w = await wait((w) => w.status === 'paused' && !w.operation && w.planProposal);
    assert.notEqual(w.agents.reviewer, proof.originalReviewer);
    assert.deepEqual(w.planProposal.selection, replacement);
    assert.deepEqual(w.plan, plan);
    const final = { ...revised, summary: 'Plan final natif Reviewer' };
    const envelope = {
      workflowId: w.id,
      baseVersion: w.planVersions.at(-1).version,
      kind: 'proposal',
      summary: 'Proposition finale native avec provenance',
      plan: final,
    };
    await native(w.agents.reviewer, 'Lecture seule, aucun outil. Retourne exactement ' + JSON.stringify(envelope));
    const base = await state(),
      first = input(base, 'import_reviewer_plan'),
      second = { ...first, requestId: randomUUID() };
    proof.intents.push(first, second);
    await save();
    const results = await Promise.allSettled([rpc('action', first), rpc('action', second)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
    w = await state();
    assert.deepEqual(w.plan, plan);
    assert.deepEqual(w.planProposal.plan, final);
    assert.ok(w.planProposal.nativeSource);
    assert.equal(w.testsApproved, false);
    proof.checkpoint = w;
    proof.native = {};
    for (const id of [proof.originalReviewer, w.agents.reviewer]) {
      const p = await api.agents.ref(id).timeline.refetch({ direction: 'before', limit: 120, projection: 'canonical' });
      proof.native[id] = p.entries.filter((e) => e.item.type === 'user_message').map((e) => e.item.text);
    }
  } else {
    assert.deepEqual(await state(), mode === 'verify' && proof.final ? proof.final : proof.checkpoint);
    for (const [id, prompts] of Object.entries(proof.native)) {
      const p = await api.agents.ref(id).timeline.refetch({ direction: 'before', limit: 120, projection: 'canonical' });
      assert.deepEqual(
        p.entries.filter((e) => e.item.type === 'user_message').map((e) => e.item.text),
        prompts,
      );
    }
    if (mode === 'adopt') {
      let w = await state();
      const proposal = structuredClone(w.planProposal),
        first = input(w, 'adopt_plan'),
        second = { ...first, requestId: randomUUID() };
      proof.intents.push(first, second);
      await save();
      const results = await Promise.allSettled([rpc('action', first), rpc('action', second)]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const index = results.findIndex((r) => r.status === 'fulfilled');
      w = results[index].value;
      assert.deepEqual(await rpc('action', index === 0 ? first : second), w);
      assert.deepEqual(w.plan, proposal.plan);
      assert.deepEqual(w.planVersions.at(-1).nativeSource, proposal.nativeSource);
      assert.equal(w.testsApproved, false);
      w = await action('resume');
      assert.equal(w.status, 'awaiting_plan');
      assert.ok(!w.events.some((e) => e.kind === 'dispatch' && e.role === 'builder'));
      await action('pause');
      proof.final = await state();
      proof.verified = true;
    }
  }
  if (proof.failure) {
    proof.previousFailure = proof.failure;
    delete proof.failure;
  }
  assert.equal(await readFile(proof.repo + '/README.md', 'utf8'), 'Preserve user documentation.\n');
  await save();
  console.log('PASS Reviewer ' + mode + ': ' + file);
} catch (error) {
  proof.failure = String(error);
  await save();
  throw error;
} finally {
  clearTimeout(timer);
  await raw.close();
  await api.close();
}
