import { workflowSchema } from '../shared/contracts';

export function workflowFixture() {
  const selection = { provider: 'harness/model', modeId: 'read-only' };
  return workflowSchema.parse({
    version: 1,
    id: 'fixture',
    revision: 0,
    workspaceId: 'owner',
    cwd: '/tmp',
    repo: '/tmp/.git',
    task: 'Fixture',
    config: { version: 1, roles: { planner: selection, builder: selection, reviewer: selection } },
    agents: {},
    phase: 'planning',
    status: 'awaiting_plan',
    cycle: 0,
    tests: [],
    testsApproved: false,
    allowNoTests: false,
    events: [],
    requests: {},
    baseline: '/tmp/unused-baseline',
  });
}
