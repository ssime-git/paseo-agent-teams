# paseo-agent-teams

A standalone Paseo plugin for persistent workflows across **Claude Code** and **Codex**. No Paseo fork is needed.

- **Manual Switch:** hand a task to another harness after the current turn finishes, carrying the logical conversation and repository context.
- **Auto Workflow:** Plan → Build → Tests → Review → Fix, with a configurable correction limit.
- **One logical thread:** a workspace panel with responses, decisions, test logs, approvals and links to each persistent agent session. Progress cards also appear in the planner's native timeline.

## Requirements

- Paseo daemon and connected clients **0.11.2** (`>=0.11.2 <0.12.0`).
- Node.js 22.15 or later for development.
- Authenticated Claude Code and/or Codex providers on the daemon host. Model IDs and modes are discovered from that host; no subscription or model availability is assumed.
- A Git workspace on a Linux/macOS daemon host. The test runner uses `/bin/sh` and POSIX process groups.

## Install locally

```sh
npm ci
npm run check
paseo plugin install "$PWD"
paseo plugin ls
```

Enable plugins yourself in **Settings → Plugins → Enable plugins** if necessary. An automated installer must obtain explicit permission before changing that global switch. Plugin installation trusts code running with the daemon user's machine access.

Open a workspace, open the Command Center, and choose **Open Agent Teams**. After source changes:

```sh
npm run check
paseo plugin reload paseo-agent-teams
```

Install from the public repository with:

```sh
paseo plugin add git:ssime-git/paseo-agent-teams --ref feat/agent-teams-v1
```

Use `--ref main` after the implementation PR has been merged. A fresh Git installation prepares its production SDK dependency automatically; an existing developer checkout keeps its installed development tools.

## Configure a workflow

Choose each role's harness, discovered model and permission mode. Planner and Reviewer accept only Claude's `plan` mode or Codex's `read-only` mode when that mode is advertised by the daemon. On the tested 0.11.2 installation, Codex advertises only write-capable modes, so the read-only roles use Claude. Claude read-only sessions also disable editing and native plan-mode transitions; approval stays in the plugin. Builder uses the mode you select; the plugin does not answer native permission requests automatically.

Defaults: Auto Workflow, human approval after the plan, automatic corrections, two correction cycles and explicit restart recovery.

All three roles work **in the selected workspace directory**. There is no automatic branch, worktree, commit, merge, reset or cleanup. Existing staged, unstaged and non-ignored untracked files are captured before the first agent runs. A lock prevents other workflows of this plugin from starting in the same Git repository, including sibling worktrees. It cannot lock out tools or agents started outside the plugin.

### Approvals and tests

- **After the plan:** review the plan and edit its test commands, one command per line, before approving. Commands execute in the workspace directory.
- **At the end / Autonomous:** explicitly provide trusted test commands at launch. Commands proposed later by the planner are never executed automatically. At-the-end mode additionally waits for final human approval.
- A workflow without tests requires an explicit no-tests acknowledgement, displayed in its record.
- A command succeeds only with exit code zero and without a timeout. Completion requires all approved commands to succeed, a passing review and an unchanged repository fingerprint since the tests.
- A failed review or failed tests go back to the same Builder session. The initial implementation plus at most `maxCorrections` fixes are allowed. Exhaustion requires intervention.

Command timeouts default to ten minutes. Configuration JSON can set each timeout between 100 ms and one hour. Each stdout/stderr stream retains at most 128 KiB and records truncation. Tests run directly on the daemon host with its environment, so only approve commands you trust.

### Manual handoffs and pause

In Manual Switch, the initial task goes to the Planner. Send a message to the active role or choose another role to pass the task. A handoff requested during a turn waits for its completion. The target receives prior responses, decisions, relevant changes and remaining work, retaining its own native session across handoffs.

In Auto Workflow, a new message schedules a revised plan after the current turn, so new instructions cannot be silently skipped by a finishing review. In Manual Switch, messages sent during a turn queue a follow-up for the same role.

Pause prevents subsequent steps; an agent turn already dispatched is allowed to finish. A running plugin test command is terminated as a process group. Resume reconciles the saved operation before advancing. **Close keeping files** releases the workflow lock once agents are confirmed inactive. It preserves all files and native sessions.

A permission request pauses progress. Open the relevant native session and answer it there. A timeout is an observation deadline, not a cancellation or a reason to send the task again.

### Restart recovery

Both explicit and automatic restart recovery are supported. Explicit recovery is the default. Automatic recovery connects through the public SDK and only resumes workflows configured for it. Paused workflows and pending human checkpoints stay paused.

Server-only environment variables:

| Variable | Default / purpose |
| --- | --- |
| `PASEO_AGENT_TEAMS_DATA_DIR` | `~/.local/state/paseo-agent-teams`; use a separate absolute directory per daemon installation |
| `PASEO_AGENT_TEAMS_DAEMON_URL` | `ws://127.0.0.1:6767/ws`; must identify the same daemon hosting the plugin |
| `PASEO_AGENT_TEAMS_DAEMON_PASSWORD` | Optional password for the automatic recovery connection |

These variables belong to the daemon launch environment, not the exported workflow configuration. Non-default daemon endpoints must configure the recovery URL. The configured data directory must be outside the repository being edited.

Workflow state is written atomically, with restrictive file permissions, outside the repository. It includes session IDs, request fingerprints, operation IDs, timeline cursors, final responses and completion receipts. Git snapshots include file contents and should be treated as private project data.

Recovery looks for the exact operation marker in paginated canonical history and a durable completion receipt, or observes the accepted turn still running. It does not treat `idle` alone as proof of completion. Missing receipts, foreign prompts or ambiguous acceptance stop for intervention rather than resend. You can inspect the native session and close the workflow after agents become inactive. Interrupted tests require explicit intervention before rerunning, because commands may have side effects.

Configuration export/import is strict, versioned JSON containing role selections and workflow options. It does not contain credentials, messages, sessions or snapshots. On mobile, select and copy the exported text; web/desktop also attempt clipboard copy.

## Development and architecture

```sh
npm ci
npm run check
```

- `shared/`: Zod contracts for configuration, structured stage results and RPCs.
- `server/`: deterministic transitions, repository snapshots, test execution, atomic persistence and SDK integration.
- `client/`: React Native panel and native timeline card renderer, respecting the current Paseo theme and compact layout.
- `tests/`: state-machine, SDK adapter, repository, command runner, configuration and mocked host UI tests.

Mutating RPCs carry a request ID and expected workflow revision. Repeated identical requests are idempotent; conflicting writes require a refresh. Agent creation has stable idempotency keys. Before a prompt is sent, its operation ID is persisted and embedded in the prompt. The native timeline is a projection: failure to publish a card does not rerun the agent.

The plugin directly uses SDK methods and lifecycle hooks. It does not need the Paseo handoff/advisor/committee skills to be installed. Native sessions remain separate; their histories are not physically merged.

Snapshot capture currently rejects repositories whose captured files and diffs exceed 20 MiB. Generated ignored files are excluded. A snapshot failure is explicit rather than silently losing context.

## Verification status

The local implementation has typechecking, automated tests and compilation of both entries with Paseo 0.11.2's official plugin compiler. UI tests use a mocked React Native/Paseo host; they are not native device tests.

An authenticated **Opus 5.5 → GPT-6.1-Sol → Sonnet 5.5** smoke run completed on an isolated daemon, including a deliberately failed verification, a failed review, one correction and a passing review. Manual handoff, automatic recovery across a plugin reload, native progress cards and desktop/compact web rendering were also checked. Fable was listed but required usage credits on the tested account; model availability is not an entitlement guarantee.

See [isolated validation](docs/isolated-validation.md) for evidence, fixes and remaining limits.

Official API references: [plugins](https://paseo.sh/docs/plugins/reference), [agents](https://paseo.sh/docs/sdk/agents), [providers](https://paseo.sh/docs/sdk/providers), [events](https://paseo.sh/docs/sdk/events).
