import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialConfig,
  exportConfig,
  importConfig,
  configReady,
  configurationIssue,
  commandsFromText,
} from '../client/configuration';
test('configuration round-trip excludes secrets and history and rejects unknown keys', () => {
  const config = initialConfig();
  config.roles = {
    planner: { provider: 'claude/opus-discovered', modeId: 'plan' },
    builder: { provider: 'codex/org/model', modeId: 'auto' },
    reviewer: { provider: 'codex/reviewer-discovered', modeId: 'read-only' },
  };
  assert.equal(configReady(config), true);
  assert.deepEqual(importConfig(exportConfig(config)), config);
  assert.throws(() => importConfig(JSON.stringify({ ...config, password: 'secret' })));
  assert.throws(() => importConfig(JSON.stringify({ ...config, events: [] })));
  config.roles.reviewer.modeId = 'full-access';
  assert.equal(configReady(config), false);
  assert.deepEqual(commandsFromText(' npm test\n\n npm run lint '), [
    { command: 'npm test', timeoutMs: 600000 },
    { command: 'npm run lint', timeoutMs: 600000 },
  ]);
});
test('all validation policies allow launch without predefined test commands so the planner can choose them', () => {
  const config = initialConfig();
  config.roles = {
    planner: { provider: 'claude/model', modeId: 'plan' },
    builder: { provider: 'codex/model', modeId: 'auto' },
    reviewer: { provider: 'codex/model', modeId: 'read-only' },
  };
  for (const validation of ['final', 'autonomous'] as const) {
    config.validation = validation;
    config.testCommands = [];
    config.allowNoTests = false;
    assert.equal(configReady(config), true);
    assert.equal(configurationIssue(config), undefined);
    config.testCommands = commandsFromText('npm run check');
    assert.equal(configReady(config), true);
    config.testCommands = [];
    config.allowNoTests = true;
    assert.equal(configReady(config), true);
  }
  config.allowNoTests = false;
  config.validation = 'plan';
  assert.equal(configReady(config), true);
  config.validation = 'autonomous';
  config.mode = 'manual';
  assert.equal(configReady(config), true);
});

test('new teams enable Builder auto-accept while imported legacy configurations retain manual native permissions', () => {
  const current = initialConfig();
  current.roles = {
    planner: { provider: 'claude/model', modeId: 'plan' },
    builder: { provider: 'codex/model', modeId: 'auto' },
    reviewer: { provider: 'claude/model', modeId: 'plan' },
  };
  assert.equal(current.builderAutoAccept, true);
  const legacy = { ...current } as Partial<typeof current>;
  delete legacy.builderAutoAccept;
  assert.equal(importConfig(JSON.stringify(legacy)).builderAutoAccept, false);
});

test('launch freezes the displayed repository scope without mutating automatic draft discovery', async () => {
  const { scopedLaunchConfig } = await import('../client/configuration');
  const draft = initialConfig();
  const launched = scopedLaunchConfig(draft, { selectedRepositories: ['/a', '/b'] });
  assert.deepEqual(launched.repositoryPaths, ['/a', '/b']);
  assert.equal(draft.repositoryPaths, undefined);
  assert.deepEqual(
    scopedLaunchConfig({ ...draft, repositoryPaths: ['/explicit'] }, { selectedRepositories: ['/a', '/b'] })
      .repositoryPaths,
    ['/explicit'],
  );
});
