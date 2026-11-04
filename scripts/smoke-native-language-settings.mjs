// Opt-in native configuration proof: no model turns, caller owns isolated daemon lifecycle.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createPaseoClient } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
const url = process.env.PASEO_TEAMS_SMOKE_URL;
const endpoint = new URL(url);
assert.ok(['127.0.0.1', 'localhost'].includes(endpoint.hostname) && endpoint.port && endpoint.port !== '6767');
const proof = process.argv[2]
  ? JSON.parse(await readFile(process.argv[2], 'utf8'))
  : { root: await mkdtemp('/tmp/teams-native-language-'), url, owners: [] };
assert.equal(proof.url, url);
const api = createPaseoClient({ url, reconnect: { enabled: false } });
const raw = new DaemonClient({
  url,
  clientId: 'native-language-smoke',
  clientType: 'cli',
  appVersion: '0.14.0',
  reconnect: { enabled: false },
});
const deadline = setTimeout(() => {
  console.error('Native configuration smoke exceeded 60 seconds');
  process.exit(1);
}, 60000);
try {
  await api.connect();
  await raw.connect();
  if (!proof.owners.length) {
    execFileSync('git', ['init', '-q', proof.root]);
    const workspace = await api.workspaces.open(proof.root);
    proof.workspaceId = workspace.id;
    for (const language of ['fr', 'en']) {
      const owner = await api.workspaces.ref(workspace.id).agents.create({
        config: { provider: 'agent-teams/auto' },
        title: `Native language ${language}`,
        idempotencyKey: `native-language-${language}`,
      });
      await raw.setAgentFeature(owner.id, 'responseLanguage', language);
      proof.owners.push({ id: owner.id, language });
    }
    await writeFile(proof.root + '-proof.json', JSON.stringify(proof, null, 2));
  }
  for (const owner of proof.owners) {
    const handle = api.agents.ref(owner.id);
    await handle.commands(); // Opens/restores the native provider session without starting a model.
    await handle.refresh();
    const snapshot = handle.current();
    const feature = snapshot.features.find((f) => f.id === 'responseLanguage');
    assert.ok(feature, 'Native response language feature is exposed');
    assert.equal(feature.value, owner.language);
    assert.equal(snapshot.status, 'idle');
    owner.feature = feature;
  }
  proof.verified = true;
  await writeFile(proof.root + '-proof.json', JSON.stringify(proof, null, 2));
  console.log('PASS independent native FR/EN settings restored, no model turns: ' + proof.root + '-proof.json');
} finally {
  clearTimeout(deadline);
  await raw.close();
  await api.close();
}
