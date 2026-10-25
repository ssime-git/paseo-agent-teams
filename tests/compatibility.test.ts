import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertPluginCompatibility } from '@getpaseo/protocol/plugin-requirements';

test('the manifest accepts 0.13 app/daemon and rejects older or unvalidated minor versions', async () => {
  const manifest = JSON.parse(await readFile('paseo-plugin.json', 'utf8'));
  for (const version of ['0.13.0', '0.13.1']) {
    for (const runtime of ['app', 'daemon'] as const)
      assert.doesNotThrow(() =>
        assertPluginCompatibility({ id: manifest.id, requirements: manifest.requirements, version, runtime }),
      );
  }
  for (const version of ['0.11.2', '0.12.0', '0.14.0']) {
    for (const runtime of ['app', 'daemon'] as const)
      assert.throws(() =>
        assertPluginCompatibility({ id: manifest.id, requirements: manifest.requirements, version, runtime }),
      );
  }
});
