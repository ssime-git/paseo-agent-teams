import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProviderProfiles, nativeMode, workflowModes } from '../server/providers';
import { DEFAULT_MODE, INSTRUCTION_READ_ONLY, readOnlyMode } from '../shared/provider-selection';
test('separate accounts retain their provider IDs and inherited harness family without exposing credentials', () => {
  const entries = {
    'credit-account': {
      extends: 'claude',
      label: 'Claude — credits',
      env: { ANTHROPIC_API_KEY: 'never-expose-this', CLAUDE_CONFIG_DIR: '/private/account' },
    },
    'other-codex': { extends: 'codex' },
    other: { extends: 'acp' },
    misleading: { label: 'claude' },
  };
  const profiles = resolveProviderProfiles(entries);
  assert.equal(profiles.families['credit-account'], 'claude');
  assert.equal(profiles.families['other-codex'], 'codex');
  assert.equal(profiles.families.other, 'acp');
  assert.equal(profiles.families.misleading, 'misleading');
  assert.equal(profiles.labels['credit-account'], 'Claude — credits');
  assert.doesNotMatch(JSON.stringify(profiles), /never-expose-this|CLAUDE_CONFIG_DIR|private/);
  // A read-only role on the separate account is judged by its inherited harness family.
  assert.equal(readOnlyMode('credit-account', 'plan'), false);
  assert.equal(readOnlyMode(profiles.families['credit-account'], 'plan'), true);
  assert.equal(readOnlyMode(profiles.families['credit-account'], 'bypassPermissions'), false);
});
test('arbitrary detected harnesses support native permissions or explicit instruction-only roles', () => {
  const pi = workflowModes('pi', []);
  assert.deepEqual(
    pi.map((m) => m.id),
    [DEFAULT_MODE, INSTRUCTION_READ_ONLY],
  );
  assert.equal(nativeMode('pi', DEFAULT_MODE, []), undefined);
  assert.equal(nativeMode('pi', INSTRUCTION_READ_ONLY, []), undefined);
  const openCode = [
    { id: 'build', label: 'Build' },
    { id: 'plan', label: 'Plan' },
  ];
  assert.equal(workflowModes('opencode', openCode), openCode);
  assert.equal(nativeMode('opencode', 'plan', openCode), 'plan');
  assert.throws(() => nativeMode('opencode', INSTRUCTION_READ_ONLY, openCode), /Unavailable mode/);
  assert.equal(readOnlyMode('opencode', 'plan'), true);
  assert.equal(readOnlyMode('custom', INSTRUCTION_READ_ONLY), true);
  assert.equal(readOnlyMode('custom', 'full-access'), false);
});
test('Codex read-only is supported through native sandbox options even when absent from mode discovery', () => {
  const modes = [
    { id: 'auto', label: 'Auto' },
    { id: 'full-access', label: 'Full access' },
  ];
  assert.equal(workflowModes('codex', modes).at(-1)?.id, 'read-only');
  assert.equal(nativeMode('codex', 'read-only', modes), 'auto');
  assert.equal(nativeMode('codex', 'read-only', [{ id: 'read-only' }]), 'read-only');
  assert.throws(() => nativeMode('codex', 'read-only', [{ id: 'full-access' }]), /Unavailable mode/);
  assert.equal(workflowModes('claude', modes), modes);
  assert.equal(workflowModes('codex', [{ id: 'read-only', label: 'Read only' }]).length, 1);
  assert.equal(readOnlyMode('codex', ''), false);
  assert.equal(readOnlyMode('codex', 'read-only'), true);
});
