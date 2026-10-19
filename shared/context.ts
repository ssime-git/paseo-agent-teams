import type { Role } from './contracts';
/** Targets, measured with an approximate UTF-8 byte / 4 token estimate. */
export const HANDOFF_BUDGET: Record<Role, number> = { planner: 4_000, builder: 8_000, reviewer: 12_000 };
