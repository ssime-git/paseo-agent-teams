import { roleTitle } from '../shared/team-composition';
import type { Translate } from '../shared/i18n';
import {
  clarificationSchema,
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
import { translator } from '../shared/i18n';
const french = translator('fr');

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

export const fieldLabels: Record<string, string> = {
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
export function artifactMarkdown(value: unknown, depth = 2, t: Translate = french): string {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value))
    return value
      .map((item, index) =>
        typeof item === 'object' && item !== null
          ? `${'#'.repeat(Math.min(depth, 6))} ${index + 1}\n\n${artifactMarkdown(item, depth + 1, t)}`
          : `- ${String(item)}`,
      )
      .join('\n\n');
  return Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .map(([key, v]) => {
      if (key === 'summary' && typeof v === 'string') return v;
      if (Array.isArray(v) && !v.length) return `**${fieldLabels[key] ? t(fieldLabels[key]) : key} :** ${t('Aucun.')}`;
      return `${'#'.repeat(Math.min(depth, 6))} ${fieldLabels[key] ? t(fieldLabels[key]) : key}\n\n${artifactMarkdown(v, depth + 1, t)}`;
    })
    .join('\n\n');
}
export function eventMarkdown(rendered: Rendered, t: Translate = french) {
  return rendered.kind === 'markdown'
    ? rendered.text
    : artifactMarkdown(
        rendered.kind === 'plan' ? rendered.plan : rendered.kind === 'build' ? rendered.build : rendered.review,
        2,
        t,
      );
}

/** Agents answer with a JSON artifact; the panel shows it as a card instead of raw JSON. */
export function renderEvent(role: Role | undefined, text: string, t: Translate = french): Rendered {
  try {
    let value: unknown;
    try {
      value = JSON.parse(unfence(text));
    } catch {
      value = role ? parseResult(role, text) : undefined;
    }
    const clarification = role === 'planner' ? clarificationSchema.safeParse(value) : undefined;
    if (clarification?.success)
      return {
        kind: 'markdown',
        text: [
          `## ${t('En attente de réponse')}`,
          clarification.data.summary,
          ...clarification.data.questions.map(
            (q) =>
              `### ${q.title}\n\n${q.options.map((o) => `- **${o.label}${o.id === q.recommendedOptionId && !/\((?:recommandé|recommended)\)/i.test(o.label) ? ` ${t('(recommandé)')}` : ''}** : ${o.tradeoff}`).join('\n')}\n\n${t('Réponse libre possible dans le thread.')}`,
          ),
        ].join('\n\n'),
      };
    const revision =
      role === 'reviewer' ? z.union([planRevisionSchema, nativePlanRevisionSchema]).safeParse(value) : undefined;
    if (revision?.success)
      return {
        kind: 'markdown',
        text:
          revision.data.kind === 'discussion'
            ? revision.data.summary
            : `## ${t('Proposition de plan')}\n\n${revision.data.summary}\n\n${artifactMarkdown(revision.data.plan, 2, t)}`,
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
      return { kind: 'markdown', text: artifactMarkdown(value, 2, t) };
  } catch {
    // Not JSON: plain markdown.
  }
  return { kind: 'markdown', text };
}

export const roleLabel: Record<Role, string> = roleTitle;
