import { z } from 'zod';
import {
  negotiateProviderCapabilities,
  type ProviderRegistration,
  type ProviderEvent,
  type ProviderInput,
  type ProviderConfigState,
} from '@getpaseo/plugin/server/provider';
import { configSchema, roles, type Action, type Config, type Role, type Workflow } from '../shared/contracts';
import {
  stateNarrations,
  statusReport,
  teamThread,
  transcriptItem,
  type RoleAction,
  type TranscriptEntry,
} from './team-timeline';
import { roleTitle, TEAM_PROVIDER_ID, type TeamProviderChoice } from '../shared/team-composition';
import { translator, type Language, type Translate } from '../shared/i18n';
import { graphAdvanceRpc } from '../shared/graph-actions';
import type { GraphCheckpoint } from '../shared/graph-checkpoint';
import { graphStatusReport } from './graph-status';
import { readOnlyMode } from '../shared/provider-selection';

export interface TeamProviderBackend {
  /** Validation mode preselected for new conversations, from the default team settings. */
  defaultMode?(): Promise<'plan' | 'final' | 'autonomous'>;
  /** Language of the thread messages, from the Agent Teams settings. */
  language?(): Promise<Language>;
  open(
    cwd: string,
    workspaceId: string,
  ): Promise<{ workspaceId: string; choices: TeamProviderChoice[]; config: Config }>;
  ownerWorkspace(agentId: string, cwd: string): Promise<string>;
  advanceGraph?(input: z.infer<typeof graphAdvanceRpc.input>): Promise<z.infer<typeof graphAdvanceRpc.output>>;
  watchGraphs?(listener: (state: GraphCheckpoint) => void): () => void;
  graphs?(workspaceId: string, ownerAgentId: string): Promise<GraphCheckpoint[]>;
  list(workspaceId: string): Promise<Workflow[]>;
  get(id: string, workspaceId: string): Promise<Workflow>;
  create(workspaceId: string, task: string, config: Config, requestId: string, ownerAgentId: string): Promise<Workflow>;
  action(input: Action): Promise<Workflow>;
  /** Actions of the role session for one operation, shown inside its sub-agent row. */
  activity?(w: Workflow, role: Role, operationId: string): Promise<RoleAction[]>;
}
const savedSchema = z
  .object({
    key: z.uuid(),
    workspaceId: z.string().min(1),
    config: configSchema,
    workflowId: z.string().optional(),
    // Messages shown once in the native thread, so a restart replays the same conversation.
    transcript: z
      .array(
        z
          .object({
            id: z.string(),
            role: z.enum(['user', 'assistant']),
            graphWorkspaceId: z.string().min(1).optional(),
            graphId: z.uuid().optional(),
            plannerQuestion: z
              .object({ id: z.string(), workspaceId: z.string(), clarificationId: z.string() })
              .optional(),
            text: z.string(),
            at: z.number().int().min(0),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
type Saved = z.infer<typeof savedSchema>;
export const models = [
  {
    id: 'auto',
    label: 'Team Auto',
    description: 'Planifier, développer, tester et relire avec des modèles complémentaires.',
  },
];
export const modes = [
  { id: 'plan', label: 'Valider le plan' },
  { id: 'final', label: 'Valider le résultat' },
  { id: 'autonomous', label: 'Validation autonome' },
];
export const commands = [
  { name: 'team-status', description: 'Afficher l’état de l’équipe' },
  { name: 'team-pause', description: 'Mettre l’équipe en pause' },
  { name: 'team-resume', description: 'Reprendre le workflow enregistré' },
  { name: 'team-approve', description: 'Approuver le plan ou le résultat en attente' },
  { name: 'team-approve-no-tests', description: 'Approuver explicitement sans commande de test' },
  { name: 'team-graphs', description: 'Afficher les graphes de cette conversation' },
  { name: 'team-advance', description: 'Continuer un graphe : UUID révision attendue' },
];
const ACTIVITY_BACKFILL = 8;
const TRANSCRIPT_LIMIT = 300;
const finished = (json: string) => {
  const item = JSON.parse(json) as { type: string; status?: string };
  return item.type === 'tool_call' && item.status !== 'running';
};
function record(saved: Saved, ...entries: TranscriptEntry[]) {
  saved.transcript = [
    ...(saved.transcript ?? []),
    ...entries.map((e) => ({ ...e, text: e.text.slice(0, 8000) })),
  ].slice(-TRANSCRIPT_LIMIT);
}
const approval = /^\s*(go|ok|okay|oui|yes|valide|validé|approve|approuvé|lgtm|vas-y|c'est bon|c’est bon)\s*[.!]*\s*$/i;

/** A native model selection backed by the existing V1 engine, never another orchestrator. */
export function createTeamProvider(backend: TeamProviderBackend): ProviderRegistration {
  return {
    id: TEAM_PROVIDER_ID,
    label: 'Agent Teams',
    description: 'Plan · Code · Revue / Review',
    async connect(request) {
      const tr = async () => translator((await backend.language?.()) ?? 'fr');
      if (!request.versions.includes(1)) throw new Error('Unsupported provider protocol');
      const capabilities = negotiateProviderCapabilities(request.capabilities, [
        'prompt.message',
        'prompt.command',
        'session.persistence',
        'session.configure',
        'timeline.plugin',
      ]);
      const listeners = new Set<(event: ProviderEvent) => void>();
      const sessions = new Map<
        string,
        {
          saved: Saved;
          agentId: string;
          cwd: string;
          choices: TeamProviderChoice[];
          turn?: string;
          revision?: number;
          graphsDirty?: boolean;
          emitted: Map<string, string>;
          activity: Map<string, RoleAction[]>;
          accepted: Set<string>;
        }
      >();
      const queues = new Map<string, Promise<void>>();
      let closed = false,
        polling = false;
      const emit = (event: ProviderEvent) => {
        if (!closed) for (const listener of listeners) listener(event);
      };
      const persist = (sessionId: string, saved: Saved) =>
        emit({
          type: 'session.persistence',
          sessionId,
          persistence: { version: 1, data: JSON.parse(JSON.stringify(saved)) },
        });
      const settings = (sessionId: string, t: Translate) => {
        const session = sessions.get(sessionId)!;
        const state: ProviderConfigState = {
          model: 'auto',
          mode: session.saved.config.validation,
          models: models.map((m) => ({ ...m, description: t(m.description) })),
          modes: modes.map((m) => ({ ...m, label: t(m.label) })),
          thinkingOptions: [],
          settings: roles.map((role) => ({
            type: 'select',
            id: role,
            label: t(roleTitle[role]),
            value: session.saved.config.roles[role].provider,
            options: session.choices
              .filter((p) => p.modes.some((m) => role === 'builder' || readOnlyMode(p.family, m.id)))
              .flatMap((p) =>
                p.models.map((m) => ({ label: `${p.label ?? p.id} · ${m.label ?? m.id}`, value: `${p.id}/${m.id}` })),
              ),
          })),
        };
        emit({ type: 'session.config', sessionId, config: state });
      };
      const label = (sessionId: string, w: Workflow) => (role: Role) => {
        const selection = w.config.roles[role].provider;
        const [harness, ...rest] = selection.split('/');
        const model = rest.join('/');
        const choice = sessions.get(sessionId)?.choices.find((p) => p.id === harness);
        return `${choice?.label ?? harness} · ${choice?.models.find((m) => m.id === model)?.label ?? model}`;
      };
      const refreshActivity = async (sessionId: string, w: Workflow) => {
        const session = sessions.get(sessionId)!;
        if (!backend.activity) return;
        const pending = w.events
          .filter((e) => e.kind === 'assistant' && e.role && e.operationId && !session.activity.has(e.operationId))
          .slice(-ACTIVITY_BACKFILL);
        // Older finished turns stay without actions rather than fetching a whole history on reopen.
        for (const e of w.events)
          if (e.kind === 'assistant' && e.operationId && !pending.includes(e) && !session.activity.has(e.operationId))
            session.activity.set(e.operationId, []);
        const jobs = pending.map((e) => ({ id: e.operationId!, role: e.role! }));
        for (const job of jobs) {
          try {
            session.activity.set(job.id, await backend.activity(w, job.role, job.id));
          } catch {
            /* The role session may be gone; its row keeps the structured result. */
          }
        }
      };
      const removeGraphWatch = backend.watchGraphs?.((state) => {
        for (const session of sessions.values())
          if (state.admission?.ownerAgentId === session.agentId) session.graphsDirty = true;
      });
      const project = async (sessionId: string) => {
        const session = sessions.get(sessionId);
        if (!session) return;
        if (session.graphsDirty && backend.graphs) {
          // Clear before awaiting: a concurrent publication must keep the next refresh dirty.
          session.graphsDirty = false;
          try {
            const workspaceId = await backend.ownerWorkspace(session.agentId, session.cwd);
            if (session.saved.workflowId && workspaceId !== session.saved.workspaceId)
              throw new Error('Team workspace changed');
            const states = await backend.graphs(workspaceId, session.agentId);
            const t = await tr();
            if (closed || sessions.get(sessionId) !== session) return;
            const fresh = states.flatMap((state) => {
              const active = state.activations.at(-1);
              const pending =
                active?.assessment?.status === 'clarification' &&
                active.assessment.request.questions.some(
                  (q) => !active.clarificationAnswers?.some((a) => a.questionId === q.id),
                );
              if (!active || (state.status !== 'waiting_human' && !pending)) return [];
              const id = `graph-wait:${state.id}:${active.operationId}`;
              if (session.saved.transcript?.some((entry) => entry.id === id)) return [];
              return [
                {
                  id,
                  role: 'assistant' as const,
                  text: `${t('En attente de réponse')}\n\n${state.source.definition.name}\n\n${state.task}`,
                  at: 0,
                  graphWorkspaceId: workspaceId,
                  graphId: state.id,
                },
              ];
            });
            if (fresh.length) {
              session.saved.workspaceId = workspaceId;
              if (session.saved.workflowId) {
                const w = await backend.get(session.saved.workflowId, workspaceId);
                for (const entry of fresh) entry.at = w.events.length;
              }
              record(session.saved, ...fresh);
              persist(sessionId, session.saved);
            }
          } catch {
            // Native placement may not exist until session.open has completed.
            // Retry only metadata discovery; never run or approve the workflow.
            session.graphsDirty = true;
          }
        }
        const transcript = () =>
          (session.saved.transcript ?? []).map((entry) =>
            capabilities.includes('timeline.plugin')
              ? entry
              : { ...entry, graphWorkspaceId: undefined, plannerQuestion: undefined },
          );
        if (!session.saved.workflowId) {
          for (const entry of transcript()) {
            const item = transcriptItem(entry);
            if (session.emitted.has(item.id)) continue;
            session.emitted.set(item.id, JSON.stringify(item));
            emit({ type: 'timeline.item', sessionId, item });
          }
          return;
        }
        const w = await backend.get(session.saved.workflowId, session.saved.workspaceId);
        if (closed || sessions.get(sessionId) !== session) return;
        await refreshActivity(sessionId, w);
        if (closed || sessions.get(sessionId) !== session) return;
        const ctx = { label: label(sessionId, w), activity: (id: string) => session.activity.get(id), t: await tr() };
        const pendingQuestion = w.clarifications?.find((q) => !q.resolvedAt);
        const legacyQuestion =
          pendingQuestion &&
          session.saved.transcript?.find(
            (entry) => entry.id === `clarify:${pendingQuestion.id}` && !entry.plannerQuestion,
          );
        if (legacyQuestion) {
          legacyQuestion.plannerQuestion = {
            id: w.id,
            workspaceId: w.workspaceId,
            clarificationId: pendingQuestion.id,
          };
          persist(sessionId, session.saved);
        }
        const fresh = stateNarrations(w, ctx).filter((n) => !session.saved.transcript?.some((e) => e.id === n.id));
        if (fresh.length) {
          record(
            session.saved,
            ...fresh.map((n) => ({
              ...n,
              role: 'assistant' as const,
              at: w.events.length,
              ...(n.id.startsWith('clarify:')
                ? {
                    plannerQuestion: {
                      id: w.id,
                      workspaceId: w.workspaceId,
                      clarificationId: n.id.slice('clarify:'.length),
                    },
                  }
                : {}),
            })),
          );
          persist(sessionId, session.saved);
        }
        for (const item of teamThread(w, ctx, transcript())) {
          // Native tool rows merge only within their originating turn. Publish
          // finished rows once; live progress is available in the Team pill and
          // the role's native session without holding the owner turn open.
          if (item.type === 'tool_call' && item.status === 'running') continue;
          const json = JSON.stringify(item);
          const previous = session.emitted.get(item.id);
          // Narrations and finished tool calls are immutable: Paseo only merges a tool call within the native
          // turn that started it, so re-emitting one later (e.g. after a language change) would duplicate the row.
          // Running rows and todos are updated in place; a restart replays everything in the current language.
          if (previous === json || (previous && (item.type === 'assistant_message' || finished(previous)))) continue;
          session.emitted.set(item.id, json);
          emit({ type: 'timeline.item', sessionId, item });
        }
        if (session.turn) {
          emit({ type: 'session.turn', sessionId, turnId: session.turn, state: 'completed' });
          session.turn = undefined;
        }
      };
      const serialize = (sessionId: string, fn: () => Promise<void>) => {
        const next = (queues.get(sessionId) ?? Promise.resolve()).then(fn);
        queues.set(
          sessionId,
          next.catch(() => {}),
        );
        return next;
      };
      const timer = setInterval(() => {
        if (closed || polling) return;
        polling = true;
        void Promise.all(
          [...sessions.keys()].map((sessionId) =>
            serialize(sessionId, () => project(sessionId)).catch((e) => {
              const session = sessions.get(sessionId);
              if (session?.turn) {
                emit({
                  type: 'session.turn',
                  sessionId,
                  turnId: session.turn,
                  state: 'failed',
                  error: { message: String(e) },
                });
                session.turn = undefined;
              }
            }),
          ),
        ).finally(() => {
          polling = false;
        });
      }, 1500);
      const handle = async (input: ProviderInput) => {
        const t = await tr();
        if (closed) throw new Error('Provider connection closed');
        if (input.type === 'catalog') {
          emit({
            type: 'catalog',
            requestId: input.requestId,
            catalog: {
              models: models.map((m) => ({ ...m, description: t(m.description) })),
              modes: modes.map((m) => ({ ...m, label: t(m.label) })),
              defaultModel: 'auto',
              defaultMode: (await backend.defaultMode?.()) ?? 'plan',
            },
          });
          return;
        }
        if (input.type === 'session.open') {
          if (sessions.has(input.sessionId)) throw new Error('Team session already open');
          if (input.config.model && input.config.model !== 'auto') throw new Error('Unknown Team model');
          // Never silently discard user restrictions or context that the V1 engine cannot propagate.
          if (
            input.config.systemPrompt ||
            input.config.toolPolicy ||
            Object.keys(input.config.mcpServers).length ||
            Object.keys(input.config.providerOptions ?? {}).length
          )
            throw new Error(
              'Team Auto does not yet support custom system prompts, MCP servers, tool policies or provider options. Configure the native roles in Team.',
            );
          if (!input.persistence && Object.keys(input.config.settings).length)
            throw new Error('Configure Team roles after opening the session.');
          const workspaceId = input.persistence
            ? await backend.ownerWorkspace(
                z.string().min(1).parse(input.config.env.PASEO_AGENT_TEAMS_AGENT_ID),
                input.config.cwd,
              )
            : z.string().min(1).parse(input.config.env.PASEO_AGENT_TEAMS_WORKSPACE_ID);
          const opened = await backend.open(input.config.cwd, workspaceId);
          let saved: Saved;
          if (input.persistence) {
            if (input.persistence.version !== 1) throw new Error('Unsupported Team persistence');
            saved = savedSchema.parse(input.persistence.data);
            if (saved.workspaceId !== opened.workspaceId)
              throw new Error(
                `Team workspace mismatch: saved ${saved.workspaceId}, native ${opened.workspaceId}, agent ${input.config.env.PASEO_AGENT_TEAMS_AGENT_ID}`,
              );
          } else {
            saved = {
              key: z.uuid().parse(input.config.env.PASEO_AGENT_TEAMS_AGENT_ID),
              workspaceId: opened.workspaceId,
              config: opened.config,
            };
            if (input.config.mode)
              saved.config.validation = z.enum(['plan', 'final', 'autonomous']).parse(input.config.mode);
          }
          if (roles.some((role) => saved.config.roles[role].provider.startsWith(`${TEAM_PROVIDER_ID}/`)))
            throw new Error('A Team cannot contain itself');
          // Recover the durable Engine create receipt even if the persistence update was lost.
          const existing = (await backend.list(saved.workspaceId))
            .filter((w) => Object.keys(w.requests).some((key) => key.startsWith(`create:team:${saved.key}:`)))
            .at(-1);
          if (existing) {
            saved.workflowId = existing.id;
            saved.config = existing.config;
          } else if (saved.workflowId) throw new Error('Team persistence does not match a workflow receipt');
          sessions.set(input.sessionId, {
            saved,
            agentId: z.string().min(1).parse(input.config.env.PASEO_AGENT_TEAMS_AGENT_ID),
            cwd: input.config.cwd,
            choices: opened.choices,
            emitted: new Map(),
            activity: new Map(),
            accepted: new Set(),
            graphsDirty: !!backend.watchGraphs,
          });
          emit({
            type: 'session.opened',
            requestId: input.requestId,
            sessionId: input.sessionId,
            capabilities,
            restoration: 'core',
            cwd: input.config.cwd,
            persistence: { version: 1, data: JSON.parse(JSON.stringify(saved)) },
          });
          settings(input.sessionId, t);
          emit({
            type: 'session.commands',
            sessionId: input.sessionId,
            commands: commands.map((c) => ({ ...c, description: t(c.description) })),
          });
          if (input.history === 'replay') await project(input.sessionId);
          emit({ type: 'session.ready', requestId: input.requestId, sessionId: input.sessionId });
          return;
        }
        if (!('sessionId' in input)) throw new Error('Unsupported Team request');
        const session = sessions.get(input.sessionId);
        if (!session) throw new Error('Unknown Team session');
        if (input.type === 'session.configure') {
          if (session.saved.workflowId)
            throw new Error(
              t('La composition est figée pour cette mission. Créez une nouvelle conversation pour changer les rôles.'),
            );
          if ((input.changes.model && input.changes.model !== 'auto') || input.changes.thinkingOption)
            throw new Error('Unsupported Team configuration');
          const next = structuredClone(session.saved.config);
          if (input.changes.mode) next.validation = z.enum(['plan', 'final', 'autonomous']).parse(input.changes.mode);
          for (const [key, value] of Object.entries(input.changes.settings ?? {})) {
            const role = z.enum(roles).parse(key);
            const provider = session.choices.find((p) => p.models.some((m) => `${p.id}/${m.id}` === value));
            const mode = provider?.modes.find((m) =>
              role === 'builder' ? !readOnlyMode(provider.family, m.id) : readOnlyMode(provider.family, m.id),
            );
            if (!provider || !mode || typeof value !== 'string')
              throw new Error('Unavailable Team model or permissions');
            next.roles[role] = { provider: value, modeId: mode.id };
          }
          session.saved.config = configSchema.parse(next);
          persist(input.sessionId, session.saved);
          settings(input.sessionId, t);
          emit({ type: 'request.completed', requestId: input.requestId });
          return;
        }
        if (input.type === 'session.close' || input.type === 'session.interrupt') {
          if (session.saved.workflowId) {
            const w = await backend.get(session.saved.workflowId, session.saved.workspaceId);
            if (!['completed', 'paused'].includes(w.status))
              await backend.action({
                id: w.id,
                workspaceId: w.workspaceId,
                expectedRevision: w.revision,
                requestId: `team:${session.saved.key}:${input.requestId}`,
                action: 'pause',
              });
          }
          if (session.turn) {
            emit({ type: 'session.turn', sessionId: input.sessionId, turnId: session.turn, state: 'canceled' });
            session.turn = undefined;
          }
          if (input.type === 'session.close') {
            sessions.delete(input.sessionId);
            emit({ type: 'session.closed', sessionId: input.sessionId });
          }
          emit({ type: 'request.completed', requestId: input.requestId });
          return;
        }
        if (input.type !== 'session.prompt') throw new Error('Unsupported Team request');
        const { sessionId } = input;
        const prompt = { ...input.prompt };
        if (
          prompt.input.type === 'message' &&
          prompt.input.content.every((c) => c.type === 'text' && !('mimeType' in c))
        ) {
          const command = /^\/(team-[a-z-]+)(?:\s+([\s\S]*))?$/.exec(
            prompt.input.content
              .map((c) => (c.type === 'text' ? c.text : ''))
              .join('\n')
              .trim(),
          );
          if (command) prompt.input = { type: 'command', name: command[1], arguments: command[2] ?? '' };
        }
        if (session.accepted.has(prompt.clientMessageId)) {
          await project(sessionId);
          return;
        }
        if (session.turn)
          throw new Error(
            t('L’équipe travaille déjà. Attendez la fin du tour, ou arrêtez-le pour mettre l’équipe en pause.'),
          );
        if (prompt.outputSchema || prompt.delivery === 'steer') throw new Error('Unsupported Team prompt capability');
        const text =
          prompt.input.type === 'message'
            ? prompt.input.content
                .map((c) => {
                  if (c.type !== 'text' || 'mimeType' in c)
                    throw new Error(t('Team Auto accepte actuellement les messages texte uniquement.'));
                  return c.text;
                })
                .join('\n')
                .trim()
            : '';
        if (prompt.input.type === 'message' && !text) throw new Error(t('Décrivez votre mission.'));
        if (prompt.input.type === 'command' && ['team-graphs', 'team-advance'].includes(prompt.input.name)) {
          const advancing = prompt.input.name === 'team-advance';
          const args = prompt.input.arguments.trim().split(/\s+/);
          let continuation: { id: string; expectedRevision: number } | undefined;
          if (advancing) {
            const parsed = z.object({ id: z.uuid(), expectedRevision: z.number().int().positive().safe() }).safeParse({
              id: args[0],
              expectedRevision: args.length === 2 && /^[1-9][0-9]*$/.test(args[1]) ? Number(args[1]) : NaN,
            });
            if (!parsed.success) throw new Error(t('Usage : /team-advance UUID révision-attendue'));
            continuation = parsed.data;
          } else if (prompt.input.arguments.trim()) throw new Error(t('Cette commande ne prend pas d’argument.'));
          const reportId = `${advancing ? 'advance' : 'graphs'}:${prompt.clientMessageId}`;
          if (!session.saved.transcript?.some((entry) => entry.id === reportId)) {
            // Resolve actual placement even before this conversation has a V1 mission.
            // The backend rechecks native ownership and canonical Git identity.
            const workspaceId = await backend.ownerWorkspace(session.agentId, session.cwd);
            if (workspaceId !== session.saved.workspaceId && session.saved.workflowId)
              throw new Error('Team workspace changed');
            let report: string;
            if (continuation) {
              if (!backend.advanceGraph) throw new Error('Team graph continuation unavailable');
              const result = await backend.advanceGraph({
                ...continuation,
                workspaceId,
                ownerAgentId: session.agentId,
              });
              const labels = {
                progressed: t('Frontière suivante enregistrée'),
                waiting: t('En attente'),
                blocked: t('Continuation bloquée'),
                terminal: t('Graphe terminé'),
                stale: t('Révision périmée : aucune continuation'),
              };
              report = `${labels[result.status]} · ${result.reason}\n\n${graphStatusReport([result.state], t, false)}`;
            } else {
              if (!backend.graphs) throw new Error('Team graph discovery unavailable');
              report = graphStatusReport(await backend.graphs(workspaceId, session.agentId), t);
            }
            session.saved.workspaceId = workspaceId;
            const at = session.saved.workflowId
              ? (await backend.get(session.saved.workflowId, workspaceId)).events.length
              : 0;
            record(
              session.saved,
              {
                id: prompt.clientMessageId,
                role: 'user',
                text: advancing ? `/team-advance ${prompt.input.arguments.trim()}` : '/team-graphs',
                at,
              },
              {
                id: reportId,
                role: 'assistant',
                text: report,
                at,
                ...(capabilities.includes('timeline.plugin') ? { graphWorkspaceId: workspaceId } : {}),
              },
            );
            persist(sessionId, session.saved);
          }
          const turnId = `team:turn:${prompt.clientMessageId}`;
          session.accepted.add(prompt.clientMessageId);
          emit({
            type: 'session.prompt_result',
            sessionId,
            clientMessageId: prompt.clientMessageId,
            result: { type: 'turn', turnId },
          });
          emit({ type: 'session.turn', sessionId, turnId, state: 'started' });
          try {
            await project(sessionId);
            emit({ type: 'session.turn', sessionId, turnId, state: 'completed' });
          } catch (error) {
            emit({ type: 'session.turn', sessionId, turnId, state: 'failed', error: { message: String(error) } });
          }
          return;
        }
        if (!session.saved.workflowId) {
          // Creation placement can finish after session.open. Resolve the actual
          // native owner before the first side effect, rather than reopening cwd.
          const workspaceId = await backend.ownerWorkspace(session.agentId, session.cwd);
          if (workspaceId !== session.saved.workspaceId) {
            session.saved.workspaceId = workspaceId;
            persist(sessionId, session.saved);
          }
        }
        const requestId = `team:${session.saved.key}:${prompt.clientMessageId}`;
        let w = session.saved.workflowId
          ? await backend.get(session.saved.workflowId, session.saved.workspaceId)
          : undefined;
        const at = w?.events.length ?? 0;
        if (prompt.input.type === 'command') {
          const command = prompt.input.name;
          if (!commands.some((c) => c.name === command)) throw new Error('Unknown Team command');
          if (prompt.input.arguments.trim()) throw new Error(t('Cette commande ne prend pas d’argument.'));
          if (!w) throw new Error(t('Décrivez d’abord votre mission.'));
          if (command !== 'team-status')
            w = await backend.action({
              id: w.id,
              workspaceId: w.workspaceId,
              expectedRevision: w.revision,
              requestId,
              action: command === 'team-pause' ? 'pause' : command === 'team-resume' ? 'resume' : 'approve',
              ...(command === 'team-approve-no-tests' ? { allowNoTests: true } : {}),
            });
        } else if (!w) {
          w = await backend.create(session.saved.workspaceId, text, session.saved.config, requestId, session.agentId);
          session.saved.workflowId = w.id;
          persist(sessionId, session.saved);
        } else if (!(requestId in w.requests) && !(`create:${requestId}` in w.requests)) {
          const pending = w.clarifications?.find((q) => !q.resolvedAt);
          const unanswered = pending?.request.questions.filter(
            (q) => !pending.answers.some((a) => a.questionId === q.id),
          );
          const answers = pending && unanswered ? answerQuestions(unanswered, text) : undefined;
          if (pending && !answers)
            throw new Error(
              t('{count} questions sont en attente. Répondez une par ligne : « 1. … », « 2. … ».', {
                count: unanswered?.length ?? 0,
              }),
            );
          w = await backend.action({
            id: w.id,
            workspaceId: w.workspaceId,
            expectedRevision: w.revision,
            requestId,
            ...(pending
              ? { action: 'answer_clarification', clarificationId: pending.id, answers: answers! }
              : approval.test(text) && ['awaiting_plan', 'awaiting_final'].includes(w.status)
                ? { action: 'approve' }
                : {
                    action: 'followup',
                    message: text,
                    purpose: 'message',
                  }),
          });
        }
        const shown = {
          id: prompt.clientMessageId,
          role: 'user' as const,
          text: prompt.input.type === 'command' ? `/${prompt.input.name}` : text,
          at,
        };
        if (!session.saved.transcript?.some((e) => e.id === shown.id)) {
          record(session.saved, shown);
          persist(sessionId, session.saved);
        }
        const item = transcriptItem(shown);
        session.emitted.set(item.id, JSON.stringify(item));
        emit({ type: 'timeline.item', sessionId, item });
        if (prompt.input.type === 'command' && prompt.input.name === 'team-status' && w) {
          const report = { id: `status:${prompt.clientMessageId}`, role: 'assistant' as const, at };
          if (!session.saved.transcript?.some((e) => e.id === report.id)) {
            record(session.saved, {
              ...report,
              text: statusReport(w, { label: label(sessionId, w), activity: () => undefined, t }),
            });
            persist(sessionId, session.saved);
          }
        }
        const turnId = `team:turn:${prompt.clientMessageId}`;
        session.turn = turnId;
        session.accepted.add(prompt.clientMessageId);
        emit({
          type: 'session.prompt_result',
          sessionId,
          clientMessageId: prompt.clientMessageId,
          result: { type: 'turn', turnId },
        });
        emit({ type: 'session.turn', sessionId, turnId, state: 'started' });
        try {
          await project(sessionId);
        } catch (error) {
          emit({ type: 'session.turn', sessionId, turnId, state: 'failed', error: { message: String(error) } });
          session.turn = undefined;
        }
      };
      return {
        version: 1,
        capabilities,
        onEvent(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async send(input) {
          const job = () =>
            handle(input).catch((error) => {
              if (
                input.type === 'session.prompt' &&
                !sessions.get(input.sessionId)?.accepted.has(input.prompt.clientMessageId)
              )
                emit({
                  type: 'session.prompt_result',
                  sessionId: input.sessionId,
                  clientMessageId: input.prompt.clientMessageId,
                  result: { type: 'failed', error: { message: String(error) } },
                });
              else if ('requestId' in input)
                emit({ type: 'request.failed', requestId: input.requestId, error: { message: String(error) } });
            });
          await ('sessionId' in input ? serialize(input.sessionId, job) : job());
        },
        async close() {
          closed = true;
          clearInterval(timer);
          removeGraphWatch?.();
          await Promise.allSettled(queues.values());
          sessions.clear();
          listeners.clear();
        },
      };
    },
  };
}

/** One remaining question takes the whole reply; several take one numbered line each. */
export function answerQuestions(questions: { id: string }[], text: string) {
  if (questions.length === 1) return [{ questionId: questions[0].id, text }];
  const parts = text.split(/^\s*(\d+)[.)]\s+/m).slice(1);
  const answers = new Map<number, string>();
  for (let i = 0; i + 1 < parts.length; i += 2) answers.set(Number(parts[i]), parts[i + 1].trim());
  if (answers.size !== questions.length || questions.some((_, i) => !answers.get(i + 1))) return undefined;
  return questions.map((q, i) => ({ questionId: q.id, text: answers.get(i + 1)! }));
}
