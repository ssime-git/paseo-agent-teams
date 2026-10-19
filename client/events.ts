import { buildSchema, planSchema, reviewSchema, type Plan, type Role } from '../shared/contracts';
import { z } from 'zod';

export type Rendered =
  | { kind: 'plan'; plan: Plan }
  | { kind: 'build'; build: z.infer<typeof buildSchema> }
  | { kind: 'review'; review: z.infer<typeof reviewSchema> }
  | { kind: 'markdown'; text: string };

const unfence = (text: string) =>
  text
    .trim()
    .replace(/^(?:---[ \t]*\r?\n\s*)+/, '')
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```$/, '');

/** Agents answer with a JSON artifact; the panel shows it as a card instead of raw JSON. */
export function renderEvent(role: Role | undefined, text: string): Rendered {
  try {
    const value: unknown = JSON.parse(unfence(text));
    const schema =
      role === 'planner'
        ? planSchema
        : role === 'builder'
          ? buildSchema
          : role === 'reviewer'
            ? reviewSchema
            : undefined;
    const parsed = schema?.safeParse(value);
    if (parsed?.success) {
      if (role === 'planner') return { kind: 'plan', plan: parsed.data as Plan };
      if (role === 'builder') return { kind: 'build', build: parsed.data as z.infer<typeof buildSchema> };
      return { kind: 'review', review: parsed.data as z.infer<typeof reviewSchema> };
    }
  } catch {
    // Not JSON: plain markdown.
  }
  return { kind: 'markdown', text };
}

export const roleLabel: Record<Role, string> = { planner: 'Planner', builder: 'Builder', reviewer: 'Reviewer' };
export const phaseRole = {
  planning: 'planner',
  building: 'builder',
  testing: undefined,
  reviewing: 'reviewer',
} as const;
export const steps = [
  { phase: 'planning', label: 'Plan', role: 'planner' },
  { phase: 'building', label: 'Build', role: 'builder' },
  { phase: 'testing', label: 'Tests', role: undefined },
  { phase: 'reviewing', label: 'Review', role: 'reviewer' },
] as const;
