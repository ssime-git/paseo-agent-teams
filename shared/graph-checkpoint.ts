import { z } from 'zod';
import { definitionRecordSchema, type DefinitionRecord } from './definition-catalog';
import { TeamError } from './errors';

const outcomeSchema = z.enum(['success', 'failure', 'approve', 'reject']);
const activationSchema = z
  .object({
    operationId: z.uuid(),
    stepId: z.string(),
    result: z
      .object({ outcome: outcomeSchema, summary: z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict();

// This checkpoint is deliberately separate from V1. Persist a reservation before
// dispatch and reuse its operationId after restart; never reserve another turn.
const checkpointShape = z
  .object({
    kind: z.literal('graph'),
    version: z.literal(1),
    id: z.uuid(),
    revision: z.number().int().positive(),
    repo: z.string().min(1),
    task: z.string().trim().min(1),
    source: definitionRecordSchema,
    status: z.enum(['ready', 'running', 'waiting_human', 'succeeded', 'failed', 'exhausted']),
    nextStepId: z.string().nullable(),
    activations: z.array(activationSchema),
  })
  .strict();
export type GraphCheckpoint = z.infer<typeof checkpointShape>;
export type GraphOutcome = z.infer<typeof outcomeSchema>;

// Replay the tiny transition ledger when loading: corrupt checkpoints must not
// silently reset a budget, skip a human decision or turn failure into success.
export const graphCheckpointSchema = checkpointShape.superRefine((state, ctx) => {
  const fail = () => ctx.addIssue({ code: 'custom', message: 'Inconsistent graph checkpoint' });
  const graph = state.source.definition;
  let next: string | null = graph.entry;
  let status: GraphCheckpoint['status'] = 'ready';
  const operations = new Set<string>();
  for (const activation of state.activations) {
    if (status !== 'ready' || next !== activation.stepId || operations.has(activation.operationId)) {
      fail();
      return;
    }
    operations.add(activation.operationId);
    const step = graph.steps.find((item) => item.id === next)!;
    if (!activation.result) {
      status = step.contract === 'human' ? 'waiting_human' : 'running';
      continue;
    }
    const edge = step.transitions.find((item) => item.outcome === activation.result!.outcome);
    if (!edge) {
      fail();
      return;
    }
    next = edge.target;
    if (next === null) status = ['success', 'approve'].includes(edge.outcome) ? 'succeeded' : 'failed';
  }
  const resolved = state.activations.filter((activation) => activation.result !== undefined).length;
  if (state.revision !== 1 + state.activations.length + resolved) fail();
  if (state.activations.length > graph.maxTransitions) fail();
  if (status === 'ready' && state.activations.length === graph.maxTransitions) status = 'exhausted';
  if (state.status !== status || state.nextStepId !== next) fail();
});

export function createGraphCheckpoint(input: {
  id: string;
  repo: string;
  task: string;
  source: DefinitionRecord;
}): GraphCheckpoint {
  return graphCheckpointSchema.parse({
    kind: 'graph',
    version: 1,
    revision: 1,
    ...input,
    status: 'ready',
    nextStepId: input.source.definition.entry,
    activations: [],
  });
}

export function reserveGraphActivation(raw: GraphCheckpoint, operationId: string): GraphCheckpoint {
  const state = graphCheckpointSchema.parse(raw);
  z.uuid().parse(operationId);
  const existing = state.activations.find((item) => item.operationId === operationId);
  if (existing) return state; // Lost response/retry never consumes a second activation.
  if (state.status !== 'ready') throw new TeamError('GRAPH_NOT_READY', 'Graph cannot activate another step');
  const step = state.source.definition.steps.find((item) => item.id === state.nextStepId)!;
  state.activations.push({ operationId, stepId: step.id });
  state.status = step.contract === 'human' ? 'waiting_human' : 'running';
  state.revision++;
  return graphCheckpointSchema.parse(state);
}

export function resolveGraphActivation(
  raw: GraphCheckpoint,
  operationId: string,
  result: { outcome: GraphOutcome; summary: string },
): GraphCheckpoint {
  const state = graphCheckpointSchema.parse(raw);
  const activation = state.activations.find((item) => item.operationId === operationId);
  if (!activation) throw new TeamError('GRAPH_OPERATION_NOT_FOUND', 'Unknown graph operation');
  if (activation.result) {
    if (activation.result.outcome !== result.outcome || activation.result.summary !== result.summary)
      throw new TeamError('GRAPH_RESULT_CONFLICT', 'Operation already resolved with a different result');
    return state;
  }
  const step = state.source.definition.steps.find((item) => item.id === activation.stepId)!;
  const edge = step.transitions.find((item) => item.outcome === result.outcome);
  if (!edge) throw new TeamError('GRAPH_INVALID_OUTCOME', 'Outcome does not match the step contract');
  activation.result = result;
  state.nextStepId = edge.target;
  state.status =
    edge.target === null
      ? ['success', 'approve'].includes(result.outcome)
        ? 'succeeded'
        : 'failed'
      : state.activations.length === state.source.definition.maxTransitions
        ? 'exhausted'
        : 'ready';
  state.revision++;
  return graphCheckpointSchema.parse(state);
}
