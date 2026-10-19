import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProviderProfiles } from '../server/providers';
import { configReady, initialConfig } from '../client/configuration';
test('separate Claude accounts retain their provider IDs and inherit only the supported harness family', () => {
  const entries = { 'credit-account': { extends: 'claude', label: 'Claude — credits', env: { ANTHROPIC_API_KEY: 'never-expose-this', CLAUDE_CONFIG_DIR: '/private/account' } }, 'other-codex': { extends: 'codex' }, other: { extends: 'acp' }, misleading: { label: 'claude' } };
  const profiles = resolveProviderProfiles(entries);
  assert.equal(profiles.families['credit-account'], 'claude'); assert.equal(profiles.families['other-codex'], 'codex'); assert.equal(profiles.families.other, undefined); assert.equal(profiles.families.misleading, undefined);
  assert.equal(profiles.labels['credit-account'], 'Claude — credits'); assert.doesNotMatch(JSON.stringify(profiles), /never-expose-this|CLAUDE_CONFIG_DIR|private/);
  const config = initialConfig(); config.roles = { planner: { provider: 'claude/model', modeId: 'plan' }, builder: { provider: 'codex/model', modeId: 'auto' }, reviewer: { provider: 'credit-account/fable', modeId: 'plan' } };
  assert.equal(configReady(config), false); assert.equal(configReady(config, [{ id: 'credit-account', family: 'claude' }]), true);
  config.roles.reviewer.modeId = 'bypassPermissions'; assert.equal(configReady(config, [{ id: 'credit-account', family: 'claude' }]), false);
});
