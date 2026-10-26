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
