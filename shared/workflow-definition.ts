import { z } from 'zod';
import { commandSchema } from './contracts';

// Explicit user-authored commands only, never commands inferred from a model plan.
export const graphTestsSchema = z
  .array(
    commandSchema.extend({
      timeoutMs: z.number().int().min(100).max(30_000),
    }),
  )
  .min(1)
  .max(10)
  .refine(
    (tests) => tests.reduce((total, test) => total + test.timeoutMs, 0) <= 120_000,
    'Graph test budget exceeds 120 seconds',
  );

const identifier = z.string().trim().min(1).max(100);
export const workflowDefinitionSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(200),
    entry: identifier,
    // Count each step activation, including the entry and human checkpoints.
    // Persist consumption before dispatch; exhaustion must stop without approval.
    // This global budget bounds every cycle, including nested cycles.
    maxTransitions: z.number().int().min(1).max(1000),
    steps: z
      .array(
        z
          .object({
            id: identifier,
            instruction: z.string().trim().min(1).max(16000),
            selection: z.object({ provider: z.string().trim().min(1), modeId: z.string().trim().min(1) }).strict(),
            access: z.enum(['read-only', 'write']),
            contract: z.enum(['plan', 'build', 'review', 'human']),
            tests: graphTestsSchema.optional(),
            transitions: z
              .array(
                z
                  .object({
                    outcome: z.enum(['success', 'failure', 'approve', 'reject']),
                    target: identifier.nullable(),
                  })
                  .strict(),
              )
              .min(1)
              .max(4),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((graph, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const ids = new Set(graph.steps.map((step) => step.id));
    if (ids.size !== graph.steps.length) fail('Duplicate step IDs');
    if (!ids.has(graph.entry)) fail('Unknown entry step');
    for (const step of graph.steps) {
      if (step.contract === 'human' && step.tests) fail(`Human steps cannot execute tests: ${step.id}`);
      const outcomes = step.transitions.map((edge) => edge.outcome);
      if (new Set(outcomes).size !== outcomes.length) fail(`Ambiguous transitions: ${step.id}`);
      const expected = step.contract === 'human' ? ['approve', 'reject'] : ['success', 'failure'];
      if (expected.some((outcome) => !outcomes.includes(outcome as (typeof outcomes)[number])))
        fail(`Missing outcome transition: ${step.id}`);
      if (outcomes.some((outcome) => !expected.includes(outcome))) fail(`Invalid outcome: ${step.id}`);
      if (['plan', 'review', 'human'].includes(step.contract) && step.access !== 'read-only')
        fail(`Analysis and human steps must be read-only: ${step.id}`);
      for (const edge of step.transitions)
        if (edge.target !== null && !ids.has(edge.target)) fail(`Unknown target: ${edge.target}`);
    }
    const reachable = new Set<string>();
    const pending = [graph.entry];
    while (pending.length) {
      const id = pending.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const edge of graph.steps.find((step) => step.id === id)?.transitions ?? [])
        if (edge.target !== null) pending.push(edge.target);
    }
    for (const step of graph.steps) if (!reachable.has(step.id)) fail(`Unreachable step: ${step.id}`);
    // Require a possible terminal path from every step; a budget is a safety stop,
    // not a successful completion path.
    const terminating = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const step of graph.steps)
        if (
          !terminating.has(step.id) &&
          step.transitions.some((edge) => edge.target === null || terminating.has(edge.target))
        ) {
          terminating.add(step.id);
          changed = true;
        }
    }
    for (const step of graph.steps) if (!terminating.has(step.id)) fail(`No terminal path: ${step.id}`);
  });
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export function codeReviewPreset(
  selections: {
    code: WorkflowDefinition['steps'][number]['selection'];
    review: WorkflowDefinition['steps'][number]['selection'];
  },
  maxCorrections = 3,
): WorkflowDefinition {
  if (!Number.isInteger(maxCorrections) || maxCorrections < 0 || maxCorrections > 100)
    throw new Error('Correction limit must be an integer between 0 and 100');
  return workflowDefinitionSchema.parse({
    version: 1,
    name: 'Code ↔ Review',
    entry: 'code',
    maxTransitions: 2 * (maxCorrections + 1),
    steps: [
      {
        id: 'code',
        instruction: 'Implement the task and address review findings.',
        selection: selections.code,
        access: 'write',
        contract: 'build',
        transitions: [
          { outcome: 'success', target: 'review' },
          { outcome: 'failure', target: null },
        ],
      },
      {
        id: 'review',
        instruction: 'Review the changes and report remaining issues.',
        selection: selections.review,
        access: 'read-only',
        contract: 'review',
        transitions: [
          { outcome: 'success', target: null },
          { outcome: 'failure', target: 'code' },
        ],
      },
    ],
  });
}
