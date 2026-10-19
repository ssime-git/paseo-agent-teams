import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertPluginCompatibility } from '@getpaseo/protocol/plugin-requirements';

test('the manifest allows the deployed daemon, native mobile and desktop client versions', async () => {
  const manifest = JSON.parse(await readFile('paseo-plugin.json', 'utf8'));
  for (const version of ['0.11.2', '0.11.4', '0.12.0']) {
    for (const runtime of ['app', 'daemon'] as const) assert.doesNotThrow(() => assertPluginCompatibility({ id: manifest.id, requirements: manifest.requirements, version, runtime }));
  }
  assert.throws(() => assertPluginCompatibility({ id: manifest.id, requirements: manifest.requirements, version: '0.11.1', runtime: 'app' }));
});
