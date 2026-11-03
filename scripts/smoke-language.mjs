import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createPaseoClient } from '@getpaseo/client';
import { PaseoRuntime } from '../server/runtime.ts';
import { Store } from '../server/store.ts';
import { buildPrompt } from '../server/prompt.ts';
import { parseResult } from '../server/result-parser.ts';
import { workflowFixture } from '../tests/fixtures.ts';

// Opt-in: two real read-only Planner turns, at most 120 seconds each, no retries.
// The caller owns the isolated daemon lifecycle. Evidence stays outside the repos.
const url = process.env.PASEO_TEAMS_SMOKE_URL;
assert.ok(url, 'Set PASEO_TEAMS_SMOKE_URL to an isolated daemon');
const endpoint = new URL(url);
assert.ok(
  ['ws:', 'wss:'].includes(endpoint.protocol) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) &&
    endpoint.port &&
    endpoint.port !== '6767',
  'Use an explicit isolated loopback port, never primary port 6767',
);
const proof = process.argv[2]
  ? JSON.parse(await readFile(process.argv[2], 'utf8'))
  : { root: await mkdtemp('/tmp/teams-language-'), url, results: [] };
assert.equal(proof.url, url);
assert.ok(!proof.pending, 'An unverified native turn must be captured explicitly before continuation');
const root = proof.root;
const data = root + '/state';
await mkdir(data, { recursive: true });
delete proof.failure;
const proofFile = root + '-proof.json';
const api = createPaseoClient({ url, reconnect: { enabled: false } });
try {
  await api.connect();
  const discovery = await api.providers.waitForReady({ cwd: root, timeoutMs: 20000 });
  const provider = discovery.entries.find((p) => p.provider === 'codex' && p.status === 'ready');
  assert.ok(provider, 'A ready Codex provider is required');
  const model = provider.models?.find((m) => m.id === 'gpt-6.1-sol') ?? provider.models?.[0];
  assert.ok(model, 'A detected model is required');
  const modes = await api.providers.listModes('codex', { cwd: root });
  proof.discovery = { provider, modes };
  for (const language of ['fr', 'en']) {
    if (proof.results.some((r) => r.language === language)) continue;
    const repo = root + '/' + language;
    execFileSync('git', ['init', '-q', repo]);
    await writeFile(repo + '/README.md', 'Preserve this baseline.\n');
    const before = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
    const workspace = await api.workspaces.open(repo);
    let hostLanguage = language;
    const runtime = new PaseoRuntime(
      api,
      data,
      () => api,
      async () => hostLanguage,
    );
    const w = workflowFixture();
    w.id = randomUUID();
    w.workspaceId = workspace.id;
    w.config.mode = 'auto';
    w.config.roles.planner = { provider: 'codex/' + model.id, modeId: 'read-only' };
    w.config.roles.reviewer = w.config.roles.planner;
    w.config.roles.builder = { provider: 'codex/' + model.id, modeId: 'full-access' };
    Object.assign(w, await runtime.prepare(workspace.id, w.config));
    assert.equal(w.language, language);
    w.task =
      'We need an implementation plan for a report exporter, but the user has not chosen CSV or JSON. Ask one blocking clarification with both concrete formats, recommend CSV for spreadsheets, and allow a free answer. Do not implement or edit files.';
    await new Store(data).put(w);
    hostLanguage = language === 'fr' ? 'en' : 'fr';
    const restored = await new Store(data).get(w.id);
    assert.deepEqual(restored, w);
    const id = await runtime.agent(restored, 'planner');
    restored.agents.planner = id;
    const prompt = buildPrompt(restored, 'planner', await runtime.context(restored));
    assert.match(prompt, language === 'fr' ? /French \(fr\)/ : /English \(en\)/);
    const handle = api.agents.ref(id);
    proof.pending = { language, id, prompt };
    await writeFile(proofFile, JSON.stringify(proof, null, 2));
    const result = await handle.run(prompt, { timeoutMs: 120000 });
    assert.equal(result.status, 'idle');
    const parsed = parseResult('planner', result.lastMessage);
    assert.equal(parsed.kind, 'clarification');
    assert.equal(parsed.questions.length, 1);
    assert.equal(parsed.questions[0].options.length, 2);
    const timeline = await handle.timeline.refetch({ direction: 'before', limit: 200, projection: 'canonical' });
    assert.equal(timeline.entries.filter((e) => e.item.type === 'user_message').length, 1);
    assert.equal(await readFile(repo + '/README.md', 'utf8'), 'Preserve this baseline.\n');
    assert.equal(execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }), before);
    delete proof.pending;
    proof.results.push({ language, changedHostLanguage: hostLanguage, id, prompt, result, parsed, timeline });
    await writeFile(proofFile, JSON.stringify(proof, null, 2));
  }
  console.log(
    'PASS captured FR/EN, disk reload, host setting change and two real clarification turns. Inspect response language in ' +
      proofFile,
  );
} catch (error) {
  proof.failure = String(error);
  await writeFile(proofFile, JSON.stringify(proof, null, 2));
  throw error;
} finally {
  await api.close();
}
