import { defineRpc } from '@getpaseo/plugin';
import { z } from 'zod';
import { clarificationAnswerSchema, workflowSchema } from './contracts';

const scope = z
  .object({ id: z.string().min(1), workspaceId: z.string().min(1), ownerAgentId: z.string().min(1) })
  .strict();
export const plannerQuestionReadRpc = defineRpc({
  name: 'teams.planner_question',
  input: scope,
  output: workflowSchema,
});
export const plannerQuestionAnswerRpc = defineRpc({
  name: 'teams.planner_answer',
  input: scope
    .extend({
      expectedRevision: z.number().int().nonnegative(),
      clarificationId: z.string().min(1),
      answer: clarificationAnswerSchema,
    })
    .strict(),
  output: workflowSchema,
});
