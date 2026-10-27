import { defineRpc } from '@getpaseo/plugin';
import { z } from 'zod';
import { clarificationAnswerSchema } from './contracts';
import { graphCheckpointSchema, graphHumanDecisionSchema } from './graph-checkpoint';

const scope = z.object({ id: z.uuid(), workspaceId: z.string().min(1) }).strict();
const reason = z.object({ id: z.uuid(), summary: z.string().trim().min(1).max(4000) }).strict();

// Explicit client submissions only. These RPCs are not registered as model tools
// and never advance, dispatch, execute tests or answer native permissions.
export const graphActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('decide'), decision: graphHumanDecisionSchema }).strict(),
  z.object({ action: z.literal('answer'), answer: clarificationAnswerSchema }).strict(),
  z.object({ action: z.literal('reject_tests'), decision: reason }).strict(),
  z.object({ action: z.literal('accept_no_tests'), decision: reason }).strict(),
]);
export const graphRecordRpc = defineRpc({
  name: 'teams.graph_record',
  input: scope,
  output: graphCheckpointSchema,
});
// Recover admitted runs after a client reconnects without retaining their IDs.
export const graphListRpc = defineRpc({
  name: 'teams.graph_list',
  input: z.object({ workspaceId: z.string().min(1), ownerAgentId: z.string().min(1) }).strict(),
  output: z.array(graphCheckpointSchema),
});
export const graphActionRpc = defineRpc({
  name: 'teams.graph_action',
  input: scope
    .extend({
      expectedRevision: z.number().int().positive(),
      operationId: z.uuid(),
      submission: graphActionSchema,
    })
    .strict(),
  output: graphCheckpointSchema,
});

// Admission freezes this exact saved revision, including commands, modes and limits.
// A true confirmation is mandatory; it is never inferred from a model or timeout.
export const graphAdmitRpc = defineRpc({
  name: 'teams.graph_admit',
  input: z
    .object({
      id: z.uuid(),
      workspaceId: z.string().min(1),
      ownerAgentId: z.string().min(1),
      definitionId: z.uuid(),
      definitionRevision: z.number().int().positive(),
      task: z.string().trim().min(1).max(16000),
      approveDefinition: z.literal(true),
    })
    .strict(),
  output: graphCheckpointSchema,
});

// Explicit continuation, separate from human decisions. One durable boundary only.
export const graphAdvanceRpc = defineRpc({
  name: 'teams.graph_advance',
  input: scope.extend({ ownerAgentId: z.string().min(1), expectedRevision: z.number().int().positive() }).strict(),
  output: z
    .object({
      status: z.enum(['progressed', 'waiting', 'blocked', 'terminal', 'stale']),
      reason: z.string(),
      state: graphCheckpointSchema,
    })
    .strict(),
});

// Native-thread response: bind the displayed graph to its actual Team conversation.
export const graphResponseRpc = defineRpc({
  name: 'teams.graph_response',
  input: graphActionRpc.input.extend({ ownerAgentId: z.string().min(1) }).strict(),
  output: graphCheckpointSchema,
});
