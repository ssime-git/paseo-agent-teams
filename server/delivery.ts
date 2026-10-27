import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DeliveryResult, Workflow } from '../shared/contracts';
import { TeamError } from '../shared/errors';
import { changes, git, snapshot, type Snapshot } from './git';
import type { ScopeSnapshot } from './repository-context';
import { workflowRepositories } from './scopes';

const exec = promisify(execFile);

// Commits and index changes are expected during delivery; file contents must stay
// exactly as independently tested, including unrelated user files.
export async function deliveryFingerprint(w: Workflow) {
  const files = [];
  for (const target of await workflowRepositories(w))
    files.push({
      root: target.root,
      files: Object.entries((await snapshot(target.root)).files).sort(([a], [b]) => a.localeCompare(b)),
    });
  return createHash('sha256').update(JSON.stringify(files)).digest('hex');
}

export async function verifyDelivery(w: Workflow, result: DeliveryResult) {
  const fail = (message: string): never => {
    throw new TeamError('DELIVERY_UNVERIFIED', message);
  };
  if (result.status !== 'delivered' || !w.delivery?.method || !w.delivery.approvedAt)
    return fail('Explicit delivery approval and a delivered result are required');
  if ((await deliveryFingerprint(w)) !== w.delivery.contentFingerprint)
    return fail('Files changed since independent validation; revalidate before delivery');
  const targets = await workflowRepositories(w);
  if (
    result.repositories.length !== targets.length ||
    new Set(result.repositories.map((r) => r.repository)).size !== targets.length
  )
    return fail('A unique delivery receipt is required for every selected repository');
  const baseline = JSON.parse(await readFile(w.baseline, 'utf8')) as Snapshot | ScopeSnapshot;
  for (const target of targets) {
    const receipt = result.repositories.find((r) => r.repository === target.root);
    if (!receipt) return fail(`Missing repository receipt: ${target.root}`);
    const current = await snapshot(target.root);
    const before =
      'version' in baseline
        ? baseline.repositories.find((r) => r.root === target.root && r.lock === target.lock)?.snapshot
        : baseline;
    if (!before) return fail(`Launch baseline missing: ${target.root}`);
    // Baselines from before streaming hashes stored regular file bytes as base64.
    for (const file of Object.values(before.files))
      if (file.kind === 'file' && !/^[a-f0-9]{64}$/.test(file.content))
        file.content = createHash('sha256').update(Buffer.from(file.content, 'base64')).digest('hex');
    const commit = (await git(target.root, ['rev-parse', '--verify', `${receipt.commit}^{commit}`])).trim();
    if (commit !== receipt.commit) return fail('Commit does not identify an exact Git commit');
    const validatedChanges = changes(before, current);
    if (before.head !== 'unborn') {
      const paths = new Set(validatedChanges.map((change) => change.path));
      const deliveredPaths = (await git(target.root, ['diff', '--name-only', '-z', before.head, commit]))
        .split('\0')
        .filter(Boolean);
      if (deliveredPaths.some((path) => !paths.has(path)))
        return fail('Delivery includes changes outside the validated workflow diff');
    }
    if (w.delivery.method === 'main') {
      if ((await git(target.root, ['rev-parse', '--verify', 'refs/heads/main'])).trim() !== commit)
        return fail(`The reported commit is not local main: ${target.root}`);
    } else {
      if (!receipt.url || !/^https:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/[1-9]\d*$/.test(receipt.url))
        return fail('A real pull request URL is required');
      const { stdout } = await exec('gh', ['pr', 'view', receipt.url, '--json', 'url,headRefOid,state'], {
        cwd: target.root,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      const pr = JSON.parse(stdout);
      if (pr.url !== receipt.url || pr.headRefOid !== commit || pr.state !== 'OPEN')
        return fail('The PR must be open and contain the reported commit');
      // Bind the URL to this repository, not another PR with the same Git commit.
      const { stdout: repository } = await exec('gh', ['repo', 'view', '--json', 'url'], {
        cwd: target.root,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      if (!receipt.url.startsWith(`${JSON.parse(repository).url}/pull/`))
        return fail('The PR does not belong to the selected repository');
    }
    for (const change of validatedChanges) {
      if (change.after) {
        const entry = await git(target.root, ['ls-tree', '-z', commit, '--', change.path]);
        if (!entry) return fail(`Validated file is absent from delivery: ${change.path}`);
      }
      const diff = await git(target.root, ['diff', '--no-ext-diff', '--no-textconv', commit, '--', change.path]);
      if (diff) return fail(`Validated change is not committed in delivery: ${change.path}`);
    }
  }
}
