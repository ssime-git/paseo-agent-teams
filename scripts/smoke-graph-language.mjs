import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createPaseoClient } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';

// Opt-in: two isolated read-only turns maximum, 120 seconds each; no model retry.
const url = process.env.PASEO_TEAMS_SMOKE_URL;
assert.ok(url, 'Explicit isolated daemon required');
const endpoint = new URL(url);
assert.ok(['127.0.0.1', 'localhost'].includes(endpoint.hostname) && endpoint.port && endpoint.port !== '6767');
const api = createPaseoClient({ url, reconnect: { enabled: false } });
const transport = new DaemonClient({
  url,
  clientId: randomUUID(),
  clientType: 'cli',
  appVersion: '0.13.0',
  reconnect: { enabled: false },
});
const rpc = (name, input) => transport.invokePluginRpc('paseo-agent-teams', 'teams.' + name, input);
const file = process.argv[2];
const proof = file
  ? JSON.parse(await readFile(file, 'utf8'))
  : { root: await mkdtemp('/tmp/teams-graph-language-'), url, results: [] };
assert.equal(proof.url, url);
const proofFile = file ?? proof.root + '-proof.json';
const save = () => writeFile(proofFile, JSON.stringify(proof, null, 2));
const outerDeadline = setTimeout(() => {
  console.error('Graph language smoke exceeded 300 seconds');
  process.exit(1);
}, 300000);
try {
  await api.connect();
  await transport.connect();
  if (file) {
    assert.equal(proof.results.length, 2);
    for (const result of proof.results) {
      assert.deepEqual(await rpc('graph_record', result.scope), result.state);
      assert.deepEqual(await rpc('graph_confirm', result.confirmation), result.state);
      const waiting = await rpc('graph_advance', {
        ...result.scope,
        ownerAgentId: result.ownerId,
        expectedRevision: result.state.revision,
      });
      assert.equal(waiting.status, 'waiting');
      assert.deepEqual(waiting.state, result.state);
    }
    proof.verifiedAfterRestart = true;
  } else {
    const discovery = await api.providers.waitForReady({ cwd: proof.root, timeoutMs: 20000 });
    const provider = discovery.entries.find((p) => p.provider === 'codex' && p.status === 'ready');
    const model = provider?.models?.find((m) => m.id === 'gpt-6.1-sol') ?? provider?.models?.[0];
    assert.ok(model, 'Detected ready Codex required');
    proof.discovery = discovery;
    for (const language of ['fr', 'en']) {
      const repo = proof.root + '/' + language;
      execFileSync('git', ['init', '-q', repo]);
      await writeFile(repo + '/README.md', 'Preserve baseline.\n');
      const before = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
      const workspace = await api.workspaces.open(repo);
      const owner = await api.workspaces.ref(workspace.id).agents.create({
        config: { provider: 'agent-teams/auto' },
        title: 'Isolated graph language ' + language,
        idempotencyKey: randomUUID(),
      });
      const source = await rpc('save_definition', {
        workspaceId: workspace.id,
        expectedRevision: 0,
        definition: {
          version: 1,
          name: 'Language clarification ' + language,
          entry: 'plan',
          maxTransitions: 1,
          steps: [
            {
              id: 'plan',
              contract: 'plan',
              access: 'read-only',
              selection: { provider: 'codex/' + model.id, modeId: 'read-only' },
              instruction:
                'Ask one blocking clarification: choose CSV or JSON export. Offer both concrete formats, recommend CSV with a tradeoff, and allow free text. Do not implement.',
              transitions: [
                { outcome: 'success', target: null },
                { outcome: 'failure', target: null },
              ],
            },
          ],
        },
      });
      const launch = {
        workspaceId: workspace.id,
        ownerAgentId: owner.id,
        definitionId: source.id,
        definitionRevision: source.revision,
        task: 'Plan an exporter; format is undecided. Clarify first. Do not edit any file.',
        language,
      };
      const preview = await rpc('graph_preview', launch);
      assert.equal(preview.language, language);
      const confirmation = { ...launch, id: randomUUID(), approveDefinition: true, confirmation: preview.confirmation };
      let state = await rpc('graph_confirm', confirmation);
      const scope = { id: state.id, workspaceId: workspace.id };
      proof.pending = { language, scope, ownerId: owner.id, confirmation };
      await save();
      const deadline = Date.now() + 120000;
      for (let count = 0; count < 130 && Date.now() < deadline; count++) {
        const next = await rpc('graph_advance', { ...scope, ownerAgentId: owner.id, expectedRevision: state.revision });
        state = next.state;
        assert.equal(state.language, language);
        assert.ok(state.activations.length <= 1);
        if (state.activations[0]?.assessment?.status === 'clarification') break;
        assert.notEqual(next.status, 'blocked', next.reason);
        if (next.status === 'waiting') {
          assert.ok(['running', 'completion_receipt_required'].includes(next.reason), next.reason);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      const activation = state.activations[0];
      assert.equal(
        activation.assessment.status,
        'clarification',
        'Deadline exceeded: inspect persisted state; never resend',
      );
      assert.equal(activation.receipt.outcome, 'completed');
      assert.match(activation.dispatch.prompt, language === 'fr' ? /French \(fr\)/ : /English \(en\)/);
      const timeline = await api.agents
        .ref(activation.dispatch.agentId)
        .timeline.refetch({ direction: 'before', limit: 200, projection: 'canonical' });
      assert.equal(timeline.entries.filter((e) => e.item.type === 'user_message').length, 1);
      assert.equal(await readFile(repo + '/README.md', 'utf8'), 'Preserve baseline.\n');
      assert.equal(execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }), before);
      proof.results.push({ language, scope, ownerId: owner.id, confirmation, state, timeline });
      delete proof.pending;
      await save();
    }
  }
  await save();
  console.log('PASS graph language admission/prompt/clarification/persistence: ' + proofFile);
} catch (error) {
  proof.failure = String(error);
  await save();
  throw error;
} finally {
  clearTimeout(outerDeadline);
  await transport.close();
  await api.close();
}
