import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialConfig, exportConfig, importConfig, configReady, commandsFromText } from '../client/configuration';
test('configuration round-trip excludes secrets and history and rejects unknown keys', () => {
  const config = initialConfig(); config.roles = { planner: { provider: 'claude/opus-discovered', modeId: 'plan' }, builder: { provider: 'codex/org/model', modeId: 'auto' }, reviewer: { provider: 'codex/reviewer-discovered', modeId: 'read-only' } };
  assert.equal(configReady(config), true); assert.deepEqual(importConfig(exportConfig(config)), config);
  assert.throws(() => importConfig(JSON.stringify({ ...config, password: 'secret' })));
  assert.throws(() => importConfig(JSON.stringify({ ...config, events: [] })));
  config.roles.reviewer.modeId = 'full-access'; assert.equal(configReady(config), false);
  assert.deepEqual(commandsFromText(' npm test\n\n npm run lint '), [{ command: 'npm test', timeoutMs: 600000 }, { command: 'npm run lint', timeoutMs: 600000 }]);
});
