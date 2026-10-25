import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PaseoApi } from '@getpaseo/client';
import { git, repository } from '../server/git';
import { DefinitionCatalog } from '../server/definition-catalog';
import { GraphCheckpoints } from '../server/graph-checkpoints';
import { codeReviewPreset, workflowDefinitionSchema } from '../shared/workflow-definition';
import { graphCheckpointSchema } from '../shared/graph-checkpoint';
import { graphFingerprint, verifyGraphIntegrity } from '../server/graph-integrity';
import { runGraphTests } from '../server/graph-tests';
import { graphDispatchPrompt } from '../server/graph-preparation';
import { reserveGraphActivation } from '../shared/graph-checkpoint';
import { consumeGraphResult } from '../server/graph-consumption';
import { consumeGraphEvidence, rejectGraphTests } from '../shared/graph-checkpoint';

async function setup(
  t: { after: (fn: () => Promise<void>) => void },
  commands = [{ command: 'printf tested', timeoutMs: 1000 }],
  options: { access?: 'read-only' | 'write'; remaining?: string[]; maxTransitions?: number } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'teams-graph-tests-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = join(directory, 'repo');
  await mkdir(repo);
  await git(repo, ['init', '-q']);
  await writeFile(join(repo, 'file'), 'original');
  await git(repo, ['add', 'file']);
  await mkdir(join(repo, 'sub'));
  const definition = codeReviewPreset({
    code: { provider: 'codex/model', modeId: 'read-only' },
    review: { provider: 'codex/model', modeId: 'read-only' },
  });
  definition.steps[0].access = options.access ?? 'read-only';
  definition.steps[0].tests = commands;
  if (options.maxTransitions !== undefined) definition.maxTransitions = options.maxTransitions;
  const source = await new DefinitionCatalog(join(directory, 'definitions')).save({
    workspaceId: 'owner',
    expectedRevision: 0,
    definition,
  });
  const store = new GraphCheckpoints(join(directory, 'graphs'));
  let state = await store.create({ id: randomUUID(), repo: (await repository(repo)).lock, task: 'Inspect', source });
  const operationId = randomUUID(),
    agentId = randomUUID(),
    attemptId = randomUUID();
  state = await store.reserve(state.id, 'owner', state.revision, operationId);
  state = await store.bindDispatch(state.id, 'owner', state.revision, operationId, {
    agentId,
    prompt: `[agent-teams-operation:${operationId}] inspect`,
  });
  const api = {
    workspaces: { ref: () => ({ refresh: async () => ({ workspaceDirectory: join(repo, 'sub') }) }) },
  } as unknown as PaseoApi;
  state = await store.claimDispatch(
    state.id,
    'owner',
    state.revision,
    operationId,
    attemptId,
    options.access === 'write' ? undefined : await graphFingerprint(api, state),
  );
  state = await store.receipt(state.id, 'owner', state.revision, operationId, {
    agentId,
    attemptId,
    turnId: 'turn',
    outcome: 'completed',
    text: JSON.stringify({ summary: 'Done', changes: [], remaining: options.remaining ?? [] }),
  });
  state = await store.assessReceipt(state.id, 'owner', state.revision, operationId);
  assert.equal(state.activations[0].assessment?.status, 'valid');
  if (options.access !== 'write')
    state = await verifyGraphIntegrity(api, store, {
      id: state.id,
      workspaceId: 'owner',
      expectedRevision: state.revision,
      operationId,
    });
  const input = { id: state.id, workspaceId: 'owner', expectedRevision: state.revision, operationId };
  return { repo, state, store, api, input };
}

test('explicit tests run at Git root, persist exact results and replay after restart without executing twice', async (t) => {
  const h = await setup(t, [
    { command: 'test -f file && printf line >> ignored-proof && printf tested', timeoutMs: 1000 },
  ]);
  const done = await runGraphTests(h.api, h.store, h.input);
  const run = done.activations[0].testRun!;
  assert.equal(run.completion?.results[0].stdout, 'tested');
  assert.equal(run.completion?.results[0].exitCode, 0);
  assert.notEqual(run.fingerprint, run.completion?.fingerprint); // Command side effect visible.
  assert.equal(done.status, 'running');
  assert.equal(done.activations[0].result, undefined);
  assert.deepEqual(await runGraphTests(h.api, new GraphCheckpoints(h.store.directory), h.input), done);
  assert.equal(await readFile(join(h.repo, 'ignored-proof'), 'utf8'), 'line');
  const corrupt = structuredClone(done);
  corrupt.activations[0].testRun!.completion!.results[0].command = 'false';
  assert.equal(graphCheckpointSchema.safeParse(corrupt).success, false);
  await assert.rejects(
    h.store.completeTests(done.id, 'owner', done.revision, h.input.operationId, run.attemptId, {
      ...run.completion!,
      fingerprint: 'f'.repeat(64),
    }),
  );
});

test('failures, timeouts and output limits remain test evidence, never graph success', async (t) => {
  const h = await setup(t, [
    { command: 'printf failure >&2; exit 7', timeoutMs: 1000 },
    { command: 'sleep 5', timeoutMs: 100 },
    { command: 'node -e "process.stdout.write(String.fromCharCode(120).repeat(200000))"', timeoutMs: 3000 },
  ]);
  const done = await runGraphTests(h.api, h.store, h.input);
  const results = done.activations[0].testRun!.completion!.results;
  assert.equal(results[0].exitCode, 7);
  assert.equal(results[0].stderr, 'failure');
  assert.equal(results[1].timedOut, true);
  assert.equal(results[2].truncated, true);
  assert.equal(results[2].stdout.length, 128 * 1024);
  assert.equal(done.status, 'running');
});

test('concurrent callers arbitrate before shell execution and uncertain claims are never retried', async (t) => {
  const h = await setup(t, [{ command: 'printf once >> proof', timeoutMs: 1000 }]);
  const answers = await Promise.allSettled([
    runGraphTests(h.api, h.store, h.input),
    runGraphTests(h.api, h.store, h.input),
  ]);
  assert.ok(answers.some((a) => a.status === 'fulfilled'));
  assert.equal(await readFile(join(h.repo, 'proof'), 'utf8'), 'once');
  const u = await setup(t);
  const claimed = await u.store.claimTests(
    u.state.id,
    'owner',
    u.state.revision,
    u.input.operationId,
    randomUUID(),
    await graphFingerprint(u.api, u.state),
  );
  assert.deepEqual(await runGraphTests(u.api, new GraphCheckpoints(u.store.directory), u.input), claimed);
  assert.equal(claimed.activations[0].testRun?.completion, undefined);
});

test('scope, revision, changed repository and absent integrity prevent execution', async (t) => {
  const h = await setup(t);
  await assert.rejects(runGraphTests(h.api, h.store, { ...h.input, workspaceId: 'foreign' }));
  await assert.rejects(runGraphTests(h.api, h.store, { ...h.input, expectedRevision: 1 }));
  await writeFile(join(h.repo, 'file'), 'changed after evidence');
  await assert.rejects(runGraphTests(h.api, h.store, h.input), /read-only evidence/);
  assert.deepEqual(await h.store.get(h.state.id, 'owner'), h.state);
  const corrupt = structuredClone(h.state);
  corrupt.activations[0].testRun = { attemptId: randomUUID(), fingerprint: 'f'.repeat(64) };
  corrupt.revision++;
  assert.equal(graphCheckpointSchema.safeParse(corrupt).success, false);
});

test('definition test budgets are bounded, explicit and compatible with older graphs', () => {
  const definition = codeReviewPreset({
    code: { provider: 'codex/model', modeId: 'auto' },
    review: { provider: 'codex/model', modeId: 'read-only' },
  });
  assert.deepEqual(workflowDefinitionSchema.parse(definition), definition);
  for (const tests of [
    [],
    [{ command: 'true', timeoutMs: 30001 }],
    Array.from({ length: 5 }, () => ({ command: 'true', timeoutMs: 30000 })),
  ]) {
    const value = structuredClone(definition);
    value.steps[0].tests = tests;
    assert.equal(workflowDefinitionSchema.safeParse(value).success, false);
  }
});

test('verified native result consumes one transition atomically and replays after restart', async (t) => {
  const h = await setup(t);
  const tested = await runGraphTests(h.api, h.store, h.input);
  const input = { ...h.input, expectedRevision: tested.revision };
  const results = await Promise.allSettled([
    consumeGraphResult(h.api, h.store, input),
    consumeGraphResult(h.api, h.store, input),
  ]);
  assert.ok(results.some((r) => r.status === 'fulfilled'));
  const saved = await h.store.get(h.state.id, 'owner');
  assert.equal(saved.revision, tested.revision + 1);
  assert.equal(saved.status, 'ready');
  assert.equal(saved.nextStepId, 'review');
  assert.equal(saved.activations.length, 1);
  assert.deepEqual(
    saved.activations[0].result,
    tested.activations[0].assessment!.status === 'valid' ? tested.activations[0].assessment!.result : null,
  );
  assert.equal(saved.activations[0].consumption?.fingerprint, tested.activations[0].testRun!.fingerprint);
  // Replay is a historical observation even after later repository changes.
  await writeFile(join(h.repo, 'file'), 'later work');
  assert.deepEqual(await consumeGraphResult(h.api, new GraphCheckpoints(h.store.directory), h.input), saved);
  await assert.rejects(consumeGraphResult(h.api, h.store, { ...input, workspaceId: 'foreign' }), /access denied/);
  const corrupt = structuredClone(saved);
  corrupt.activations[0].consumption!.fingerprint = 'f'.repeat(64);
  assert.equal(graphCheckpointSchema.safeParse(corrupt).success, false);
});

test('consumption keeps missing, uncertain, failed, timed out and truncated tests reserved', async (t) => {
  const pending = await setup(t);
  await assert.rejects(consumeGraphResult(pending.api, pending.store, pending.input), /completed independent tests/);
  const claimed = await pending.store.claimTests(
    pending.state.id,
    'owner',
    pending.state.revision,
    pending.input.operationId,
    randomUUID(),
    await graphFingerprint(pending.api, pending.state),
  );
  await assert.rejects(
    consumeGraphResult(pending.api, pending.store, { ...pending.input, expectedRevision: claimed.revision }),
    /completed independent tests/,
  );
  assert.deepEqual(await pending.store.get(claimed.id, 'owner'), claimed);
  for (const command of [
    'exit 7',
    'sleep 2',
    'node -e "process.stdout.write(String.fromCharCode(120).repeat(200000))"',
  ]) {
    const h = await setup(t, [{ command, timeoutMs: command === 'sleep 2' ? 100 : 3000 }]);
    const tested = await runGraphTests(h.api, h.store, h.input);
    await assert.rejects(
      consumeGraphResult(h.api, h.store, { ...h.input, expectedRevision: tested.revision }),
      /did not pass/,
    );
    assert.deepEqual(await h.store.get(h.state.id, 'owner'), tested);
  }
});

test('consumption rejects stale repositories, command side effects, revisions and low-level bypass', async (t) => {
  const h = await setup(t);
  const tested = await runGraphTests(h.api, h.store, h.input);
  await assert.rejects(consumeGraphResult(h.api, h.store, h.input), /changed; reload/);
  await assert.rejects(
    h.store.resolveArtifact(
      h.state.id,
      'owner',
      tested.revision,
      h.input.operationId,
      JSON.stringify({ summary: 'Done', changes: [], remaining: [] }),
    ),
    /consume verified evidence/,
  );
  await writeFile(join(h.repo, 'file'), 'changed');
  await assert.rejects(
    consumeGraphResult(h.api, h.store, { ...h.input, expectedRevision: tested.revision }),
    /read-only evidence/,
  );
  assert.deepEqual(await h.store.get(h.state.id, 'owner'), tested);
  const effect = await setup(t, [{ command: 'printf effect > extra', timeoutMs: 1000 }]);
  const changed = await runGraphTests(effect.api, effect.store, effect.input);
  await assert.rejects(
    consumeGraphResult(effect.api, effect.store, { ...effect.input, expectedRevision: changed.revision }),
    /read-only evidence/,
  );
});

test('consumption requires saved native evidence and never infers a no-test approval', async (t) => {
  const h = await setup(t);
  const fingerprint = await graphFingerprint(h.api, h.state);
  const noTests = structuredClone(h.state);
  delete noTests.source.definition.steps[0].tests;
  assert.throws(() => consumeGraphEvidence(noTests, h.input.operationId, fingerprint), /completed independent tests/);
  const absent = structuredClone(h.state);
  delete absent.activations[0].assessment;
  absent.revision--;
  assert.throws(() => consumeGraphEvidence(absent, h.input.operationId, fingerprint), /valid assessment/);
  const failed = structuredClone(absent);
  failed.activations[0].receipt!.outcome = 'failed';
  assert.throws(() => consumeGraphEvidence(failed, h.input.operationId, fingerprint), /Completed native receipt/);
});

test('write activations consume verified failure artifacts but never approve test side effects', async (t) => {
  const h = await setup(t, undefined, { access: 'write', remaining: ['Unfinished task'] });
  const tested = await runGraphTests(h.api, h.store, h.input);
  const done = await consumeGraphResult(h.api, h.store, { ...h.input, expectedRevision: tested.revision });
  assert.equal(done.status, 'failed');
  assert.equal(done.nextStepId, null);
  assert.equal(done.activations[0].result!.outcome, 'failure');
  assert.equal(done.activations[0].result!.artifact!.contract, 'build');
  const sideEffect = await setup(t, [{ command: 'printf changed > file', timeoutMs: 1000 }], { access: 'write' });
  const changed = await runGraphTests(sideEffect.api, sideEffect.store, sideEffect.input);
  await assert.rejects(
    consumeGraphResult(sideEffect.api, sideEffect.store, { ...sideEffect.input, expectedRevision: changed.revision }),
    /changed since independent tests/,
  );
});

test('consumption respects the transition budget and preserves historical resolved checkpoints', async (t) => {
  const h = await setup(t, undefined, { maxTransitions: 1 });
  const tested = await runGraphTests(h.api, h.store, h.input);
  const done = await consumeGraphResult(h.api, h.store, { ...h.input, expectedRevision: tested.revision });
  assert.equal(done.status, 'exhausted');
  assert.equal(done.nextStepId, 'review');
  await assert.rejects(h.store.reserve(done.id, 'owner', done.revision, randomUUID()), /cannot activate/);
  const old = structuredClone(done);
  delete old.activations[0].consumption;
  assert.deepEqual(graphCheckpointSchema.parse(old), old); // No invented historical proof.
  const errored = structuredClone(tested);
  errored.activations[0].testRun!.completion!.error = 'Shell runner failed';
  assert.throws(
    () => consumeGraphEvidence(errored, h.input.operationId, errored.activations[0].testRun!.fingerprint),
    /did not pass/,
  );
});

test('explicit test rejection preserves evidence, transitions once and replays across stores', async (t) => {
  for (const kind of ['not_run', 'uncertain', 'failed', 'absent'] as const) {
    const h = await setup(t, [{ command: 'printf failure >&2; exit 7', timeoutMs: 1000 }]);
    let state = h.state;
    if (kind === 'uncertain')
      state = await h.store.claimTests(
        state.id,
        'owner',
        state.revision,
        h.input.operationId,
        randomUUID(),
        await graphFingerprint(h.api, state),
      );
    if (kind === 'failed') state = await runGraphTests(h.api, h.store, h.input);
    // Legacy definitions may have no tests; do not invent approval for them.
    if (kind === 'absent') {
      delete state.source.definition.steps[0].tests;
      const decision = { id: randomUUID(), summary: 'No tests explicitly rejected' };
      const done = rejectGraphTests(state, h.input.operationId, decision);
      assert.equal(done.status, 'failed');
      assert.equal(done.activations[0].testRejection?.reason, kind);
      continue;
    }
    const decision = { id: randomUUID(), summary: 'Explicitly reject blocked tests' };
    const outcomes = await Promise.allSettled([
      h.store.rejectTests(state.id, 'owner', state.revision, h.input.operationId, decision),
      h.store.rejectTests(state.id, 'owner', state.revision, h.input.operationId, decision),
    ]);
    assert.ok(outcomes.some((r) => r.status === 'fulfilled'));
    const done = await h.store.get(state.id, 'owner');
    assert.equal(done.revision, state.revision + 1);
    assert.equal(done.status, 'failed');
    assert.equal(done.activations[0].testRejection?.reason, kind);
    assert.deepEqual(done.activations[0].testRun, state.activations[0].testRun);
    assert.deepEqual(done.activations[0].assessment, state.activations[0].assessment);
    assert.equal(done.activations[0].result?.artifact, undefined);
    assert.equal(done.activations[0].consumption, undefined);
    assert.deepEqual(
      await new GraphCheckpoints(h.store.directory).rejectTests(state.id, 'owner', 1, h.input.operationId, decision),
      done,
    );
    await assert.rejects(
      h.store.rejectTests(state.id, 'owner', done.revision, h.input.operationId, {
        ...decision,
        summary: 'Contradictory decision',
      }),
      /differently/,
    );
    const corrupt = structuredClone(done);
    corrupt.activations[0].testRejection!.reason = 'absent';
    assert.equal(graphCheckpointSchema.safeParse(corrupt).success, false);
    const approved = structuredClone(done);
    approved.activations[0].result!.outcome = 'success';
    assert.equal(graphCheckpointSchema.safeParse(approved).success, false);
    if (kind === 'uncertain')
      await assert.rejects(
        h.store.completeTests(
          done.id,
          'owner',
          done.revision,
          h.input.operationId,
          done.activations[0].testRun!.attemptId,
          { results: [], fingerprint: 'f'.repeat(64), error: 'Late completion' },
        ),
        /Pending activation/,
      );
  }
});

test('test rejection enforces scope, revisions, explicit input and refuses passing evidence', async (t) => {
  const h = await setup(t);
  const decision = { id: randomUUID(), summary: 'Reject without rerun' };
  await assert.rejects(h.store.rejectTests(h.state.id, 'foreign', h.state.revision, h.input.operationId, decision));
  await assert.rejects(h.store.rejectTests(h.state.id, 'owner', 1, h.input.operationId, decision), /changed/);
  await assert.rejects(
    h.store.rejectTests(h.state.id, 'owner', h.state.revision, h.input.operationId, { ...decision, summary: ' ' }),
  );
  const passed = await runGraphTests(h.api, h.store, h.input);
  await assert.rejects(
    h.store.rejectTests(passed.id, 'owner', passed.revision, h.input.operationId, decision),
    /Passing tests/,
  );
  assert.deepEqual(await h.store.get(passed.id, 'owner'), passed);
});

test('rejected tests follow configured correction edges and activation budgets', async (t) => {
  const h = await setup(t);
  const state = structuredClone(h.state);
  state.source.definition.steps[0].transitions.find((e) => e.outcome === 'failure')!.target = 'code';
  const decision = { id: randomUUID(), summary: 'Correction required after missing tests' };
  const corrected = rejectGraphTests(state, h.input.operationId, decision);
  assert.equal(corrected.status, 'ready');
  assert.equal(corrected.nextStepId, 'code');
  assert.equal(corrected.activations.length, 1); // No automatic reservation or dispatch.
  const nextOp = randomUUID();
  const next = reserveGraphActivation(corrected, nextOp);
  assert.match(graphDispatchPrompt(next, nextOp), /Correction required after missing tests/);
  assert.match(graphDispatchPrompt(next, nextOp), /not_run/);
  state.source.definition.maxTransitions = 1;
  const exhausted = rejectGraphTests(state, h.input.operationId, decision);
  assert.equal(exhausted.status, 'exhausted');
  assert.equal(exhausted.nextStepId, 'code');
  assert.deepEqual(exhausted.activations[0].assessment, h.state.activations[0].assessment);
});
