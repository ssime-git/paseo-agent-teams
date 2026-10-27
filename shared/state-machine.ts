export const HUMAN_CHECKPOINTS: readonly string[] = ['awaiting_plan', 'awaiting_final', 'attention'];
export const TERMINAL_OR_WAITING: readonly string[] = ['completed', 'paused', ...HUMAN_CHECKPOINTS];
export const DISPATCH_BLOCKED: readonly string[] = [...TERMINAL_OR_WAITING, 'permission'];

export const PHASE_ROLES = {
  planning: 'planner',
  building: 'builder',
  testing: 'builder',
  reviewing: 'reviewer',
  delivering: 'builder',
  done: 'reviewer',
  followup: 'planner',
} as const;
export const STAGE_TRANSITIONS = {
  planner: 'building',
  builder: 'testing',
  tests: 'reviewing',
  reviewer: 'done',
} as const;
