import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createPaseoClient } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
const url = process.env.PASEO_TEAMS_SMOKE_URL,
  endpoint = new URL(url);
assert.ok(endpoint.hostname === '127.0.0.1' && endpoint.port && endpoint.port !== '6767');
const [mode, file] = process.argv.slice(2);
assert.ok(['start', 'capture', 'verify'].includes(mode));
assert.match(file ?? '', /^\/tmp\/teams-.*\.json$/);
let proof = mode === 'start' ? { url } : JSON.parse(await readFile(file));
assert.equal(proof.url, url);
if (mode === 'start') await assert.rejects(readFile(file), { code: 'ENOENT' });
const save = () => writeFile(file, JSON.stringify(proof, null, 2));
const api = createPaseoClient({ url, reconnect: { enabled: false } }),
  raw = new DaemonClient({ url, clientId: randomUUID(), clientType: 'cli', appVersion: '0.16.2' });
const rpc = (n, i) => raw.invokePluginRpc('paseo-agent-teams', 'teams.' + n, i);
const state = () => rpc('graph_record', { id: proof.id, workspaceId: proof.workspaceId });
const advance = (s) =>
  rpc('graph_advance', {
    id: proof.id,
    workspaceId: proof.workspaceId,
    ownerAgentId: proof.ownerId,
    expectedRevision: s.revision,
  });
const timer = setTimeout(() => {
  console.error('180 s permission budget exceeded; inspect the pending request');
  process.exit(1);
}, 180000);
try {
  await api.connect();
  await raw.connect();
  if (mode === 'start') {
    proof.repo = file.replace(/\.json$/, '') + '/repo';
    await mkdir(proof.repo, { recursive: true });
    execFileSync('git', ['init', '-q', proof.repo]);
    await writeFile(proof.repo + '/protected.txt', 'untouched\n');
    proof.workspaceId = (await api.workspaces.open(proof.repo)).id;
    const choices = await rpc('choices', { workspaceId: proof.workspaceId });
    const c = choices.find((c) => c.id === 'claude');
    assert.ok(c.models.some((m) => m.id === 'claude-haiku-5-5'));
    assert.ok(c.modes.some((m) => m.id === 'default'));
    const owner = await api.workspaces
      .ref(proof.workspaceId)
      .agents.create({
        config: { provider: 'agent-teams/auto' },
        title: 'Graph permission refusal',
        idempotencyKey: randomUUID(),
      });
    proof.ownerId = owner.id;
    await owner.commands();
    proof.id = randomUUID();
    const definition = {
      version: 1,
      name: 'Refus Write natif dans un graphe',
      entry: 'write',
      maxTransitions: 1,
      steps: [
        {
          id: 'write',
          instruction:
            'Essai contrôlé de permission : appelle le tool Write une seule fois pour remplacer protected.txt par changed suivi d’un saut de ligne. N’utilise pas Bash, Edit ni un autre outil. Si refusé, ne contourne pas le refus. Aucun commit ou réseau.',
          selection: { provider: 'claude/claude-haiku-5-5', modeId: 'default' },
          access: 'write',
          contract: 'build',
          transitions: [
            { outcome: 'success', target: null },
            { outcome: 'failure', target: null },
          ],
        },
      ],
    };
    const source = await rpc('save_definition', { workspaceId: proof.workspaceId, expectedRevision: 0, definition });
    const request = {
      workspaceId: proof.workspaceId,
      ownerAgentId: proof.ownerId,
      definitionId: source.id,
      definitionRevision: source.revision,
      task: 'Fixture isolée de permission native ; un seul Write, qui sera explicitement refusé.',
      language: 'fr',
    };
    const preview = await rpc('graph_preview', request);
    proof.intent = { ...request, id: proof.id, approveDefinition: true, confirmation: preview.confirmation };
    await save();
    await rpc('graph_confirm', proof.intent);
    let s;
    const until = Date.now() + 100000;
    let permission;
    while (Date.now() < until) {
      s = await state();
      const r = await advance(s);
      s = r.state;
      const a = s.activations.at(-1);
      if (a?.dispatch) {
        const h = api.agents.ref(a.dispatch.agentId);
        await h.refresh();
        permission = h.pendingPermissions?.[0];
        if (permission) {
          proof.agentId = h.id;
          break;
        }
      }
      assert.notEqual(r.status, 'blocked', r.reason);
      await new Promise((r) => setTimeout(r, 350));
    }
    assert.ok(permission, 'Actual native permission required');
    proof.permission = permission;
    proof.beforeDenial = await state();
    assert.equal((await advance(proof.beforeDenial)).reason, 'permission');
    assert.deepEqual(await state(), proof.beforeDenial);
    await save();
    await api.agents
      .ref(proof.agentId)
      .respondToPermission({ requestId: permission.id, response: { behavior: 'deny', interrupt: true } });
    for (let i = 0; i < 100; i++) {
      const a = api.agents.ref(proof.agentId);
      await a.refresh();
      if (!a.activeTurn && !a.pendingPermissions?.length && ['idle', 'closed', 'error'].includes(a.status)) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    for (let i = 0; i < 10; i++) {
      const result = await advance(await state());
      if (result.status === 'blocked' || result.reason === 'uncertain') {
        proof.blockedReason = result.reason;
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    proof.checkpoint = await state();
    assert.equal(proof.checkpoint.activations.length, 1);
    assert.equal(
      proof.checkpoint.activations[0].dispatch.attemptId,
      proof.beforeDenial.activations[0].dispatch.attemptId,
    );
    assert.ok(proof.blockedReason);
    const page = await api.agents
      .ref(proof.agentId)
      .timeline.refetch({ direction: 'before', limit: 100, projection: 'canonical' });
    proof.prompts = page.entries.filter((e) => e.item.type === 'user_message').map((e) => e.item.text);
    proof.failedWrite = page.entries.some(
      (e) => e.item.type === 'tool_call' && e.item.name === 'Write' && e.item.status === 'failed',
    );
    assert.equal(proof.failedWrite, true);
    await save();
  } else if (mode === 'capture') {
    const result = await advance(await state());
    assert.ok(result.status === 'blocked' || result.reason === 'uncertain');
    proof.blockedReason = result.reason;
    proof.checkpoint = await state();
    const page = await api.agents
      .ref(proof.agentId)
      .timeline.refetch({ direction: 'before', limit: 100, projection: 'canonical' });
    proof.prompts = page.entries.filter((e) => e.item.type === 'user_message').map((e) => e.item.text);
    proof.failedWrite = page.entries.some(
      (e) => e.item.type === 'tool_call' && e.item.name === 'Write' && e.item.status === 'failed',
    );
    assert.ok(proof.failedWrite);
    proof.previousFailure = proof.failure;
    delete proof.failure;
  } else {
    assert.deepEqual(await state(), proof.checkpoint);
    const a = api.agents.ref(proof.agentId);
    await a.refresh();
    assert.ok(!a.activeTurn && !a.pendingPermissions?.length);
    const page = await a.timeline.refetch({ direction: 'before', limit: 100, projection: 'canonical' });
    assert.deepEqual(
      page.entries.filter((e) => e.item.type === 'user_message').map((e) => e.item.text),
      proof.prompts,
    );
  }
  assert.equal(await readFile(proof.repo + '/protected.txt', 'utf8'), 'untouched\n');
  await save();
  console.log('PASS graph permission ' + mode + ': ' + file);
} catch (error) {
  proof.failure = String(error);
  await save();
  throw error;
} finally {
  clearTimeout(timer);
  await raw.close();
  await api.close();
}
