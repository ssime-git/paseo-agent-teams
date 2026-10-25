import { z } from 'zod';
import { definitionRecordSchema, type DefinitionRecord } from './definition-catalog';
import { TeamError } from './errors';
import {
  planSchema,
  buildSchema,
  reviewSchema,
  testResultSchema,
  clarificationSchema,
  clarificationAnswerSchema,
} from './contracts';
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
  z.object({ status: z.literal('clarification'), request: clarificationSchema }).strict(),
  z.object({ status: z.enum(['invalid', 'failed', 'canceled']), reason: z.string().min(1) }).strict(),
]);

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const graphHumanDecisionSchema = z
  .object({
    id: z.uuid(),
    outcome: z.enum(['approve', 'reject']),
    summary: z.string().trim().min(1).max(4000),
  })
  .strict();

const activationSchema = z
  .object({
    operationId: z.uuid(),
    stepId: z.string(),
    result: resultSchema.optional(),
    humanDecision: graphHumanDecisionSchema.optional(),
    clarificationAnswers: z.array(clarificationAnswerSchema).min(1).max(10).optional(),
    receipt: graphReceiptSchema.optional(),
    assessment: assessmentSchema.optional(),
    integrity: z.object({ fingerprint: fingerprintSchema, unchanged: z.boolean() }).strict().optional(),
    consumption: z.object({ fingerprint: fingerprintSchema }).strict().optional(),
    testRun: z
      .object({
        attemptId: z.uuid(),
        fingerprint: fingerprintSchema,
        completion: z
          .object({
            results: z.array(testResultSchema).max(10),
            fingerprint: fingerprintSchema,
            error: z.string().min(1).max(4000).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    // Bind the exact session and prompt before dispatch, never infer delivery.
    dispatch: z
      .object({
        agentId: z.uuid(),
        attemptId: z.uuid().optional(),
        baseline: fingerprintSchema.optional(),
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
      activation.humanDecision &&
      (step.contract !== 'human' ||
        !activation.result ||
        activation.result.artifact ||
        activation.result.outcome !== activation.humanDecision.outcome ||
        activation.result.summary !== activation.humanDecision.summary ||
        state.activations.some(
          (other) => other !== activation && other.humanDecision?.id === activation.humanDecision!.id,
        ))
    ) {
      fail();
      return;
    }
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
      (activation.dispatch?.baseline && (!activation.dispatch.attemptId || step.access !== 'read-only')) ||
      (activation.integrity &&
        (!activation.receipt ||
          !activation.dispatch?.baseline ||
          activation.integrity.unchanged !== (activation.integrity.fingerprint === activation.dispatch.baseline)))
    ) {
      fail();
      return;
    }
    if (
      activation.assessment &&
      (!activation.receipt ||
        JSON.stringify(activation.assessment) !==
          JSON.stringify(
            assessReceipt(step.contract, activation.receipt, activation.assessment.status === 'clarification'),
          ))
    ) {
      fail();
      return;
    }
    if (activation.assessment?.status === 'clarification') {
      if (
        step.contract !== 'plan' ||
        step.access !== 'read-only' ||
        !activation.integrity?.unchanged ||
        activation.result ||
        activation.consumption ||
        activation.testRun ||
        activation.humanDecision
      ) {
        fail();
        return;
      }
      const questions = activation.assessment.request.questions;
      const answers = activation.clarificationAnswers ?? [];
      if (
        new Set(answers.map((a) => a.questionId)).size !== answers.length ||
        answers.some((answer) => !validClarificationAnswer(questions, answer))
      ) {
        fail();
        return;
      }
      status = answers.length === questions.length ? 'ready' : 'waiting_human';
      // All answers return to this same step; they never produce a final plan.
      continue;
    }
    if (activation.clarificationAnswers) {
      fail();
      return;
    }
    if (activation.testRun) {
      const run = activation.testRun;
      const completion = run.completion;
      if (
        !step.tests ||
        activation.receipt?.outcome !== 'completed' ||
        activation.assessment?.status !== 'valid' ||
        (step.access === 'read-only' &&
          (!activation.integrity?.unchanged || run.fingerprint !== activation.integrity.fingerprint)) ||
        (completion &&
          (completion.results.length > step.tests.length ||
            (!completion.error && completion.results.length !== step.tests.length) ||
            completion.results.some(
              (result, index) =>
                result.command !== step.tests![index].command ||
                result.timeoutMs !== step.tests![index].timeoutMs ||
                result.durationMs < 0 ||
                result.stdout.length > 128 * 1024 ||
                result.stderr.length > 128 * 1024,
            )))
      ) {
        fail();
        return;
      }
    }
    if (!activation.result) {
      if (activation.consumption) {
        fail();
        return;
      }
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
    if (activation.consumption) {
      try {
        assertGraphConsumption(state, activation.operationId, activation.consumption.fingerprint);
      } catch {
        fail();
        return;
      }
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
  const integrity = state.activations.filter((activation) => activation.integrity !== undefined).length;
  const assessments = state.activations.filter((activation) => activation.assessment !== undefined).length;
  if (
    state.revision !==
    1 +
      state.activations.length +
      resolved +
      bound +
      attempted +
      receipts +
      assessments +
      integrity +
      state.activations.filter((a) => a.testRun).length +
      state.activations.filter((a) => a.testRun?.completion).length +
      state.activations.reduce((count, a) => count + (a.clarificationAnswers?.length ?? 0), 0)
  )
    fail();
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
  if (activation.assessment?.status === 'clarification')
    throw new TeamError('GRAPH_CLARIFICATION_PENDING', 'Clarification cannot produce a final result');
  if (activation.dispatch?.attemptId)
    throw new TeamError('GRAPH_CONSUMPTION_REQUIRED', 'Native attempts must consume verified evidence');
  return applyGraphResult(state, operationId, result);
}

// Internal explicit-input boundary, never called by model parsing or a timeout.
// The future authenticated UI adapter owns the assertion that a human submitted it.
export function decideGraphHuman(
  raw: GraphCheckpoint,
  operationId: string,
  input: z.infer<typeof graphHumanDecisionSchema>,
): GraphCheckpoint {
  const state = graphCheckpointSchema.parse(raw);
  const decision = graphHumanDecisionSchema.parse(input);
  const activation = state.activations.find((item) => item.operationId === operationId);
  if (!activation) throw new TeamError('GRAPH_OPERATION_NOT_FOUND', 'Unknown graph operation');
  const step = state.source.definition.steps.find((item) => item.id === activation.stepId)!;
  if (step.contract !== 'human')
    throw new TeamError('GRAPH_HUMAN_STEP_REQUIRED', 'Only a human step accepts an explicit decision');
  if (activation.humanDecision) {
    if (JSON.stringify(activation.humanDecision) !== JSON.stringify(decision))
      throw new TeamError('GRAPH_DECISION_CONFLICT', 'Human decision already recorded differently');
    return state;
  }
  if (state.activations.some((item) => item.humanDecision?.id === decision.id))
    throw new TeamError('GRAPH_DECISION_CONFLICT', 'Human decision ID already used by another operation');
  if (activation.result || state.status !== 'waiting_human')
    throw new TeamError('GRAPH_NOT_WAITING_HUMAN', 'A pending human checkpoint is required');
  activation.humanDecision = decision;
  return applyGraphResult(state, operationId, { outcome: decision.outcome, summary: decision.summary });
}

function validClarificationAnswer(
  questions: z.infer<typeof clarificationSchema>['questions'],
  answer: z.infer<typeof clarificationAnswerSchema>,
) {
  const question = questions.find((q) => q.id === answer.questionId);
  return !!question && (!answer.optionId || question.options.some((o) => o.id === answer.optionId));
}

// One explicit answer per revision. Retries are immutable; no inferred defaults.
export function answerGraphClarification(
  raw: GraphCheckpoint,
  operationId: string,
  input: z.infer<typeof clarificationAnswerSchema>,
): GraphCheckpoint {
  const state = graphCheckpointSchema.parse(raw);
  const answer = clarificationAnswerSchema.parse(input);
  const activation = state.activations.find((a) => a.operationId === operationId);
  if (activation?.assessment?.status !== 'clarification')
    throw new TeamError('GRAPH_CLARIFICATION_REQUIRED', 'A saved clarification is required');
  if (!validClarificationAnswer(activation.assessment.request.questions, answer))
    throw new TeamError('GRAPH_INVALID_ANSWER', 'Unknown clarification question or option');
  const existing = activation.clarificationAnswers?.find((a) => a.questionId === answer.questionId);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(answer))
      throw new TeamError('GRAPH_ANSWER_CONFLICT', 'Question already answered differently');
    return state;
  }
  if (state.status !== 'waiting_human')
    throw new TeamError('GRAPH_NOT_WAITING_HUMAN', 'A pending clarification is required');
  (activation.clarificationAnswers ??= []).push(answer);
  if (activation.clarificationAnswers.length === activation.assessment.request.questions.length)
    state.status = state.activations.length === state.source.definition.maxTransitions ? 'exhausted' : 'ready';
  state.revision++;
  return graphCheckpointSchema.parse(state);
}

function applyGraphResult(state: GraphCheckpoint, operationId: string, result: z.infer<typeof resultSchema>) {
  const activation = state.activations.find((item) => item.operationId === operationId)!;
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
  allowClarification = false,
): z.infer<typeof assessmentSchema> {
  if (receipt.outcome !== 'completed')
    return { status: receipt.outcome, reason: receipt.error || `Native turn ${receipt.outcome}` };
  try {
    const value = parseJson(receipt.text ?? '');
    if (allowClarification && contract === 'plan' && clarificationSchema.safeParse(value).success)
      return { status: 'clarification', request: clarificationSchema.parse(value) };
    const artifact = artifactSchema.parse({ contract, value });
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
  const assessment = assessReceipt(step.contract, activation.receipt, true);
  if (assessment.status === 'clarification') {
    if (step.access !== 'read-only' || !activation.integrity?.unchanged)
      throw new TeamError('GRAPH_INTEGRITY_REQUIRED', 'Clarification requires unchanged read-only evidence');
    state.status = 'waiting_human';
  }
  activation.assessment = assessment;
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
  if (binding.attemptId || binding.baseline)
    throw new TeamError('GRAPH_INVALID_DISPATCH', 'Bind without an attempt first');
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
export function claimGraphDispatch(
  raw: GraphCheckpoint,
  operationId: string,
  attemptId: string,
  baseline?: string,
): GraphCheckpoint {
  const state = graphCheckpointSchema.parse(raw);
  z.uuid().parse(attemptId);
  const activation = state.activations.find((item) => item.operationId === operationId);
  if (!activation?.dispatch || activation.result || state.status !== 'running')
    throw new TeamError('GRAPH_NOT_RUNNING', 'A pending bound activation is required');
  if (activation.dispatch.attemptId)
    throw new TeamError('GRAPH_DISPATCH_CLAIMED', 'Native dispatch already attempted; inspect without resending');
  activation.dispatch.attemptId = attemptId;
  if (baseline !== undefined) activation.dispatch.baseline = fingerprintSchema.parse(baseline);
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

// Evidence only. A mismatch stays durable, even if files are restored later.
export function recordGraphIntegrity(raw: GraphCheckpoint, operationId: string, fingerprint: string): GraphCheckpoint {
  const state = graphCheckpointSchema.parse(raw);
  const activation = state.activations.find((item) => item.operationId === operationId);
  if (!activation?.receipt || !activation.dispatch?.baseline)
    throw new TeamError('GRAPH_BASELINE_REQUIRED', 'Receipt and pre-send baseline required');
  if (activation.integrity) return state;
  if (activation.result || state.status !== 'running')
    throw new TeamError('GRAPH_NOT_RUNNING', 'A pending native activation is required');
  activation.integrity = {
    fingerprint: fingerprintSchema.parse(fingerprint),
    unchanged: fingerprint === activation.dispatch.baseline,
  };
  state.revision++;
  return graphCheckpointSchema.parse(state);
}

// A claim is saved before shell execution. A crash or lost reply remains uncertain;
// another caller must observe it, never rerun commands with possible side effects.
export function claimGraphTests(
  raw: GraphCheckpoint,
  operationId: string,
  attemptId: string,
  fingerprint: string,
): GraphCheckpoint {
  const state = graphCheckpointSchema.parse(raw);
  const activation = state.activations.find((a) => a.operationId === operationId);
  if (!activation || activation.result || state.status !== 'running' || activation.assessment?.status !== 'valid')
    throw new TeamError('GRAPH_TESTS_NOT_READY', 'Pending activation with valid native assessment required');
  if (activation.testRun)
    throw new TeamError('GRAPH_TESTS_CLAIMED', 'Tests already attempted; inspect without rerunning');
  activation.testRun = { attemptId: z.uuid().parse(attemptId), fingerprint: fingerprintSchema.parse(fingerprint) };
  state.revision++;
  return graphCheckpointSchema.parse(state);
}

export function completeGraphTests(
  raw: GraphCheckpoint,
  operationId: string,
  attemptId: string,
  completion: NonNullable<NonNullable<GraphCheckpoint['activations'][number]['testRun']>['completion']>,
): GraphCheckpoint {
  const state = graphCheckpointSchema.parse(raw);
  const activation = state.activations.find((a) => a.operationId === operationId);
  if (!activation?.testRun || activation.testRun.attemptId !== attemptId)
    throw new TeamError('GRAPH_TESTS_MISMATCH', 'Test completion must match its saved attempt');
  const value = activationSchema.shape.testRun.unwrap().shape.completion.unwrap().parse(completion);
  if (activation.testRun.completion) {
    if (JSON.stringify(activation.testRun.completion) !== JSON.stringify(value))
      throw new TeamError('GRAPH_TESTS_CONFLICT', 'Tests already completed differently');
    return state;
  }
  if (activation.result || state.status !== 'running')
    throw new TeamError('GRAPH_NOT_RUNNING', 'Pending activation required');
  activation.testRun.completion = value;
  state.revision++;
  return graphCheckpointSchema.parse(state);
}

// Verify saved evidence before consuming a model result. No implicit no-test
// approval: steps without explicitly configured tests stay reserved for now.
function assertGraphConsumption(state: GraphCheckpoint, operationId: string, fingerprint: string) {
  const activation = state.activations.find((item) => item.operationId === operationId);
  if (!activation || activation.receipt?.outcome !== 'completed' || activation.assessment?.status !== 'valid')
    throw new TeamError('GRAPH_ASSESSMENT_REQUIRED', 'Completed native receipt and valid assessment required');
  const step = state.source.definition.steps.find((item) => item.id === activation.stepId)!;
  if (
    step.access === 'read-only' &&
    (!activation.integrity?.unchanged || activation.integrity.fingerprint !== fingerprint)
  )
    throw new TeamError('GRAPH_INTEGRITY_REQUIRED', 'Current unchanged read-only evidence required');
  const run = activation.testRun;
  if (!step.tests || !run?.completion)
    throw new TeamError('GRAPH_TESTS_REQUIRED', 'Explicit completed independent tests required');
  const completion = run.completion;
  if (
    completion.error ||
    completion.results.length !== step.tests.length ||
    completion.results.some((r) => r.exitCode !== 0 || r.timedOut || r.truncated)
  )
    throw new TeamError('GRAPH_TESTS_FAILED', 'Independent tests did not pass completely');
  if (run.fingerprint !== fingerprint || completion.fingerprint !== fingerprint)
    throw new TeamError('GRAPH_EVIDENCE_STALE', 'Repository changed since independent tests');
  return activation.assessment.result;
}

export function consumeGraphEvidence(raw: GraphCheckpoint, operationId: string, fingerprint: string): GraphCheckpoint {
  const state = graphCheckpointSchema.parse(raw);
  const activation = state.activations.find((item) => item.operationId === operationId);
  if (!activation) throw new TeamError('GRAPH_OPERATION_NOT_FOUND', 'Unknown graph operation');
  if (activation.consumption) return state;
  if (activation.result || state.status !== 'running')
    throw new TeamError('GRAPH_NOT_RUNNING', 'Pending native activation required');
  const result = assertGraphConsumption(state, operationId, fingerprintSchema.parse(fingerprint));
  activation.consumption = { fingerprint };
  return applyGraphResult(state, operationId, result);
}
