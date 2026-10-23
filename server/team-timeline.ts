import type { ProviderTimelineItem } from '@getpaseo/plugin/server/provider';
import { parseResult } from './result-parser';
import type { Role, Workflow } from '../shared/contracts';
import { roleTitle } from '../shared/team-composition';
import type { Translate } from '../shared/i18n';

/** One action of a role session, rendered by Paseo as a `[Tool] summary` line of a sub-agent. */
export interface RoleAction {
  toolName: string;
  summary?: string;
}
export interface TeamTimelineContext {
  /** Human label of the model selected for a role, e.g. `Claude Code · Opus 5.5`. */
  label(role: Role): string;
  /** Recent actions of the role session that handled an operation, when known. */
  activity(operationId: string): RoleAction[] | undefined;
  /** Translation into the language chosen in the Agent Teams settings. */
  t: Translate;
}
const MAX_ACTIONS = 40;

function result(role: Role, text: string) {
  try {
    return parseResult(role, text);
  } catch {
    return undefined;
  }
}
const list = (items: string[]) => items.map((item) => `- ${item}`).join('\n');
const shorten = (text: string, max = 160) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** Engine correction events are recorded in French; the thread shows them in the chosen language. */
export function correctionText(t: Translate, text: string) {
  const cycle = /^Correction (\d+)\/(\d+) : (review refusée|tests non validés)/.exec(text);
  if (cycle)
    return t('Correction {cycle}/{max} : {reason}. Retour au Code.', {
      cycle: cycle[1],
      max: cycle[2],
      reason: t(cycle[3]),
    });
  const minor = /^Revue validée avec (\d+) point/.exec(text);
  if (minor) return t('Revue validée avec {count} point(s) non bloquant(s) : le Code les traite.', { count: minor[1] });
  if (text.startsWith('Blocage persistant'))
    return t('Blocage persistant : retour au Plan pour diagnostiquer, puis poursuivre.');
  return text;
}

function describe(w: Workflow, index: number, role: Role, t: Translate) {
  const previous = w.events
    .slice(0, index)
    .reverse()
    .find((e) => ['correction', 'goal_replan', 'dispatch', 'user', 'followup'].includes(e.kind));
  if (previous?.kind === 'correction' && role === 'builder') return shorten(correctionText(t, previous.text), 120);
  if (previous?.kind === 'goal_replan') return t('Diagnostiquer le blocage et ajuster le plan');
  if (previous?.kind === 'user') return t('Répondre : {message}', { message: shorten(previous.text, 100) });
  return role === 'planner'
    ? t('Planifier la mission')
    : role === 'builder'
      ? t('Implémenter le plan')
      : t('Relire les changements');
}

/** The role's structured answer as readable text inside its expanded sub-agent row. */
function conclusion(role: Role, text: string, t: Translate) {
  const parsed = result(role, text);
  if (!parsed) return shorten(text, 600);
  if ('kind' in parsed && parsed.kind === 'clarification')
    return `${parsed.summary}\n${list(parsed.questions.map((q) => q.title))}`;
  if (role === 'planner' && 'tasks' in parsed) return parsed.summary;
  if (role === 'builder' && 'changes' in parsed)
    return [parsed.summary, parsed.changes.length ? list(parsed.changes) : ''].filter(Boolean).join('\n');
  if (role === 'reviewer' && 'verdict' in parsed)
    return [
      parsed.verdict === 'pass' ? t('Approuvé.') : t('Changements demandés.'),
      parsed.summary,
      list(parsed.issues),
    ]
      .filter(Boolean)
      .join('\n');
  return 'summary' in parsed ? String(parsed.summary) : shorten(text, 600);
}

function subAgent(
  id: string,
  role: Role,
  description: string,
  ctx: TeamTimelineContext,
  status: 'running' | 'completed' | 'failed',
  outcome = '',
): ProviderTimelineItem {
  const actions = (ctx.activity(id) ?? []).slice(-MAX_ACTIONS);
  const log = [...actions.map((a) => `[${a.toolName}]${a.summary ? ` ${a.summary}` : ''}`), outcome]
    .filter(Boolean)
    .join('\n');
  const base = {
    id: `team:agent:${id}`,
    type: 'tool_call' as const,
    callId: `team-agent-${id}`,
    name: 'Agent',
    detail: {
      type: 'sub_agent' as const,
      subAgentType: `${ctx.t(roleTitle[role])} · ${ctx.label(role)}`,
      description,
      log,
      actions: actions.map((a, i) => ({
        index: i + 1,
        toolName: a.toolName,
        ...(a.summary ? { summary: a.summary } : {}),
      })),
    },
  };
  return status === 'failed' ? { ...base, status, error: { message: outcome } } : { ...base, status, error: null };
}

const say = (id: string, text: string): ProviderTimelineItem => ({
  id: `team:say:${id}`,
  type: 'assistant_message',
  messageId: `team-say-${id}`,
  text,
});

function reviewNarration(text: string, t: Translate) {
  const parsed = result('reviewer', text);
  return parsed && 'verdict' in parsed && parsed.verdict === 'fail'
    ? `${t('La relecture demande des changements :')}\n${list(parsed.issues)}`
    : undefined;
}

/**
 * Projects a workflow into native Paseo timeline items for the Team Auto thread:
 * the orchestrator speaks in assistant messages, each role turn is a sub-agent tool call,
 * the plan is a native todo list and verification runs are shell calls.
 * Ids are deterministic so the provider can emit only what changed.
 */
export function projectTeamTimeline(w: Workflow, ctx: TeamTimelineContext): Anchored[] {
  const anchored: Anchored[] = [];
  let at = 0;
  const items = { push: (item: ProviderTimelineItem) => anchored.push({ item, at }) };
  const done = new Set(w.events.filter((e) => e.kind === 'assistant' && e.operationId).map((e) => e.operationId!));
  const tests = new Set(w.events.filter((e) => e.kind === 'tests' && e.operationId).map((e) => e.operationId!));
  const descriptions = new Map<string, string>();
  const lastTests = w.events.findLast((e) => e.kind === 'tests');
  w.events.forEach((event, index) => {
    at = index + 1;
    const role = event.role;
    switch (event.kind) {
      case 'dispatch': {
        if (!role || !event.operationId) return;
        const description = describe(w, index, role, ctx.t);
        descriptions.set(event.operationId, description);
        if (done.has(event.operationId)) return; // The result event completes this row in place.
        const live = w.operation?.id === event.operationId && w.status !== 'attention';
        items.push(
          live
            ? subAgent(event.operationId, role, description, ctx, 'running')
            : subAgent(event.operationId, role, description, ctx, 'failed', w.error ?? ctx.t('Tour interrompu.')),
        );
        return;
      }
      case 'assistant': {
        if (!role) return;
        // Missions recorded before operation links still show each role result as a finished row.
        const operationId = event.operationId ?? `event-${event.id}`;
        items.push(
          subAgent(
            operationId,
            role,
            descriptions.get(operationId) ?? describe(w, index, role, ctx.t),
            ctx,
            'completed',
            conclusion(role, event.text, ctx.t),
          ),
        );
        const parsed = role === 'planner' ? result(role, event.text) : undefined;
        if (parsed && 'tasks' in parsed) {
          // The plan's tasks are done once a Builder result follows it, before any newer plan.
          const later = w.events.slice(index + 1);
          const replanned = later.findIndex((e) => e.kind === 'assistant' && e.role === 'planner');
          const built = later
            .slice(0, replanned < 0 ? undefined : replanned)
            .some((e) => e.kind === 'assistant' && e.role === 'builder');
          items.push({
            id: `team:plan:${event.id}`,
            type: 'todo',
            items: parsed.tasks.map((text, i) => ({ id: String(i + 1), text, completed: built })),
          });
        }
        const narration = role === 'reviewer' ? reviewNarration(event.text, ctx.t) : undefined;
        if (narration) items.push(say(event.id, narration));
        return;
      }
      case 'tests': {
        const results = event === lastTests ? w.tests : [];
        const failed = results.some((r) => r.exitCode !== 0 || r.timedOut) || /→ (?!0$)/m.test(event.text);
        items.push({
          id: `team:tests:${event.operationId ?? event.id}`,
          type: 'tool_call',
          callId: `team-tests-${event.operationId ?? event.id}`,
          name: 'Shell',
          status: 'completed',
          error: null,
          detail: {
            type: 'shell',
            command: (results.length
              ? results.map((r) => r.command)
              : event.text.split('\n').map((l) => l.replace(/ → .*$/, ''))
            ).join(' && '),
            cwd: w.cwd,
            output: results.length
              ? results
                  .map((r) =>
                    [`$ ${r.command}`, r.stdout.slice(-4000), r.stderr.slice(-2000)].filter(Boolean).join('\n'),
                  )
                  .join('\n\n')
              : event.text,
            exitCode: failed ? (results.find((r) => r.exitCode !== 0)?.exitCode ?? 1) : 0,
          },
        });
        return;
      }
      case 'correction':
      case 'goal_replan':
        items.push(say(event.id, correctionText(ctx.t, event.text)));
        return;
      case 'plan_approved': {
        const version = /Plan v(\d+)/.exec(event.text)?.[1];
        items.push(
          say(
            event.id,
            version && version !== '1'
              ? ctx.t('Plan v{version} validé. {builder} implémente.', { version, builder: ctx.label('builder') })
              : ctx.t('Plan validé. {builder} implémente.', { builder: ctx.label('builder') }),
          ),
        );
        return;
      }
      case 'intervention':
        items.push(
          say(
            event.id,
            ctx.t(
              'Le plan ne prévoit aucune commande de test. Envoyez `/team-approve-no-tests` pour l’accepter explicitement, ou demandez des tests.',
            ),
          ),
        );
        return;
      case 'error':
      case 'invalid':
      case 'timeout':
        items.push(say(event.id, `⚠️ ${event.text}`));
        return;
      case 'paused':
        items.push(say(event.id, ctx.t('Équipe en pause. Envoyez `/team-resume` pour reprendre.')));
        return;
    }
  });
  at = w.events.length;
  if (w.operation?.phase === 'testing' && !tests.has(w.operation.id) && w.plan?.tests.length)
    items.push({
      id: `team:tests:${w.operation.id}`,
      type: 'tool_call',
      callId: `team-tests-${w.operation.id}`,
      name: 'Shell',
      status: 'running',
      error: null,
      detail: { type: 'shell', command: w.plan.tests.map((t) => t.command).join(' && '), cwd: w.cwd },
    });
  return anchored;
}

/**
 * What the orchestrator says about the current state: a plan or result awaiting approval,
 * open questions, a pending permission or the mission summary. These depend on the moment they
 * were observed, so the provider records them once in its transcript instead of re-deriving them.
 */
export function stateNarrations(w: Workflow, ctx: TeamTimelineContext): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const last = w.events.findLast((e) => e.kind === 'assistant');
  const pending = w.clarifications?.find((q) => !q.resolvedAt);
  if (pending) {
    const open = pending.request.questions.filter((q) => !pending.answers.some((a) => a.questionId === q.id));
    out.push({
      id: `clarify:${pending.id}`,
      text: [
        pending.request.summary,
        '',
        ...open.map(
          (q, i) =>
            `${open.length > 1 ? `${i + 1}. ` : ''}**${q.title}** — ${q.options.map((o) => o.label).join(' · ')}`,
        ),
        '',
        open.length > 1
          ? ctx.t('Répondez ici, une réponse par ligne : `1. …`, `2. …`.')
          : ctx.t('Répondez directement ici.'),
      ].join('\n'),
    });
  } else if (w.status === 'awaiting_plan' && w.plan) {
    const tests = w.plan.tests.length
      ? w.plan.tests.map((t) => `\`${t.command}\``).join(', ')
      : ctx.t('aucune commande');
    const steps = w.plan.tasks.length;
    out.push({
      id: `plan:${last?.id ?? w.revision}`,
      text: ctx.t(
        steps > 1
          ? 'Le plan est prêt ({steps} étapes, tests : {tests}). Répondez **go** pour lancer {builder}, ou décrivez ce qu’il faut changer.'
          : 'Le plan est prêt (1 étape, tests : {tests}). Répondez **go** pour lancer {builder}, ou décrivez ce qu’il faut changer.',
        { steps, tests, builder: ctx.label('builder') },
      ),
    });
  }
  if (w.status === 'permission' && w.operation)
    out.push({
      id: `permission:${w.operation.id}`,
      text: ctx.t(
        'Le rôle {role} attend une autorisation. Ouvrez-le depuis la liste des sous-agents, au-dessus du message.',
        { role: ctx.t(roleTitle[w.operation.role]) },
      ),
    });
  if (w.status === 'awaiting_final')
    out.push({
      id: `final:${last?.id ?? w.revision}`,
      text: ctx.t(
        'Le résultat attend votre accord. Répondez **go** pour le valider, ou décrivez ce qu’il faut reprendre.',
      ),
    });
  if (w.status === 'completed' && w.build) {
    const passed = w.tests.filter((t) => t.exitCode === 0 && !t.timedOut).length;
    out.push({
      id: `done:${w.id}:${last?.id ?? w.cycle}`,
      text: [
        `### ${ctx.t('Mission terminée')}`,
        w.build.summary,
        w.build.changes.length ? `\n${list(w.build.changes)}` : '',
        w.review ? `\n${ctx.t('Relecture : {summary}', { summary: w.review.summary })}` : '',
        w.tests.length ? ctx.t('Tests : {passed}/{total} réussis.', { passed, total: w.tests.length }) : '',
        w.cycle ? ctx.t('Corrections : {count}.', { count: w.cycle }) : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }
  return out;
}

/** A native message the provider showed once, anchored after the first `at` workflow events. */
export interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
}
export interface Anchored {
  item: ProviderTimelineItem;
  at: number;
}
export const transcriptItem = (entry: TranscriptEntry): ProviderTimelineItem =>
  entry.role === 'user'
    ? { id: `team:user:${entry.id}`, type: 'user_message', text: entry.text, clientMessageId: entry.id }
    : say(entry.id, entry.text);

/** The complete Team thread in order, as replayed after a restart and diffed while live. */
export function teamThread(w: Workflow, ctx: TeamTimelineContext, transcript: TranscriptEntry[]) {
  const entries = [...transcript];
  // Missions created before the transcript existed still replay their initial request.
  if (!entries.some((e) => e.role === 'user' && e.at === 0))
    entries.unshift({ id: `task:${w.id}`, role: 'user', text: w.task, at: 0 });
  const rows = [
    ...projectTeamTimeline(w, ctx).map((a, order) => ({ ...a, order, extra: 0 })),
    ...entries.map((e, order) => ({ item: transcriptItem(e), at: e.at, order, extra: 1 })),
  ];
  rows.sort((a, b) => a.at - b.at || a.extra - b.extra || a.order - b.order);
  return rows.map((r) => r.item);
}
