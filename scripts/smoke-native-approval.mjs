import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';

// Continue an already verified native checkpoint; never recreate or resend it.
const source = JSON.parse(await readFile(process.argv[2], 'utf8'));
const url = process.env.PASEO_TEAMS_SMOKE_URL;
if (!url) throw Error('Set PASEO_TEAMS_SMOKE_URL to the isolated daemon');
const endpoint = new URL(url);
assert.ok(
  ['ws:', 'wss:'].includes(endpoint.protocol) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) &&
    endpoint.port &&
    endpoint.port !== '6767',
  'Use an explicit isolated loopback port, never primary port 6767',
);
assert.equal(source.url, url);
const file = source.root + '-approval-proof.json';
const verify = process.argv[3] === '--verify';
const capture = process.argv[3] === '--capture';
const client = new DaemonClient({
  url,
  clientId: randomUUID(),
  clientType: 'cli',
  appVersion: '0.13.0',
  reconnect: { enabled: false },
});
const rpc = (name, input) => client.invokePluginRpc('paseo-agent-teams', 'teams.' + name, input);
const record = () => rpc('workflow_record', { id: source.workflowId });
const state = async () =>
  (await rpc('list', { workspaceId: source.workspaceId })).find((w) => w.id === source.workflowId);
let proof = { source: process.argv[2], workflowId: source.workflowId, assertions: [] };
try {
  await client.connect();
  if (verify) {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.ok(saved.after && !saved.failure, 'A successful approval proof is required');
    assert.deepEqual(await record(), saved.after);
    console.log('PASS approval, tests, review and delivery question preserved after caller restart/reload');
  } else {
    let before, receipt;
    if (capture) {
      proof = JSON.parse(await readFile(file, 'utf8'));
      assert.equal(proof.workflowId, source.workflowId);
      assert.ok(proof.receipt && proof.before, 'Capture requires an already accepted approval');
      before = proof.before;
      receipt = proof.receipt;
      delete proof.failure;
      delete proof.lastRecord;
    } else {
      before = await state();
      assert.deepEqual(await record(), source.after, 'Only continue the exact saved adoption checkpoint');
      assert.equal(before.status, 'awaiting_plan');
      assert.equal(before.testsApproved, false);
      assert.ok(before.planVersions.some((v) => v.nativeSource));
      assert.ok(before.clarifications.some((q) => q.resolvedAt));
      assert.equal(before.events.filter((e) => e.kind === 'dispatch' && e.role === 'builder').length, 0);
      const readme = await readFile(source.root + '/README.md', 'utf8');
      // Approval explicitly authorizes independent engine checks, including the
      // untracked new file; git diff --check alone would not inspect that file.
      const check = String.raw`const fs=require('node:fs'),a=require('node:assert/strict'); const s=fs.readFileSync('GUIDE.md','utf8').trim(); a.ok(s.length>0); a.equal(s.split(/\n\s*\n/).length,1); a.ok(s.split(/\r?\n/).every(l=>!/[ \t]+$/.test(l))); a.equal(fs.readFileSync('README.md','utf8'),${JSON.stringify(readme)}); console.log('PASS one paragraph and preserved README');`;
      const tests = [
        { command: 'node -e ' + "'" + check.replaceAll("'", "'\\''") + "'", timeoutMs: 10000 },
        { command: 'git diff --check', timeoutMs: 10000 },
      ];
      const input = {
        id: before.id,
        workspaceId: source.workspaceId,
        expectedRevision: before.revision,
        requestId: randomUUID(),
        action: 'approve',
        tests,
      };
      proof.before = before;
      proof.approvalRequest = input;
      await writeFile(file, JSON.stringify(proof, null, 2));
      receipt = await rpc('action', input);
      assert.equal(receipt.testsApproved, true);
      assert.deepEqual(receipt.planVersions.slice(0, -1), before.planVersions);
      assert.equal(receipt.planVersions.at(-1).source, 'human');
      assert.equal(receipt.planVersions.at(-1).approval.policy, 'human');
      assert.deepEqual(receipt.plan.tests, tests);
      assert.deepEqual(await rpc('action', input), receipt, 'Replay must not approve or dispatch twice');
      proof.receipt = receipt;
      await writeFile(file, JSON.stringify(proof, null, 2));
    }
    const previousBuilderTurns = before.events.filter((e) => e.kind === 'dispatch' && e.role === 'builder').length;
    const tests = receipt.plan.tests;
    const readme = await readFile(source.root + '/README.md', 'utf8');
    const deadline = Date.now() + 240000;
    let current;
    do {
      current = await state();
      if (current.status === 'awaiting_final') break;
      if (['attention', 'permission', 'completed', 'paused', 'awaiting_plan'].includes(current.status))
        throw Error(JSON.stringify({ status: current.status, error: current.error, operation: current.operation }));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } while (Date.now() < deadline);
    assert.equal(current.status, 'awaiting_final', 'Bounded checkpoint deadline exceeded; do not resend');
    assert.equal(current.review.verdict, 'pass');
    assert.deepEqual(current.planVersions, receipt.planVersions);
    assert.equal(current.tests.length, tests.length);
    assert.ok(current.tests.every((t) => t.exitCode === 0 && !t.timedOut));
    assert.equal((await record()).tests[0].stdout.trim(), 'PASS one paragraph and preserved README');
    assert.ok(current.testedFingerprint);
    assert.equal(current.delivery.fingerprint, current.testedFingerprint);
    assert.equal(current.delivery.approvedAt, undefined);
    assert.ok(current.clarifications.some((q) => q.purpose === 'delivery' && !q.resolvedAt));
    assert.deepEqual(
      current.clarifications.filter((q) => q.purpose !== 'delivery'),
      before.clarifications,
    );
    assert.equal(
      current.events.filter((e) => e.kind === 'dispatch' && e.role === 'builder').length,
      previousBuilderTurns + 1,
    );
    assert.equal(current.events.filter((e) => e.kind === 'delivered').length, 0);
    assert.equal(await readFile(source.root + '/README.md', 'utf8'), readme);
    proof.after = await record();
    proof.finalState = current;
    proof.guide = await readFile(source.root + '/GUIDE.md', 'utf8');
    proof.assertions.push(
      'Exact native checkpoint approved once; human test revision preserves native versions and decisions',
      'One real Builder turn; independent content and whitespace checks pass; real Reviewer passes',
      'Explicit delivery question persists; no delivery approval or publication',
    );
    await writeFile(file, JSON.stringify(proof, null, 2));
    console.log('PASS native plan approval → Builder → independent tests → Reviewer → delivery question: ' + file);
  }
} catch (error) {
  if (!verify) {
    proof.failure = String(error);
    proof.lastRecord = await record().catch(() => null);
    await writeFile(file, JSON.stringify(proof, null, 2));
  }
  throw error;
} finally {
  await client.close();
}
