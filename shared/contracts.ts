import { defineRpc } from '@getpaseo/plugin';
import { z } from 'zod';

export const roles = ['planner', 'builder', 'reviewer'] as const;
export const roleSchema = z.enum(roles);
export type Role = z.infer<typeof roleSchema>;
export const selectionSchema = z
  .object({
    provider: z.string().regex(/^[^/]+\/.+$/, 'Provider must use harness/model format'),
    modeId: z.string().min(1),
    thinkingOptionId: z.string().optional(),
  })
  .strict();
export const commandSchema = z
  .object({
    command: z.string().min(1).max(8000),
    timeoutMs: z.number().int().min(100).max(3_600_000).default(600_000),
  })
  .strict();
export const configSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(['manual', 'auto']).default('auto'),
    repositoryPaths: z.array(z.string().min(1)).min(1).max(20).optional(),
    roles: z.object({ planner: selectionSchema, builder: selectionSchema, reviewer: selectionSchema }).strict(),
    validation: z.enum(['plan', 'final', 'autonomous']).default('plan'),
    autoFix: z.boolean().default(true),
    goalMode: z.boolean().optional(),
    goalMaxTurns: z.number().int().min(3).max(200).optional(),
    goalTimeBudgetMs: z.number().int().min(60_000).max(86_400_000).optional(),
    builderAutoAccept: z.boolean().default(false),
    freshSessionPerCycle: z.boolean().default(false),
    maxCorrections: z.number().int().min(0).default(2),
    recovery: z.enum(['explicit', 'automatic']).default('explicit'),
    testCommands: z.array(commandSchema).default([]),
    allowNoTests: z.boolean().default(false),
    testEnvironmentKeys: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).optional(),
    maxConsecutiveTimeouts: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export type Config = z.infer<typeof configSchema>;
export const planSchema = z
  .object({
    summary: z.string().min(1),
    tasks: z.array(z.string()).min(1),
    acceptance: z.array(z.string()).min(1),
    tests: z.array(commandSchema),
  })
  .strict();
export const planVersionSchema = z.object({
  version: z.number().int().positive(),
  plan: planSchema,
  source: z.enum(['planner', 'builder', 'reviewer', 'human', 'legacy']),
  at: z.string(),
  operationId: z.string().optional(),
  selection: selectionSchema.optional(),
  agentId: z.string().optional(),
  approval: z
    .object({ at: z.string(), policy: z.enum(['human', 'configuration', 'legacy']), allowNoTests: z.boolean() })
    .optional(),
});
export const buildSchema = z
  .object({
    summary: z.string().min(1),
    changes: z.array(z.string()),
    remaining: z.array(z.string()),
    tests: z.array(commandSchema).min(1).optional(),
  })
  .strict();
export const reviewSchema = z
  .object({ verdict: z.enum(['pass', 'fail']), summary: z.string().min(1), issues: z.array(z.string()) })
  .strict()
  .refine((v) => v.verdict !== 'fail' || v.issues.length > 0, 'A failed review needs actionable issues');
export type Plan = z.infer<typeof planSchema>;
export const planRevisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('discussion'), summary: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('proposal'), summary: z.string().min(1), plan: planSchema }).strict(),
]);
export const planProposalSchema = z.object({
  plan: planSchema,
  summary: z.string(),
  baseVersion: z.number().int().positive(),
  operationId: z.string(),
  agentId: z.string(),
  selection: selectionSchema,
  at: z.string(),
});
export type Review = z.infer<typeof reviewSchema>;
export const testResultSchema = commandSchema.extend({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().nullable(),
  durationMs: z.number(),
  timedOut: z.boolean(),
  truncated: z.boolean(),
});
export type TestResult = z.infer<typeof testResultSchema>;
export const cardSchema = z.object({
  workflowId: z.string(),
  status: z.string(),
  detail: z.string(),
  artifact: z.object({ role: roleSchema, text: z.string() }).optional(),
  cycle: z.number(),
  maxCorrections: z.number().optional(),
  workspaceId: z.string().optional(),
  handoffTokens: z.number().optional(),
});
export const eventSchema = z.object({
  id: z.string(),
  at: z.string(),
  kind: z.string(),
  role: roleSchema.optional(),
  text: z.string(),
});
export const workflowSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  revision: z.number(),
  workspaceId: z.string(),
  cwd: z.string(),
  repo: z.string(),
  repositoryTargets: z
    .array(z.object({ root: z.string(), lock: z.string() }))
    .min(1)
    .max(20)
    .optional(),
  task: z.string(),
  config: configSchema,
  agents: z.partialRecord(roleSchema, z.string()),
  phase: z.enum(['planning', 'building', 'testing', 'reviewing', 'manual', 'done', 'followup']),
  status: z.enum([
    'ready',
    'running',
    'awaiting_plan',
    'awaiting_final',
    'paused',
    'permission',
    'attention',
    'completed',
  ]),
  resumeStatus: z.enum(['ready', 'awaiting_plan', 'awaiting_final', 'attention']).optional(),
  cycle: z.number(),
  plan: planSchema.optional(),
  planVersions: z.array(planVersionSchema).optional(),
  planProposal: planProposalSchema.optional(),
  build: buildSchema.optional(),
  review: reviewSchema.optional(),
  testedFingerprint: z.string().optional(),
  goal: z
    .object({
      startedAt: z.string(),
      turns: z.number().int().nonnegative(),
      corrections: z.number().int().nonnegative(),
      replans: z.number().int().nonnegative(),
    })
    .optional(),
  resultRepair: z
    .object({ role: roleSchema, attempts: z.number().int().positive(), error: z.string(), text: z.string() })
    .optional(),
  tests: z.array(testResultSchema),
  testsApproved: z.boolean(),
  allowNoTests: z.boolean(),
  receipts: z.record(z.string(), z.string()).optional(),
  events: z.array(eventSchema),
  requests: z.record(z.string(), z.string()),
  pendingRole: roleSchema.optional(),
  activeRole: roleSchema.default('planner'),
  operation: z
    .object({
      id: z.string(),
      role: roleSchema,
      phase: z.string(),
      state: z.enum(['prepared', 'sent']),
      startedAt: z.string(),
      readOnlyFingerprint: z.string().optional(),
      consecutiveTimeouts: z.number().int().nonnegative().optional(),
    })
    .optional(),
  cursors: z.record(z.string(), z.object({ epoch: z.string(), seq: z.number() })).default({}),
  baseline: z.string(),
  agentCycles: z.partialRecord(roleSchema, z.number().int().nonnegative()).optional(),
  agentGenerations: z.partialRecord(roleSchema, z.number().int().nonnegative()).optional(),
  handoffTokens: z.number().int().nonnegative().optional(),
  followup: z
    .object({
      purpose: z.enum(['message', 'pull_request', 'plan_revision']),
      returnPhase: z.enum(['planning', 'building', 'testing', 'reviewing', 'manual', 'done']),
      returnStatus: z.enum(['paused', 'attention', 'awaiting_plan', 'awaiting_final', 'completed']),
      previousError: z.string().optional(),
      previousResumeStatus: z.enum(['ready', 'awaiting_plan', 'awaiting_final', 'attention']).optional(),
    })
    .optional(),
  followupResult: z.string().optional(),
  error: z.string().optional(),
});
export type Workflow = z.infer<typeof workflowSchema>;
export const createInput = z.object({
  workspaceId: z.string(),
  task: z.string().min(1),
  config: configSchema,
  requestId: z.string().min(1),
});
export const actionInput = z.object({
  id: z.string(),
  workspaceId: z.string().optional(),
  requestId: z.string().min(1),
  expectedRevision: z.number().int(),
  action: z.enum([
    'approve',
    'pause',
    'resume',
    'handoff',
    'message',
    'finish',
    'permission',
    'continue',
    'reconfigure',
    'followup',
    'adopt_plan',
    'start_goal',
  ]),
  purpose: z.enum(['message', 'pull_request', 'plan_revision']).optional(),
  selection: selectionSchema.optional(),
  extraCorrections: z.number().int().min(1).max(10).optional(),
  permissionId: z.string().optional(),
  behavior: z.enum(['allow', 'deny']).optional(),
  selectedActionId: z.string().optional(),
  role: roleSchema.optional(),
  message: z.string().optional(),
  tests: z.array(commandSchema).optional(),
  allowNoTests: z.boolean().optional(),
});
export type Action = z.infer<typeof actionInput>;
export const permissionSchema = z.object({
  id: z.string(),
  role: roleSchema,
  title: z.string(),
  description: z.string(),
  details: z.string(),
  kind: z.enum(['tool', 'plan', 'question', 'mode', 'other']),
  actions: z.array(z.object({ id: z.string(), label: z.string(), behavior: z.enum(['allow', 'deny']) })),
  canAllow: z.boolean(),
});
export type Permission = z.infer<typeof permissionSchema>;
export const permissionsRpc = defineRpc({
  name: 'teams.permissions',
  input: z.object({ id: z.string(), workspaceId: z.string() }),
  output: z.array(permissionSchema),
});
export const createRpc = defineRpc({ name: 'teams.create', input: createInput, output: workflowSchema });
export const actionRpc = defineRpc({ name: 'teams.action', input: actionInput, output: workflowSchema });
export const listRpc = defineRpc({
  name: 'teams.list',
  input: z.object({ workspaceId: z.string() }),
  output: z.array(workflowSchema),
});
export const workflowIndexRpc = defineRpc({
  name: 'teams.workflow_index',
  input: z.object({}),
  output: z.array(
    workflowSchema
      .pick({ id: true, workspaceId: true, cwd: true, task: true, status: true, phase: true })
      .extend({ updatedAt: z.string(), closed: z.boolean() }),
  ),
});
export const workflowRecordRpc = defineRpc({
  name: 'teams.workflow_record',
  input: z.object({ id: z.string() }),
  output: workflowSchema
    .pick({
      id: true,
      workspaceId: true,
      cwd: true,
      task: true,
      status: true,
      phase: true,
      cycle: true,
      plan: true,
      planVersions: true,
      planProposal: true,
      build: true,
      review: true,
      tests: true,
      events: true,
      agents: true,
      allowNoTests: true,
    })
    .extend({ closed: z.boolean() }),
});
export const historyRpc = defineRpc({
  name: 'teams.history',
  input: z.object({ id: z.string(), workspaceId: z.string().optional() }),
  output: z.array(eventSchema),
});
export const testOutputRpc = defineRpc({
  name: 'teams.test_output',
  input: z.object({ id: z.string(), workspaceId: z.string() }),
  output: z.array(testResultSchema),
});
export const catalogRpc = defineRpc({
  name: 'teams.catalog',
  input: z.object({ workspaceId: z.string(), repositoryPaths: z.array(z.string()).max(20).optional() }),
  output: z.object({
    cwd: z.string(),
    gitRoot: z.string().nullable().optional(),
    searchTruncated: z.boolean().optional(),
    selectedRepositories: z.array(z.string()).optional(),
    launchIssue: z.string().optional(),
    blockingWorkflow: workflowSchema
      .pick({ id: true, workspaceId: true, task: true, status: true, revision: true })
      .optional(),
    repositories: z.array(z.string()).default([]),
    providers: z.array(
      z.object({
        id: z.string(),
        family: z.string(),
        label: z.string(),
        models: z.array(z.object({ id: z.string(), label: z.string(), isDefault: z.boolean() })),
        modes: z.array(z.object({ id: z.string(), label: z.string() })),
      }),
    ),
  }),
});

// Exact saved assistant responses let clients decorate only plugin-owned native messages.
export const nativeArtifactSchema = z.object({
  eventId: z.string(),
  workflowId: z.string(),
  workspaceId: z.string(),
  role: roleSchema,
  text: z.string(),
});
export const nativeArtifactsRpc = defineRpc({
  name: 'teams.native_artifacts',
  input: z.object({ revision: z.string().optional() }),
  output: z.object({ revision: z.string(), records: z.array(nativeArtifactSchema).optional() }),
});
export const nativeBriefSchema = z.object({ text: z.string() });
