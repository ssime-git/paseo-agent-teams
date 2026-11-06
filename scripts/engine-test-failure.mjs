import assert from 'node:assert/strict';
import { link, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';

// Test fixture only. Inspect the official persisted operation via RPC so model
// self-checks cannot consume the failure intended for the engine's first round.
export async function engineTestFailure(record, root, marker) {
  assert.ok(Number.isInteger(record.revision), 'Full workflow state is required, not a report projection');
  assert.equal(record.cwd, root);
  if (record.status === 'running') assert.ok(record.operation, 'Running state requires an identified operation');
  assert.equal(marker, root + '-engine-failure.json');
  if (record.status !== 'running' || record.operation?.phase !== 'testing')
    return { code: 0, message: 'SKIP injection outside an engine test operation' };
  assert.equal(record.operation.role, 'builder');
  assert.equal(record.operation.state, 'prepared');
  const claim = { workflowId: record.id, operationId: record.operation.id };
  assert.ok(claim.workflowId && claim.operationId);
  const temporary = marker + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(claim), { flag: 'wx' });
    try {
      await link(temporary, marker);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
  const saved = JSON.parse(await readFile(marker, 'utf8'));
  assert.ok(
    saved && typeof saved.workflowId === 'string' && typeof saved.operationId === 'string' && saved.operationId,
    'Failure marker requires identified workflow and operation',
  );
  assert.equal(saved.workflowId, claim.workflowId, 'Never reuse another workflow failure marker');
  return saved.operationId === claim.operationId
    ? { code: 17, message: 'Intentional isolated engine test failure; same operation always fails' }
    : { code: 0, message: 'PASS bounded engine failure recovered in a new test operation' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [url, workflowId, workspaceId, root, marker] = process.argv.slice(2);
  const endpoint = new URL(url);
  assert.ok(
    ['ws:', 'wss:'].includes(endpoint.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) &&
      endpoint.port &&
      endpoint.port !== '6767',
    'Explicit isolated loopback endpoint required',
  );
  assert.match(root, /^\/tmp\/teams-engine-live-[^/]+$/);
  const client = new DaemonClient({
    url,
    clientId: randomUUID(),
    clientType: 'cli',
    appVersion: '0.13.0',
    reconnect: { enabled: false },
  });
  const watchdog = setTimeout(() => process.exit(1), 15000);
  try {
    await client.connect();
    const workflows = await client.invokePluginRpc('paseo-agent-teams', 'teams.list', { workspaceId });
    const record = workflows.find((w) => w.id === workflowId);
    assert.ok(record, 'Workflow must belong to the explicit workspace');
    assert.equal(record.workspaceId, workspaceId);
    assert.equal(record.id, workflowId);
    const result = await engineTestFailure(record, root, marker);
    console.log(result.message);
    process.exitCode = result.code;
  } finally {
    await client.close();
    clearTimeout(watchdog);
  }
}
