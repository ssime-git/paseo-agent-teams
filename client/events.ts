import {
  buildSchema,
  planSchema,
  planRevisionSchema,
  nativePlanRevisionSchema,
  reviewSchema,
  type Plan,
  type Role,
} from '../shared/contracts';
import { parseResult } from '../shared/artifacts';
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

const fieldLabels: Record<string, string> = {
  summary: 'Résumé',
  tasks: 'Tâches',
  acceptance: 'Critères d’acceptation',
  tests: 'Commandes de test',
  changes: 'Changements',
  remaining: 'Reste à faire',
  verdict: 'Verdict',
  issues: 'Anomalies',
  nextSteps: 'Prochaines étapes',
  command: 'Commande',
  timeoutMs: 'Délai maximal (ms)',
  title: 'Titre',
  description: 'Description',
  status: 'État',
  severity: 'Gravité',
  file: 'Fichier',
  line: 'Ligne',
};
/** Presentation only: tolerate additional/nested fields without weakening engine validation. */
export function artifactMarkdown(value: unknown, depth = 2): string {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value))
    return value
      .map((item, index) =>
        typeof item === 'object' && item !== null
          ? `${'#'.repeat(Math.min(depth, 6))} ${index + 1}\n\n${artifactMarkdown(item, depth + 1)}`
          : `- ${String(item)}`,
      )
      .join('\n\n');
  return Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .map(([key, v]) => {
      if (key === 'summary' && typeof v === 'string') return v;
      if (Array.isArray(v) && !v.length) return `**${fieldLabels[key] ?? key} :** Aucun.`;
      return `${'#'.repeat(Math.min(depth, 6))} ${fieldLabels[key] ?? key}\n\n${artifactMarkdown(v, depth + 1)}`;
    })
    .join('\n\n');
}
export function eventMarkdown(rendered: Rendered) {
  return rendered.kind === 'markdown'
    ? rendered.text
    : artifactMarkdown(
        rendered.kind === 'plan' ? rendered.plan : rendered.kind === 'build' ? rendered.build : rendered.review,
      );
}

/** Agents answer with a JSON artifact; the panel shows it as a card instead of raw JSON. */
export function renderEvent(role: Role | undefined, text: string): Rendered {
  try {
    let value: unknown;
    try {
      value = JSON.parse(unfence(text));
    } catch {
      value = role ? parseResult(role, text) : undefined;
    }
    const revision =
      role === 'reviewer' ? z.union([planRevisionSchema, nativePlanRevisionSchema]).safeParse(value) : undefined;
    if (revision?.success)
      return {
        kind: 'markdown',
        text:
          revision.data.kind === 'discussion'
            ? revision.data.summary
            : `## Proposition de plan\n\n${revision.data.summary}\n\n${artifactMarkdown(revision.data.plan)}`,
      };
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
    if (value && typeof value === 'object' && ('summary' in value || 'verdict' in value))
      return { kind: 'markdown', text: artifactMarkdown(value) };
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
