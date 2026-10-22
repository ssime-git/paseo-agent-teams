import { defineRpc } from '@getpaseo/plugin';
import { z } from 'zod';
import { workflowDefinitionSchema } from './workflow-definition';

export const definitionRecordSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    workspaceId: z.string().min(1),
    revision: z.number().int().positive(),
    savedAt: z.iso.datetime(),
    definition: workflowDefinitionSchema,
  })
  .strict();
export type DefinitionRecord = z.infer<typeof definitionRecordSchema>;

// Exports contain only the portable definition. Import creates a new identity;
// replacing an existing definition requires its ID and expected revision.
export const saveDefinitionRpc = defineRpc({
  name: 'teams.save_definition',
  input: z
    .object({
      workspaceId: z.string().min(1),
      id: z.uuid().optional(),
      expectedRevision: z.number().int().nonnegative(),
      definition: workflowDefinitionSchema,
    })
    .strict(),
  output: definitionRecordSchema,
});
export const listDefinitionsRpc = defineRpc({
  name: 'teams.list_definitions',
  input: z.object({ workspaceId: z.string().min(1) }).strict(),
  output: z.array(definitionRecordSchema),
});
export const definitionHistoryRpc = defineRpc({
  name: 'teams.definition_history',
  input: z.object({ workspaceId: z.string().min(1), id: z.uuid() }).strict(),
  output: z.array(definitionRecordSchema),
});
