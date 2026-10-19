import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PaseoApi } from '@getpaseo/client';
import { PaseoRuntime, readOnlyMode } from '../server/runtime';
import type { Workflow } from '../shared/contracts';

function savedWorkflow(): Workflow {
  return { id: 'workflow', agents: { builder: 'agent' }, operation: { id: 'operation', role: 'builder', phase: 'building', state: 'prepared', startedAt: new Date().toISOString() }, events: [] } as unknown as Workflow;
}
function adapter(overrides: Record<string, unknown> = {}, entries: unknown[] = []) {
  let sends = 0, waits = 0, appends = 0;
  const handle = { status: 'idle', pendingPermissions: [], activeTurn: null, refresh: async () => ({}),
    run: async () => { sends++; return { status: 'idle', lastMessage: 'done' }; },
    waitForFinish: async () => { waits++; return { status: 'idle', lastMessage: 'completed live' }; },
    timeline: { refetch: async () => ({ entries, endCursor: { epoch: 'epoch', seq: 8 }, hasOlder: false }), append: async () => { appends++; } }, ...overrides };
  const api = { agents: { ref: () => handle } } as unknown as PaseoApi;
  const runtime = new PaseoRuntime(api, '/unused');
  return { runtime, counts: () => ({ sends, waits, appends }) };
}
const accepted = { item: { type: 'user_message', text: '[agent-teams-operation:operation] task' } };
test('idle plus a previous assistant message does not prove completion', async () => {
  const h = adapter({}, [accepted, { item: { type: 'assistant_message', text: 'unproven' } }]);
  assert.equal((await h.runtime.reconcile(savedWorkflow())).status, 'uncertain'); assert.equal(h.counts().sends, 0);
});
test('a durable hook receipt and matching prompt recover a finished turn', async () => {
  const h = adapter({}, [accepted]); const w = savedWorkflow();
  w.events.push({ id: 'receipt', at: new Date().toISOString(), kind: 'receipt:operation', text: JSON.stringify({ status: 'idle', text: 'validated result' }) });
  const result = await h.runtime.reconcile(w); assert.equal(result.status, 'idle'); assert.equal(result.text, 'validated result'); assert.deepEqual(result.cursor, { epoch: 'epoch', seq: 8 });
});
test('an active accepted turn is observed without a second send', async () => {
  const h = adapter({ status: 'running', activeTurn: { turnId: 'turn' } }, [accepted]);
  const result = await h.runtime.reconcile(savedWorkflow()); assert.equal(result.status, 'idle'); assert.deepEqual(h.counts(), { sends: 0, waits: 1, appends: 0 });
});
test('foreign prompts, missing acceptance, missing agents and permissions suspend safely', async () => {
  const foreign = adapter({}, [accepted, { item: { type: 'user_message', text: 'foreign task' } }]); assert.equal((await foreign.runtime.reconcile(savedWorkflow())).status, 'uncertain');
  assert.equal((await adapter().runtime.reconcile(savedWorkflow())).status, 'uncertain');
  assert.equal((await adapter({ refresh: async () => null }).runtime.reconcile(savedWorkflow())).status, 'uncertain');
  assert.equal((await adapter({ pendingPermissions: [{}] }).runtime.reconcile(savedWorkflow())).status, 'permission');
});
test('busy sessions cannot receive another prompt; read-only modes are restricted', async () => {
  const h = adapter({ status: 'running' }); assert.equal((await h.runtime.run(savedWorkflow(), 'builder', 'task', 'operation')).status, 'uncertain'); assert.equal(h.counts().sends, 0);
  assert.equal(readOnlyMode('claude', 'plan'), true); assert.equal(readOnlyMode('codex', 'read-only'), true); assert.equal(readOnlyMode('claude', 'acceptEdits'), false);
});
test('native cards append through the plugin-owned API with stable identity', async () => {
  const h = adapter(); const w = savedWorkflow(); w.agents.planner = 'planner'; w.phase = 'building'; w.cycle = 1; w.task = 'task'; w.status = 'running';
  await h.runtime.publish(w); await h.runtime.publish(w); assert.equal(h.counts().appends, 2);
});
