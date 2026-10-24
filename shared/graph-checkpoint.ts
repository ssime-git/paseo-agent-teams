import { z } from 'zod';
import { definitionRecordSchema, type DefinitionRecord } from './definition-catalog';
import { TeamError } from './errors';
import { planSchema, buildSchema, reviewSchema } from './contracts';
import { parseJson } from './artifacts';

const artifactSchema = z.discriminatedUnion('contract', [
  z.object({ contract: z.literal('plan'), value: planSchema }).strict(),
  z.object({ contract: z.literal('build'), value: buildSchema }).strict(),
  z.object({ contract: z.literal('review'), value: reviewSchema }).strict(),
]);
const resultSchema = z
  .object({
    outcome: z.enum(['success', 'failure', 'approve', 'reject']),
    summary: z.string().min(1),
    artifact: artifactSchema.optional(),
  })
  .strict();

export const graphReceiptSchema = z
  .object({
    agentId: z.uuid(),
    attemptId: z.uuid(),
    turnId: z.string().min(1),
    outcome: z.enum(['completed', 'failed', 'canceled']),
    text: z
      .string()
      .max(256 * 1024)
      .optional(),
    error: z.string().optional(),
  })
  .strict();

const assessmentSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('valid'), result: resultSchema }).strict(),
  z.object({ status: z.enum(['invalid', 'failed', 'canceled']), reason: z.string().min(1) }).strict(),
]);

const activationSchema = z
  .object({
    operationId: z.uuid(),
    stepId: z.string(),
    result: resultSchema.optional(),
    receipt: graphReceiptSchema.optional(),
    assessment: assessmentSchema.optional(),
    // Bind the exact session and prompt before dispatch, never infer delivery.
    dispatch: z
      .object({
        agentId: z.uuid(),
        attemptId: z.uuid().optional(),
        prompt: z
          .string()
          .min(1)
          .max(256 * 1024),
      })
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
export type GraphOutcome = z.infer<typeof resultSchema>['outcome'];

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
    if (
      activation.dispatch &&
      (step.contract === 'human' ||
        !activation.dispatch.prompt.includes(`[agent-teams-operation:${activation.operationId}]`))
    ) {
      fail();
      return;
    }
    if (
      activation.receipt &&
      (!activation.dispatch?.attemptId ||
        activation.receipt.agentId !== activation.dispatch.agentId ||
        activation.receipt.attemptId !== activation.dispatch.attemptId)
    ) {
      fail();
      return;
    }
    if (
      activation.assessment &&
      (!activation.receipt ||
        JSON.stringify(activation.assessment) !== JSON.stringify(assessReceipt(step.contract, activation.receipt)))
    ) {
      fail();
      return;
    }
    if (!activation.result) {
      status = step.contract === 'human' ? 'waiting_human' : 'running';
      continue;
    }
    if (
      activation.assessment &&
      (activation.assessment.status !== 'valid' ||
        JSON.stringify(activation.result) !== JSON.stringify(activation.assessment.result))
    ) {
      fail();
      return;
    }
    const artifact = activation.result.artifact;
    if (
      artifact &&
      (artifact.contract !== step.contract ||
        activation.result.summary !== artifact.value.summary ||
        activation.result.outcome !== artifactOutcome(artifact))
    ) {
      fail();
      return;
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
  const bound = state.activations.filter((activation) => activation.dispatch !== undefined).length;
  const attempted = state.activations.filter((activation) => activation.dispatch?.attemptId !== undefined).length;
  const receipts = state.activations.filter((activation) => activation.receipt !== undefined).length;
  const assessments = state.activations.filter((activation) => activation.assessment !== undefined).length;
  if (state.revision !== 1 + state.activations.length + resolved + bound + attempted + receipts + assessments) fail();
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
  result: z.infer<typeof resultSchema>,
): GraphCheckpoint {
  const state = graphCheckpointSchema.parse(raw);
  const activation = state.activations.find((item) => item.operationId === operationId);
  if (!activation) throw new TeamError('GRAPH_OPERATION_NOT_FOUND', 'Unknown graph operation');
  if (activation.result) {
    if (JSON.stringify(resultSchema.parse(activation.result)) !== JSON.stringify(resultSchema.parse(result)))
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

// A valid build artifact reports completed work, not independently executed tests.
// Keep remaining work on the failure branch. Human decisions never come from models.
function artifactOutcome(artifact: z.infer<typeof artifactSchema>): GraphOutcome {
  if (artifact.contract === 'review') return artifact.value.verdict === 'pass' ? 'success' : 'failure';
  if (artifact.contract === 'build' && artifact.value.remaining.length) return 'failure';
  return 'success';
}

// Validate only the saved terminal output. Never recover a convenient JSON block
// from prose, infer an answer, run tests, or turn a technical failure into success.
function assessReceipt(
  contract: string,
  receipt: z.infer<typeof graphReceiptSchema>,
): z.infer<typeof assessmentSchema> {
  if (receipt.outcome !== 'completed')
    return { status: receipt.outcome, reason: receipt.error || `Native turn ${receipt.outcome}` };
  try {
    const artifact = artifactSchema.parse({ contract, value: parseJson(receipt.text ?? '') });
    return {
      status: 'valid',
      result: { outcome: artifactOutcome(artifact), summary: artifact.value.summary, artifact },
    };
  } catch {
    return { status: 'invalid', reason: 'Native output does not match the step result contract' };
  }
}

// Staging only: even a valid artifact is not independent test or read-only
// evidence. Keep the reservation until a future executor verifies those gates.
export function assessGraphReceipt(raw: GraphCheckpoint, operationId: string): GraphCheckpoint {
  const state = graphCheckpointSchema.parse(raw);
  const activation = state.activations.find((item) => item.operationId === operationId);
  if (!activation) throw new TeamError('GRAPH_OPERATION_NOT_FOUND', 'Unknown graph operation');
  if (activation.assessment) return state;
  if (!activation.receipt) throw new TeamError('GRAPH_RECEIPT_REQUIRED', 'Native completion receipt required');
  if (activation.result || state.status !== 'running')
    throw new TeamError('GRAPH_NOT_RUNNING', 'A pending native activation is required');
  const step = state.source.definition.steps.find((item) => item.id === activation.stepId)!;
  activation.assessment = assessReceipt(step.contract, activation.receipt);
  state.revision++;
  return graphCheckpointSchema.parse(state);
}

export function resolveGraphArtifact(raw: GraphCheckpoint, operationId: string, text: string): GraphCheckpoint {
  const state = graphCheckpointSchema.parse(raw);
  const activation = state.activations.find((item) => item.operationId === operationId);
  if (!activation) throw new TeamError('GRAPH_OPERATION_NOT_FOUND', 'Unknown graph operation');
  const step = state.source.definition.steps.find((item) => item.id === activation.stepId)!;
  if (step.contract === 'human')
    throw new TeamError('GRAPH_HUMAN_DECISION_REQUIRED', 'Explicit human decision required');
  // One JSON document, optionally fenced; never pick a convenient artifact from prose.
  const artifact = artifactSchema.parse({ contract: step.contract, value: parseJson(text) });
  return resolveGraphActivation(state, operationId, {
    outcome: artifactOutcome(artifact),
    summary: artifact.value.summary,
    artifact,
  });
}

// This is a durable dispatch intent, not proof that a native turn was accepted.
// After a crash the executor must inspect this session using the operation UUID;
// uncertainty must retain the intent rather than create a replacement session.
export function bindGraphDispatch(
  raw: GraphCheckpoint,
  operationId: string,
  dispatch: NonNullable<GraphCheckpoint['activations'][number]['dispatch']>,
): GraphCheckpoint {
  const state = graphCheckpointSchema.parse(raw);
  const binding = activationSchema.shape.dispatch.unwrap().parse(dispatch);
  if (binding.attemptId) throw new TeamError('GRAPH_INVALID_DISPATCH', 'Bind without an attempt first');
  const activation = state.activations.find((item) => item.operationId === operationId);
  if (!activation) throw new TeamError('GRAPH_OPERATION_NOT_FOUND', 'Unknown graph operation');
  if (activation.dispatch) {
    if (activation.dispatch.agentId !== binding.agentId || activation.dispatch.prompt !== binding.prompt)
      throw new TeamError('GRAPH_DISPATCH_CONFLICT', 'Operation already bound to a different session or prompt');
    return state;
  }
  if (state.status !== 'running' || activation.result)
    throw new TeamError('GRAPH_NOT_RUNNING', 'Only a pending model activation can bind a native dispatch');
  if (!binding.prompt.includes(`[agent-teams-operation:${operationId}]`))
    throw new TeamError('GRAPH_OPERATION_MARKER_REQUIRED', 'Dispatch prompt must include its operation marker');
  activation.dispatch = binding;
  state.revision++;
  return graphCheckpointSchema.parse(state);
}

// Only the caller whose unique attempt wins publication may send. A saved attempt
// is never an invitation to retry, including a crash before the native call.
export function claimGraphDispatch(raw: GraphCheckpoint, operationId: string, attemptId: string): GraphCheckpoint {
  const state = graphCheckpointSchema.parse(raw);
  z.uuid().parse(attemptId);
  const activation = state.activations.find((item) => item.operationId === operationId);
  if (!activation?.dispatch || activation.result || state.status !== 'running')
    throw new TeamError('GRAPH_NOT_RUNNING', 'A pending bound activation is required');
  if (activation.dispatch.attemptId)
    throw new TeamError('GRAPH_DISPATCH_CLAIMED', 'Native dispatch already attempted; inspect without resending');
  activation.dispatch.attemptId = attemptId;
  state.revision++;
  return graphCheckpointSchema.parse(state);
}

// A lifecycle receipt records a native terminal event; it does not validate the
// model artifact, prove read-only behavior, or authorize a graph transition.
export function recordGraphReceipt(
  raw: GraphCheckpoint,
  operationId: string,
  input: z.infer<typeof graphReceiptSchema>,
): GraphCheckpoint {
  const state = graphCheckpointSchema.parse(raw);
  const receipt = graphReceiptSchema.parse(input);
  const activation = state.activations.find((item) => item.operationId === operationId);
  if (
    !activation?.dispatch?.attemptId ||
    activation.dispatch.agentId !== receipt.agentId ||
    activation.dispatch.attemptId !== receipt.attemptId
  )
    throw new TeamError('GRAPH_RECEIPT_MISMATCH', 'Receipt must match the saved native dispatch attempt');
  if (activation.receipt) {
    if (JSON.stringify(activation.receipt) !== JSON.stringify(receipt))
      throw new TeamError('GRAPH_RECEIPT_CONFLICT', 'Native completion already recorded differently');
    return state;
  }
  if (state.status !== 'running' || activation.result)
    throw new TeamError('GRAPH_NOT_RUNNING', 'A pending native activation is required');
  activation.receipt = receipt;
  state.revision++;
  return graphCheckpointSchema.parse(state);
}
