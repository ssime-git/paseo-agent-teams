import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createPaseoClient } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
const url = process.env.PASEO_TEAMS_SMOKE_URL,
  endpoint = new URL(url),
  data = process.env.PASEO_TEAMS_SMOKE_DATA_DIR;
assert.ok(endpoint.hostname === '127.0.0.1' && endpoint.port && endpoint.port !== '6767');
assert.match(data ?? '', /^\/tmp\/teams-/);
const [mode, file] = process.argv.slice(2);
assert.ok(['seed', 'continue', 'concurrency', 'verify'].includes(mode));
assert.match(file ?? '', /^\/tmp\/teams-.*\.json$/);
let proof = mode === 'seed' ? { url, negativeProviders: [] } : JSON.parse(await readFile(file));
assert.equal(proof.url, url);
if (mode === 'seed') await assert.rejects(readFile(file), { code: 'ENOENT' });
const save = () => writeFile(file, JSON.stringify(proof, null, 2));
const api = createPaseoClient({ url, reconnect: { enabled: false } }),
  raw = new DaemonClient({ url, clientId: randomUUID(), clientType: 'cli', appVersion: '0.16.2' });
const rpc = (n, i) => raw.invokePluginRpc('paseo-agent-teams', 'teams.' + n, i);
const timer = setTimeout(() => {
  console.error('180 s compatibility budget exceeded');
  process.exit(1);
}, 180000);
try {
  await api.connect();
  await raw.connect();
  const base = file.replace(/\.json$/, '');
  if (mode === 'concurrency') {
    assert.ok(!proof.concurrent, 'Never recreate a recorded concurrent attempt');
    const repo = base + '/concurrency';
    await mkdir(repo, { recursive: true });
    execFileSync('git', ['init', '-q', repo]);
    const ws = await api.workspaces.open(repo),
      owner = await ws.agents.create({
        config: { provider: 'agent-teams/auto' },
        title: 'Concurrent human decisions',
        idempotencyKey: randomUUID(),
      });
    const definition = {
      version: 1,
      name: 'Two clients and bounded human loop',
      entry: 'human',
      maxTransitions: 1,
      steps: [
        {
          id: 'human',
          instruction: 'Explicit fixture decision only',
          selection: { provider: 'human/decision', modeId: 'explicit' },
          access: 'read-only',
          contract: 'human',
          transitions: [
            { outcome: 'approve', target: 'human' },
            { outcome: 'reject', target: null },
          ],
        },
      ],
    };
    const source = await rpc('save_definition', { workspaceId: ws.id, expectedRevision: 0, definition });
    const launch = {
      workspaceId: ws.id,
      ownerAgentId: owner.id,
      definitionId: source.id,
      definitionRevision: source.revision,
      task: 'Two authenticated clients compete for one explicit decision. No model execution.',
      language: 'fr',
    };
    const preview = await rpc('graph_preview', launch);
    let state = await rpc('graph_confirm', {
      ...launch,
      id: randomUUID(),
      approveDefinition: true,
      confirmation: preview.confirmation,
    });
    const scope = { id: state.id, workspaceId: ws.id, ownerAgentId: owner.id };
    state = (await rpc('graph_advance', { ...scope, expectedRevision: state.revision })).state;
    const requests = [0, 1].map((i) => ({
      ...scope,
      expectedRevision: state.revision,
      operationId: state.activations[0].operationId,
      submission: {
        action: 'decide',
        decision: { id: randomUUID(), outcome: 'approve', summary: 'Explicit fixture approval from client ' + i },
      },
    }));
    proof.concurrent = { requests };
    await save();
    const second = new DaemonClient({ url, clientId: randomUUID(), clientType: 'cli', appVersion: '0.16.2' });
    try {
      await second.connect();
      const other = (name, input) => second.invokePluginRpc('paseo-agent-teams', 'teams.' + name, input);
      const results = await Promise.allSettled([
        rpc('graph_response', requests[0]),
        other('graph_response', requests[1]),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const winner = results.findIndex((r) => r.status === 'fulfilled'),
        saved = results[winner].value;
      assert.equal(saved.status, 'exhausted');
      assert.equal(saved.activations.length, 1);
      assert.equal(saved.activations[0].dispatch, undefined);
      assert.deepEqual(await other('graph_response', requests[winner]), saved);
      assert.deepEqual((await rpc('graph_advance', { ...scope, expectedRevision: saved.revision })).state, saved);
      proof.concurrent = { ...proof.concurrent, clients: 2, winner, checkpoint: saved, verified: true };
    } finally {
      await second.close();
    }
  } else if (mode !== 'verify') {
    if (mode === 'seed') {
      proof.repo = base + '/legacy';
      await mkdir(proof.repo, { recursive: true });
      execFileSync('git', ['init', '-q', proof.repo]);
      await writeFile(proof.repo + '/README.md', 'Legacy user file.\n');
      proof.workspaceId = (await api.workspaces.open(proof.repo)).id;
      const choices = await rpc('choices', { workspaceId: proof.workspaceId });
      proof.choices = choices;
      assert.ok(choices.find((c) => c.id === 'codex')?.models.some((m) => m.id === 'gpt-6.1-sol'));
      const selection = { provider: 'codex/gpt-6.1-sol', modeId: 'read-only' };
      proof.id = randomUUID();
      proof.legacy = {
        version: 1,
        id: proof.id,
        revision: 1,
        workspaceId: proof.workspaceId,
        cwd: proof.repo,
        repo: proof.repo + '/.git',
        task: 'Synthetic historical V1 fixture; never dispatch.',
        config: {
          version: 1,
          mode: 'auto',
          roles: { planner: selection, builder: selection, reviewer: selection },
          validation: 'plan',
          recovery: 'explicit',
        },
        agents: {},
        phase: 'building',
        status: 'paused',
        cycle: 0,
        plan: {
          summary: 'Legacy approved plan',
          tasks: ['Preserve operation'],
          acceptance: ['No replay'],
          tests: [{ command: 'git diff --check', timeoutMs: 5000 }],
        },
        tests: [],
        testsApproved: true,
        allowNoTests: false,
        events: [{ id: 'old-approval', at: '2020-01-01T00:00:00.000Z', kind: 'approved', text: 'Existing approval' }],
        requests: {},
        cursors: {},
        baseline: base + '/baseline',
        operation: {
          id: randomUUID(),
          role: 'builder',
          phase: 'building',
          state: 'prepared',
          startedAt: '2020-01-01T00:00:00.000Z',
        },
      };
      await save();
      await writeFile(data + '/' + proof.id + '.json', JSON.stringify(proof.legacy));
    }
    for (const provider of proof.choices.filter(
      (c) =>
        !['claude', 'codex'].includes(c.id) &&
        c.models.length &&
        !proof.negativeProviders.some((row) => row.provider === c.id),
    )) {
      const repo = base + '/' + provider.id;
      await mkdir(repo, { recursive: true });
      execFileSync('git', ['init', '-q', repo]);
      const ws = await api.workspaces.open(repo);
      const owner = await ws.agents.create({
        config: { provider: 'agent-teams/auto' },
        title: 'Compatibility ' + provider.id,
        idempotencyKey: randomUUID(),
      });
      const model = provider.models.find((m) => m.isDefault) ?? provider.models[0],
        mode = provider.modes.find((m) => !m.id.startsWith('__')) ?? provider.modes[0];
      assert.ok(mode);
      const definition = {
        version: 1,
        name: 'Analysis capability ' + provider.id,
        entry: 'inspect',
        maxTransitions: 1,
        steps: [
          {
            id: 'inspect',
            instruction: 'Read-only capability probe. Never dispatch on an unverified sandbox.',
            selection: { provider: provider.id + '/' + model.id, modeId: mode.id },
            access: 'read-only',
            contract: 'review',
            transitions: [
              { outcome: 'success', target: null },
              { outcome: 'failure', target: null },
            ],
          },
        ],
      };
      const source = await rpc('save_definition', { workspaceId: ws.id, expectedRevision: 0, definition });
      const request = {
        workspaceId: ws.id,
        ownerAgentId: owner.id,
        definitionId: source.id,
        definitionRevision: source.revision,
        task: 'Negative capability test only; no native model execution.',
      };
      let checkpoint;
      let error;
      try {
        const preview = await rpc('graph_preview', request);
        assert.equal(preview.language, undefined);
        checkpoint = await rpc('graph_confirm', {
          ...request,
          id: randomUUID(),
          approveDefinition: true,
          confirmation: preview.confirmation,
        });
        const scope = { id: checkpoint.id, workspaceId: ws.id, ownerAgentId: owner.id };
        checkpoint = (await rpc('graph_advance', { ...scope, expectedRevision: checkpoint.revision })).state;
        await rpc('graph_advance', { ...scope, expectedRevision: checkpoint.revision });
        assert.fail('Unverified graph analysis must be rejected');
      } catch (e) {
        error = String(e);
        assert.match(error, /verified native read-only|READ_ONLY_REQUIRED|read.only/i);
      }
      if (checkpoint) {
        const current = await rpc('graph_record', { id: checkpoint.id, workspaceId: ws.id });
        assert.equal(current.activations.length, 1);
        assert.equal(current.activations[0].dispatch, undefined);
        checkpoint = current;
      }
      proof.negativeProviders.push({ provider: provider.id, model: model.id, mode: mode.id, error, checkpoint });
      await save();
    }
  } else {
    const w = (await rpc('list', { workspaceId: proof.workspaceId })).find((w) => w.id === proof.id);
    assert.ok(w);
    assert.equal(w.status, 'paused');
    assert.deepEqual(w.operation, proof.legacy.operation);
    assert.deepEqual(w.plan, proof.legacy.plan);
    assert.equal(w.testsApproved, true);
    assert.equal(w.planVersions.length, 1);
    assert.equal(w.planVersions[0].source, 'legacy');
    assert.equal(w.planVersions[0].approval.policy, 'legacy');
    assert.equal(w.language, undefined);
    assert.equal(w.config.teamOrchestration, undefined);
    assert.equal(w.config.reviewOnly, undefined);
    assert.ok(!w.events.some((e) => e.kind === 'dispatch'));
    if (proof.migrated) assert.deepEqual(w, proof.migrated);
    else proof.migrated = w;
    for (const row of proof.negativeProviders.filter((r) => r.checkpoint)) {
      const current = await rpc('graph_record', {
        id: row.checkpoint.id,
        workspaceId: row.checkpoint.source.workspaceId,
      });
      assert.deepEqual(current, row.checkpoint);
    }
    assert.equal(await readFile(proof.repo + '/README.md', 'utf8'), 'Legacy user file.\n');
    if (proof.concurrent?.checkpoint)
      assert.deepEqual(
        await rpc('graph_record', {
          id: proof.concurrent.checkpoint.id,
          workspaceId: proof.concurrent.checkpoint.source.workspaceId,
        }),
        proof.concurrent.checkpoint,
      );
    proof.verified = true;
  }
  if (proof.failure) {
    proof.previousFailure = proof.failure;
    delete proof.failure;
  }
  await save();
  console.log('PASS compatibility ' + mode + ': ' + file);
} catch (error) {
  proof.failure = String(error);
  await save();
  throw error;
} finally {
  clearTimeout(timer);
  await raw.close();
  await api.close();
}
