# Architecture

Agent Teams is a Paseo plugin with a daemon part (`index.server.ts`, `server/`) and a client part (`index.client.tsx`, `client/`). It uses only the public plugin SDK; no Paseo fork or client patch is needed.

## How a mission runs

1. **Team Auto provider** (`server/team-provider.ts`). The plugin registers the provider `agent-teams/auto`. Each Team Auto conversation is a session of that provider. A prompt creates a workflow, answers a question, approves, or sends a follow-up, depending on the workflow state.
2. **Engine** (`server/engine.ts`, `shared/state-machine.ts`). It drives Plan → Code → tests → Review → correction. Each role turn is an *operation*: its ID is saved before the prompt is sent and embedded in the prompt (`[agent-teams-operation:<id>]`). Results are validated JSON contracts (`shared/contracts.ts`, `shared/artifacts.ts`).
3. **Role sessions** (`server/runtime.ts`). Each role is a regular Paseo agent on the chosen harness, created with the SDK's `parent` option, so Paseo lists it as a subagent of the Team Auto conversation. Plan and Review get the harness's read-only mode: Claude `plan` with editing tools disabled, Codex `read-only` sandbox options, OpenCode `plan`. A harness without a read-only mode gets an instruction, and a repository fingerprint taken before the turn stops the mission if files change.
4. **Tests** (`server/commands.ts`). Verification commands run on the daemon host with `/bin/sh`, an environment limited to `PATH`, `HOME`, `LANG`, `LC_ALL`, `TERM`, `CI` and `TMPDIR`, a timeout per command (10 minutes by default) and 128 KiB of output per stream.
5. **Thread projection** (`server/team-timeline.ts`). The provider turns the workflow into native timeline items with stable IDs (details below).

## Thread projection

| Workflow content | Native item |
| --- | --- |
| A role operation | `tool_call` with `sub_agent` detail. Its log lists the role's tool calls, read from that session's canonical timeline (the calls after its operation prompt, last 200 entries), then its result. |
| A plan | `todo`, with tasks checked once Code delivers. |
| A verification run | `tool_call` with `shell` detail and the command output. |
| Corrections, approvals, questions, permissions, summary, `/team-status` | `assistant_message`. |

Paseo merges a `tool_call` only within the native turn that started it. So the Team Auto turn stays open while an operation runs, and a finished row is never emitted again: re-emitting it later, for example after a language change, would show it twice.

When a session reopens, Paseo rebuilds the thread from what the provider replays. Messages that depend on the moment they were shown (a plan waiting for approval, open questions, a permission, the summary, `/team-status` answers) and the user's messages are therefore recorded in the session persistence and replayed in place.

## Persistence and recovery

- Workflow state is written atomically, with private permissions, to `PASEO_AGENT_TEAMS_DATA_DIR` (default `~/.local/state/paseo-agent-teams`). It must be outside the edited repository. Git snapshots of the initial state are kept there until the workflow is closed.
- A repository lock prevents two workflows of this plugin on the same Git common directory, including linked worktrees. It does not lock out tools started outside the plugin.
- Recovery looks for the exact operation marker in the role session's history and a completion receipt. An idle session alone is not proof of completion. An uncertain operation stops the workflow for intervention; it is never sent again.
- Mutating RPCs carry a request ID and the expected revision. Identical retries are idempotent; conflicting writes are rejected.
- Corrupt state files are quarantined as `.corrupt` and keep their repository lock until repaired.

## Settings and translations

- The default team, validation mode, correction limit and language are one host-scoped settings document (`shared/team-composition.ts`, `registerSettings` on the server, `useSettings` in `client/team-settings.tsx`). A saved model that is no longer available falls back to the automatic pick.
- Paseo 0.11.2 does not give plugins the app language, so the language is part of these settings. Hosts without the settings API show French.
- French text is the message key: `t('Texte', { param })` looks up `shared/i18n-en.ts` in English. `tests/i18n.test.ts` fails on a missing or unused entry, a placeholder mismatch, or French text left outside `t()`.
- The client re-reads the setting every ten seconds, so every open client follows a language change. Rows already shown in a thread keep their language.

## Programmatic API

The daemon still exposes the engine through plugin RPCs (`teams.create`, `teams.action`, `teams.list`, `teams.workflow_index`, `teams.workflow_record`, `teams.permissions`, `teams.test_output`, `teams.catalog`, `teams.choices`). The Team Auto interface only uses a few of them. Engine features without a user interface remain available there: Manual Switch, goal mode, several repositories per workflow, explicit test commands at launch, and plan revisions from the reviewer session. The custom workflow graph modules (`shared/workflow-definition.ts`, `server/graph-*.ts`, `teams.save_definition`) are an internal foundation with no launcher.

## Tests

```sh
npm run check      # typecheck, ESLint, Prettier and all tests
npm run coverage   # line coverage of loaded modules (65 % minimum)
```

UI tests render components with a mocked React Native and Paseo host. They are not device tests. Real-model checks are recorded in [isolated-validation.md](isolated-validation.md).

Graph dispatch completion is captured from the official `agent.turn_ended` hook only. The checkpoint stores the native agent, saved send attempt, turn ID, terminal outcome and unmodified final assistant text. Capture requires one exact saved user prompt in that turn and matching workspace/session; ambiguous or oversized output leaves the operation pending. Duplicate receipts are idempotent, conflicting receipts are rejected. A receipt survives restart but does not resolve the activation, validate an artifact, verify read-only behavior or release the repository reservation. Missing hooks remain uncertain and never authorize resending. Graph launching is still internal.
