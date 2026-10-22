import { z } from 'zod';
import {
  negotiateProviderCapabilities,
  type ProviderRegistration,
  type ProviderEvent,
  type ProviderInput,
  type ProviderConfigState,
} from '@getpaseo/plugin/server/provider';
import { configSchema, roles, type Action, type Config, type Workflow } from '../shared/contracts';
import { TEAM_PROVIDER_ID, type TeamProviderChoice } from '../shared/team-composition';
import { readOnlyMode } from '../shared/provider-selection';

export interface TeamProviderBackend {
  open(
    cwd: string,
    workspaceId: string,
  ): Promise<{ workspaceId: string; choices: TeamProviderChoice[]; config: Config }>;
  ownerWorkspace(agentId: string, cwd: string): Promise<string>;
  list(workspaceId: string): Promise<Workflow[]>;
  get(id: string, workspaceId: string): Promise<Workflow>;
  create(workspaceId: string, task: string, config: Config, requestId: string): Promise<Workflow>;
  action(input: Action): Promise<Workflow>;
}
const savedSchema = z
  .object({ key: z.uuid(), workspaceId: z.string().min(1), config: configSchema, workflowId: z.string().optional() })
  .strict();
type Saved = z.infer<typeof savedSchema>;
const models = [
  {
    id: 'auto',
    label: 'Team Auto',
    description: 'Planifier, développer, tester et relire avec des modèles complémentaires.',
  },
];
const modes = [
  { id: 'plan', label: 'Valider le plan' },
  { id: 'final', label: 'Valider le résultat' },
  { id: 'autonomous', label: 'Validation autonome' },
];
const commands = [
  { name: 'team-status', description: 'Afficher l’état de l’équipe' },
  { name: 'team-pause', description: 'Mettre l’équipe en pause' },
  { name: 'team-resume', description: 'Reprendre le workflow enregistré' },
  { name: 'team-approve', description: 'Approuver le plan ou le résultat en attente' },
  { name: 'team-approve-no-tests', description: 'Approuver explicitement sans commande de test' },
];
const waiting = new Set(['paused', 'attention', 'permission', 'awaiting_plan', 'awaiting_final', 'completed']);

/** A native model selection backed by the existing V1 engine, never another orchestrator. */
export function createTeamProvider(backend: TeamProviderBackend): ProviderRegistration {
  return {
    id: TEAM_PROVIDER_ID,
    label: 'Agent Teams',
    description: 'Une équipe de modèles qui se passent la main automatiquement.',
    async connect(request) {
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
          events: Set<string>;
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
      const settings = (sessionId: string) => {
        const session = sessions.get(sessionId)!;
        const state: ProviderConfigState = {
          model: 'auto',
          mode: session.saved.config.validation,
          models,
          modes,
          thinkingOptions: [],
          settings: roles.map((role) => ({
            type: 'select',
            id: role,
            label: role === 'planner' ? 'Planifier' : role === 'builder' ? 'Développer' : 'Relire',
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
      const project = async (sessionId: string) => {
        const session = sessions.get(sessionId);
        if (!session?.saved.workflowId) return;
        const w = await backend.get(session.saved.workflowId, session.saved.workspaceId);
        if (closed || sessions.get(sessionId) !== session) return;
        for (const event of w.events) {
          if (session.events.has(event.id)) continue;
          session.events.add(event.id);
          if (event.kind === 'assistant' && event.role)
            emit({
              type: 'timeline.item',
              sessionId,
              timestamp: event.at,
              item: {
                type: 'plugin',
                id: `team:${event.id}`,
                pluginId: 'paseo-agent-teams',
                kind: 'agent-teams-progress',
                version: 1,
                data: {
                  workflowId: w.id,
                  workspaceId: w.workspaceId,
                  status: `${w.phase} · ${w.status}`,
                  detail: '',
                  artifact: { role: event.role, text: event.text },
                  cycle: w.cycle,
                  maxCorrections: w.config.maxCorrections,
                },
              },
            });
        }
        if (session.revision !== w.revision) {
          const role =
            w.operation?.role ??
            (w.phase === 'planning'
              ? 'planner'
              : w.phase === 'building'
                ? 'builder'
                : w.phase === 'reviewing'
                  ? 'reviewer'
                  : undefined);
          const detail =
            w.status === 'completed'
              ? 'Mission terminée.'
              : w.clarifications?.some((q) => !q.resolvedAt)
                ? 'En attente de réponse. Ouvrez Team Auto pour répondre aux questions.'
                : w.status === 'awaiting_plan'
                  ? 'Le plan attend votre accord. Ouvrez Team Auto ou utilisez /team-approve.'
                  : w.status === 'awaiting_final'
                    ? 'Le résultat attend votre accord. Ouvrez Team Auto ou utilisez /team-approve.'
                    : w.status === 'permission'
                      ? 'Une autorisation est attendue dans Team Auto.'
                      : w.status === 'paused'
                        ? 'Équipe en pause.'
                        : w.status === 'attention'
                          ? (w.error ?? 'Votre attention est nécessaire.')
                          : w.phase === 'testing'
                            ? 'Les tests ont la main.'
                            : `${role ?? 'Équipe'} · ${role ? w.config.roles[role].provider : ''} a la main.`;
          emit({
            type: 'timeline.item',
            sessionId,
            item: {
              type: 'plugin',
              id: `team:status:${w.id}`,
              pluginId: 'paseo-agent-teams',
              kind: 'agent-teams-progress',
              version: 1,
              data: {
                workflowId: w.id,
                workspaceId: w.workspaceId,
                status: `${w.phase} · ${w.status}`,
                detail,
                cycle: w.cycle,
                maxCorrections: w.config.maxCorrections,
              },
            },
          });
          session.revision = w.revision;
        }
        if (session.turn && (waiting.has(w.status) || w.clarifications?.some((q) => !q.resolvedAt))) {
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
        if (closed) throw new Error('Provider connection closed');
        if (input.type === 'catalog') {
          emit({
            type: 'catalog',
            requestId: input.requestId,
            catalog: { models, modes, defaultModel: 'auto', defaultMode: 'plan' },
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
            events: new Set(),
            accepted: new Set(),
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
          settings(input.sessionId);
          emit({ type: 'session.commands', sessionId: input.sessionId, commands });
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
              'La composition est figée pour cette mission. Modifiez les rôles depuis Team ou créez une nouvelle conversation.',
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
          settings(input.sessionId);
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
          throw new Error('L’équipe travaille déjà. Utilisez la modale pour suivre ou mettre en pause.');
        if (prompt.outputSchema || prompt.delivery === 'steer') throw new Error('Unsupported Team prompt capability');
        const text =
          prompt.input.type === 'message'
            ? prompt.input.content
                .map((c) => {
                  if (c.type !== 'text' || 'mimeType' in c)
                    throw new Error('Team Auto accepte actuellement les messages texte uniquement.');
                  return c.text;
                })
                .join('\n')
                .trim()
            : '';
        if (prompt.input.type === 'message' && !text) throw new Error('Décrivez votre mission.');
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
        if (prompt.input.type === 'command') {
          const command = prompt.input.name;
          if (!commands.some((c) => c.name === command)) throw new Error('Unknown Team command');
          if (prompt.input.arguments.trim()) throw new Error('Cette commande ne prend pas d’argument.');
          if (!w) throw new Error('Décrivez d’abord votre mission.');
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
          w = await backend.create(session.saved.workspaceId, text, session.saved.config, requestId);
          session.saved.workflowId = w.id;
          persist(sessionId, session.saved);
        } else if (!(requestId in w.requests) && !(`create:${requestId}` in w.requests)) {
          const pending = w.clarifications?.find((q) => !q.resolvedAt);
          const unanswered = pending?.request.questions.filter(
            (q) => !pending.answers.some((a) => a.questionId === q.id),
          );
          if (pending && unanswered?.length !== 1)
            throw new Error('Plusieurs questions sont en attente. Répondez dans la modale Team Auto.');
          w = await backend.action({
            id: w.id,
            workspaceId: w.workspaceId,
            expectedRevision: w.revision,
            requestId,
            action: pending
              ? 'answer_clarification'
              : w.status === 'completed' ||
                  ['awaiting_plan', 'awaiting_final', 'paused', 'attention'].includes(w.status)
                ? 'followup'
                : 'message',
            ...(pending
              ? { clarificationId: pending.id, answers: [{ questionId: unanswered![0].id, text }] }
              : { role: w.phase === 'done' ? 'builder' : w.activeRole, message: text, purpose: 'message' }),
          });
        }
        emit({
          type: 'timeline.item',
          sessionId,
          item: {
            type: 'user_message',
            id: `team:user:${prompt.clientMessageId}`,
            text: prompt.input.type === 'command' ? `/${prompt.input.name}` : text,
            clientMessageId: prompt.clientMessageId,
          },
        });
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
          await Promise.allSettled(queues.values());
          sessions.clear();
          listeners.clear();
        },
      };
    },
  };
}
