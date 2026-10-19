import { defineRpc } from '@getpaseo/plugin';
import { z } from 'zod';

export const roles = ['planner', 'builder', 'reviewer'] as const;
export const roleSchema = z.enum(roles);
export type Role = z.infer<typeof roleSchema>;
export const selectionSchema = z.object({ provider: z.string().min(3), modeId: z.string().min(1), thinkingOptionId: z.string().optional() }).strict();
export const commandSchema = z.object({ command: z.string().min(1).max(8000), timeoutMs: z.number().int().min(100).max(3_600_000).default(600_000) }).strict();
export const configSchema = z.object({
  version: z.literal(1),
  mode: z.enum(['manual', 'auto']).default('auto'),
  roles: z.object({ planner: selectionSchema, builder: selectionSchema, reviewer: selectionSchema }).strict(),
  validation: z.enum(['plan', 'final', 'autonomous']).default('plan'),
  autoFix: z.boolean().default(true),
  maxCorrections: z.number().int().min(0).max(10).default(2),
  recovery: z.enum(['explicit', 'automatic']).default('explicit'),
  testCommands: z.array(commandSchema).default([]),
  allowNoTests: z.boolean().default(false),
}).strict();
export type Config = z.infer<typeof configSchema>;
export const planSchema = z.object({ summary: z.string().min(1), tasks: z.array(z.string()).min(1), acceptance: z.array(z.string()).min(1), tests: z.array(commandSchema) }).strict();
export const buildSchema = z.object({ summary: z.string().min(1), changes: z.array(z.string()), remaining: z.array(z.string()) }).strict();
export const reviewSchema = z.object({ verdict: z.enum(['pass', 'fail']), summary: z.string().min(1), issues: z.array(z.string()) }).strict().refine(v => v.verdict !== 'fail' || v.issues.length > 0, 'A failed review needs actionable issues');
export type Plan = z.infer<typeof planSchema>;
export type Review = z.infer<typeof reviewSchema>;
export const testResultSchema = commandSchema.extend({ stdout: z.string(), stderr: z.string(), exitCode: z.number().nullable(), durationMs: z.number(), timedOut: z.boolean(), truncated: z.boolean() });
export type TestResult = z.infer<typeof testResultSchema>;
export const cardSchema = z.object({ workflowId: z.string(), status: z.string(), detail: z.string(), cycle: z.number() });
export const eventSchema = z.object({ id: z.string(), at: z.string(), kind: z.string(), role: roleSchema.optional(), text: z.string() });
export const workflowSchema = z.object({
  version: z.literal(1), id: z.string(), revision: z.number(), workspaceId: z.string(), cwd: z.string(), repo: z.string(), task: z.string(), config: configSchema,
  agents: z.partialRecord(roleSchema, z.string()),
  phase: z.enum(['planning', 'building', 'testing', 'reviewing', 'manual', 'done']),
  status: z.enum(['ready', 'running', 'awaiting_plan', 'awaiting_final', 'paused', 'permission', 'attention', 'completed']),
  resumeStatus: z.enum(['ready', 'awaiting_plan', 'awaiting_final', 'attention']).optional(),
  cycle: z.number(), plan: planSchema.optional(), build: buildSchema.optional(), review: reviewSchema.optional(),
  testedFingerprint: z.string().optional(),
  tests: z.array(testResultSchema), testsApproved: z.boolean(), allowNoTests: z.boolean(),
  events: z.array(eventSchema), requests: z.record(z.string(), z.string()),
  pendingRole: roleSchema.optional(), activeRole: roleSchema.default('planner'),
  operation: z.object({ id: z.string(), role: roleSchema, phase: z.string(), state: z.enum(['prepared', 'sent']), startedAt: z.string() }).optional(),
  cursors: z.record(z.string(), z.object({ epoch: z.string(), seq: z.number() })).default({}),
  baseline: z.string(), error: z.string().optional(),
});
export type Workflow = z.infer<typeof workflowSchema>;
export const createInput = z.object({ workspaceId: z.string(), task: z.string().min(1), config: configSchema, requestId: z.string().min(1) });
export const actionInput = z.object({
  id: z.string(), requestId: z.string().min(1), expectedRevision: z.number().int(),
  action: z.enum(['approve', 'pause', 'resume', 'handoff', 'message', 'finish']),
  role: roleSchema.optional(), message: z.string().optional(), tests: z.array(commandSchema).optional(), allowNoTests: z.boolean().optional(),
});
export type Action = z.infer<typeof actionInput>;
export const createRpc = defineRpc({ name: 'teams.create', input: createInput, output: workflowSchema });
export const actionRpc = defineRpc({ name: 'teams.action', input: actionInput, output: workflowSchema });
export const listRpc = defineRpc({ name: 'teams.list', input: z.object({ workspaceId: z.string() }), output: z.array(workflowSchema) });
export const historyRpc = defineRpc({ name: 'teams.history', input: z.object({ id: z.string() }), output: z.array(eventSchema) });
export const catalogRpc = defineRpc({ name: 'teams.catalog', input: z.object({ workspaceId: z.string() }), output: z.object({ cwd: z.string(), providers: z.array(z.object({
  id: z.string(), models: z.array(z.object({ id: z.string(), label: z.string(), isDefault: z.boolean() })), modes: z.array(z.object({ id: z.string(), label: z.string() })),
})) }) });
