import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliveryFingerprint, verifyDelivery } from '../server/delivery';
import { git, repository, snapshot } from '../server/git';
import { workflowFixture } from './fixtures';
import type { DeliveryResult } from '../shared/contracts';

async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'teams-delivery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  await mkdir(repo);
  await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, ['config', 'user.name', 'Delivery test']);
  await git(repo, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(repo, 'tracked.txt'), 'initial\n');
  await git(repo, ['add', 'tracked.txt']);
  await git(repo, ['commit', '-qm', 'Initial']);
  const w = workflowFixture();
  w.cwd = repo;
  w.repo = (await repository(repo)).lock;
  w.baseline = join(root, 'baseline.json');
  await writeFile(w.baseline, JSON.stringify(await snapshot(repo)));
  await writeFile(join(repo, 'tracked.txt'), 'validated\n');
  await writeFile(join(repo, 'aaa-new.txt'), 'new validated file\n');
  w.delivery = {
    method: 'main',
    approvedAt: new Date().toISOString(),
    fingerprint: 'validated',
    contentFingerprint: await deliveryFingerprint(w),
  };
  async function commit() {
    await git(repo, ['add', 'tracked.txt', 'aaa-new.txt']);
    await git(repo, ['commit', '-qm', 'Deliver']);
    return (await git(repo, ['rev-parse', 'HEAD'])).trim();
  }
  const result = (commit: string): DeliveryResult => ({
    status: 'delivered',
    summary: 'Integrated on main',
    repositories: [{ repository: repo, commit }],
  });
  return { w, repo, commit, result };
}

test('verified main delivery contains the validated edits and new files, without changing content fingerprint', async (t) => {
  const h = await setup(t);
  const fingerprint = h.w.delivery!.contentFingerprint;
  const commit = await h.commit();
  assert.equal(await deliveryFingerprint(h.w), fingerprint);
  await verifyDelivery(h.w, h.result(commit));
});

test('an existing main commit cannot stand in for uncommitted validated work', async (t) => {
  const h = await setup(t);
  const initial = (await git(h.repo, ['rev-parse', 'HEAD'])).trim();
  await assert.rejects(verifyDelivery(h.w, h.result(initial)), /not committed|absent from delivery/);
});

test('delivery verification rejects changed files, a missing main integration and missing or foreign receipts', async (t) => {
  const h = await setup(t);
  const initial = (await git(h.repo, ['rev-parse', 'HEAD'])).trim();
  await git(h.repo, ['switch', '-qc', 'work']);
  const commit = await h.commit();
  await assert.rejects(verifyDelivery(h.w, h.result(commit)), /not local main/);
  await git(h.repo, ['branch', '-f', 'main', commit]);
  await writeFile(join(h.repo, 'tracked.txt'), 'unreviewed\n');
  await assert.rejects(verifyDelivery(h.w, h.result(commit)), /Files changed/);
  await writeFile(join(h.repo, 'tracked.txt'), 'validated\n');
  await assert.rejects(verifyDelivery(h.w, h.result(initial)), /not local main/);
  await assert.rejects(
    verifyDelivery(h.w, { status: 'delivered', summary: 'Missing', repositories: [] }),
    /every selected repository/,
  );
  await assert.rejects(
    verifyDelivery(h.w, {
      status: 'delivered',
      summary: 'Foreign',
      repositories: [{ repository: '/elsewhere', commit }],
    }),
    /Missing repository receipt/,
  );
  delete h.w.delivery!.approvedAt;
  await assert.rejects(verifyDelivery(h.w, h.result(commit)), /Explicit delivery approval/);
});

test('PR verification rejects absent and malformed URLs before consulting GitHub', async (t) => {
  const h = await setup(t);
  const commit = await h.commit();
  h.w.delivery!.method = 'pull_request';
  await assert.rejects(verifyDelivery(h.w, h.result(commit)), /real pull request URL/);
  const result = h.result(commit);
  if (result.status === 'delivered') result.repositories[0].url = 'https://github.com/owner/repo/issues/1';
  await assert.rejects(verifyDelivery(h.w, result), /real pull request URL/);
});

test('PR receipts are checked against GitHub head, open state and repository identity', async (t) => {
  const h = await setup(t);
  const commit = await h.commit();
  h.w.delivery!.method = 'pull_request';
  const bin = join(h.repo, '..', 'bin');
  await mkdir(bin);
  const response = join(bin, 'pr.json');
  const url = 'https://github.com/example/project/pull/7';
  await writeFile(response, JSON.stringify({ url, headRefOid: commit, state: 'OPEN' }));
  await writeFile(
    join(bin, 'gh'),
    `#!/usr/bin/env node\nconst fs = require('fs');\nprocess.stdout.write(process.argv[2] === 'pr' ? fs.readFileSync(${JSON.stringify(response)}, 'utf8') : JSON.stringify({url: 'https://github.com/example/project'}));\n`,
    { mode: 0o755 },
  );
  const previous = process.env.PATH;
  process.env.PATH = `${bin}:${previous}`;
  t.after(() => {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  });
  const result: DeliveryResult = {
    status: 'delivered',
    summary: 'PR',
    repositories: [{ repository: h.repo, commit, url }],
  };
  await verifyDelivery(h.w, result);
  for (const pr of [
    { url, headRefOid: 'a'.repeat(40), state: 'OPEN' },
    { url, headRefOid: commit, state: 'CLOSED' },
    { url: 'https://github.com/foreign/project/pull/7', headRefOid: commit, state: 'OPEN' },
  ]) {
    await writeFile(response, JSON.stringify(pr));
    const receipt = structuredClone(result);
    receipt.repositories[0].url = pr.url;
    await assert.rejects(verifyDelivery(h.w, receipt), /reported commit|selected repository/);
  }
});
