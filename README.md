# paseo-agent-teams

A standalone Paseo plugin for persistent workflows across **all available harnesses and models discovered by your Paseo daemon**, including Claude Code, Codex, OpenCode, Pi and custom providers. No Paseo fork is needed.

- **Manual Switch:** hand a task to another harness after the current turn finishes, carrying the logical conversation and repository context.
- **Auto Workflow:** Plan → Build → Tests → Review → Fix, with a configurable correction limit.
- **One logical thread:** a workspace panel with responses, decisions, test logs, approvals and links to each persistent agent session. Progress cards also appear in the planner's native timeline.

## Screenshots

Real captures from an isolated Paseo installation and a demo repository. The mobile capture uses a compact 390 × 844 viewport.

**Available before the first chat:** choose **Nouveau workspace agent** in the sidebar, select your project and configure the team.

![Agent mode available next to New workspace](docs/screenshots/new-workspace.png)

**Native creation pill — client extension prototype:** this capture shows the actual New workspace form with **Mode agent**, using the [proposed Paseo client patch](docs/upstream/README.md). It requires that client change; installing the plugin alone on a VM does not add the pill to current official desktop/mobile apps.

![Mode agent pill in the native New workspace form with the proposed client extension](docs/screenshots/native-new-workspace-desktop.png)

**Unified conversation:** phase navigation, role models, shared context and structured planning results.

![Agent Teams workflow panel](docs/screenshots/team-workflow.png)

**Quick start from a thread:** choose the discovered harness and model for each role.

![Team quick-start configuration](docs/screenshots/team-quick-start.png)

**Test output:** inspect each command, its result and captured logs.

![Expanded test logs in the Team workflow](docs/screenshots/team-test-logs.png)

<details>
<summary>Mobile team configuration</summary>

<img src="docs/screenshots/team-mobile.png" alt="Compact mobile team configuration" width="390" />

</details>

## Requirements

- Paseo daemon **0.11.2** and compatible connected clients (`>=0.11.2 <0.13.0`), including mobile 0.11.4 and desktop 0.12.0.
- Node.js 22.15 or later for development.
- At least one available, authenticated harness on the daemon host. Model IDs and modes are discovered from that host; no subscription or model availability is assumed.
- A Git workspace on a Linux/macOS daemon host. The test runner uses `/bin/sh` and POSIX process groups.

## Install locally

```sh
npm ci
npm run check
paseo plugin install "$PWD"
paseo plugin ls
```

Enable plugins yourself in **Settings → Plugins → Enable plugins** if necessary. An automated installer must obtain explicit permission before changing that global switch. Plugin installation trusts code running with the daemon user's machine access.

A reload recompiles the **registered source directory**. If the plugin was installed from Git, that directory is Paseo's internal checkout; changing your separate working copy or the HTML mockup does not change the app. For UI development, register the local project directory instead (after active agent turns have finished):

```sh
paseo plugin remove paseo-agent-teams
paseo plugin install /absolute/path/to/paseo-agent-teams
paseo plugin reload paseo-agent-teams
```

The application renders `index.client.tsx` and the React Native components in `client/`. `docs/mockup-panel.html` is a visual reference. The Mode agent popover and full panel share workspace-scoped draft configuration and task text, including across responsive panel remounts.

To start directly in team mode, choose **Nouveau workspace agent** in the sidebar (open the navigation menu on mobile). This entry is available before creating a chat. Choose a known project or enter its directory on the indicated host; the plugin opens its workspace and immediately shows the full team configuration. No native agent is created until you launch the workflow.

From a workspace, **Search** (the Command Center) also offers **Nouveau workspace agent** and **Open Agent Teams**. The native New workspace screen has no host-scoped plugin commands, so use the sidebar entry there. Existing threads show **Mode agent** in the composer, opening the configurable team popover. Released SDKs require an existing agent for composer pills. With the [proposed client extension](docs/upstream/README.md), this plugin additionally registers a **Mode agent** pill directly above the native New workspace composer, scoped to the selected host, project and draft text.

Hand-offs between roles carry compact artifacts and a bounded diff rather than the whole conversation; the panel shows the hand-off size, and **fresh session per correction** (optional) restarts a role's session on each correction cycle. After source changes:

```sh
npm run check
paseo plugin reload paseo-agent-teams
```

Install from the public repository with:

```sh
paseo plugin add git:ssime-git/paseo-agent-teams --ref main
```

A fresh Git installation prepares its production SDK dependency automatically; an existing developer checkout keeps its installed development tools.

## Configure a workflow

Choose each role's harness, discovered model and permission mode. Planner and Reviewer can use any discovered harness. Claude uses `plan`. For Codex, the plugin offers **Lecture seule (sandbox Codex)** even when discovery omits that mode: it maps to the advertised `auto` mode with native `sandbox_mode: read-only` and `approval_policy: never` options. A native `read-only` mode, when advertised, is retained. Claude read-only sessions also disable editing and native plan-mode transitions; approval stays in the plugin. OpenCode uses its native `plan` mode. Other harnesses use an advertised `read-only` mode when available; otherwise they offer **Lecture seule par consigne (sans sandbox)**. This choice sends read-only instructions and persists a repository fingerprint before dispatch. Any repository change during that turn, including after restart recovery, suspends the workflow without reverting files. This detects changes; it cannot prevent writes or attribute external changes to an agent. Builder uses the mode you select; the plugin does not answer native permission requests automatically.

Defaults: Auto Workflow, human approval after the plan, automatic corrections, two correction cycles and explicit restart recovery.

Providers without discovered model IDs offer an explicit **harness default (not advertised)** choice. It leaves model selection to that harness; the plugin never sends a made-up model ID. Providers with no mode catalog can likewise retain their native default permissions. Authentication, connected accounts and configured model catalogs remain the harness's responsibility. Unavailable/error providers cannot be launched; discovering a model does not guarantee access or credits.

### Separate Claude accounts

The panel also discovers custom providers extending Claude or Codex. Configure a separate account on the daemon host using a dedicated directory, without logging out the default account:

```sh
CLAUDE_CONFIG_DIR="$HOME/.config/claude-fable" claude auth login --claudeai
```

After completing login, add an entry under `agents.providers` in the daemon's `config.json`, using an absolute path:

```json
{
  "claude-fable": {
    "extends": "claude",
    "label": "Claude — Fable credits",
    "env": { "CLAUDE_CONFIG_DIR": "/absolute/home/.config/claude-fable" }
  }
}
```

Reload the daemon configuration, then select this provider for the Reviewer. Provider inheritance determines the available read-only modes; its distinct ID is preserved when launching agents. Credentials and launch environments stay on the server and are excluded from exported workflow configurations. Model discovery alone does not confirm that the selected account has credits. See Paseo's [custom provider documentation](https://paseo.sh/docs/custom-providers).

The workspace must point to an accessible Git repository. If it points to a non-Git parent directory, the panel explains the requirement before launch and offers buttons to open detected immediate child repositories. It never initializes a repository or silently changes the target.

All three roles work **in the selected workspace directory**. There is no automatic branch, worktree, commit, merge, reset or cleanup. Existing staged, unstaged and non-ignored untracked files are captured before the first agent runs. A lock prevents other workflows of this plugin from starting in the same Git repository, including sibling worktrees. It cannot lock out tools or agents started outside the plugin.

If a workflow in another workspace holds that repository lock, the launch form shows its task and state with **Ouvrir le workflow bloquant**. This opens its exact workspace and selects that workflow, including when the panel previously showed a new-workflow form. Resume it or choose **Clore en conservant les fichiers**, then refresh the lock notice before launching another workflow.

### Approvals and tests

- **After the plan:** review the plan and edit its test commands, one command per line, before approving. Commands execute in the workspace directory.
- **At the end / Autonomous:** the Planner chooses test commands after examining the repository, and the plugin executes them automatically. You can optionally specify commands at launch to override that choice. At-the-end mode additionally waits for final human approval.
- A workflow without tests requires an explicit no-tests acknowledgement, displayed in its record. If the Planner proposes no tests and their absence was not accepted at launch, the workflow pauses after planning.
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

### Safety and validation

Planner-proposed shell commands always require approval at the plan checkpoint, including
`final` and `autonomous` workflows. Commands supplied by the human in `testCommands` at launch
are trusted. An empty command list requires explicit `allowNoTests` acceptance.

Commands run with a POSIX shell and an environment limited to `PATH`, `HOME`, `LANG`, `LC_ALL`,
`TERM`, `CI` and `TMPDIR`. Optional `testEnvironmentKeys` allows additional named variables;
`PASEO_AGENT_TEAMS_*` variables are always excluded. Windows command execution is unsupported.
`maxConsecutiveTimeouts` optionally changes the default limit of three observations before
intervention; a timeout retains the operation and never resends its prompt.

Action and history RPC callers must provide `workspaceId`; the field remains optional in the
wire schema during migration, but the server rejects missing or mismatched workspace IDs.
The bundled client supplies it. Background execution uses a dedicated daemon connection,
configured by `PASEO_AGENT_TEAMS_DAEMON_URL` and `PASEO_AGENT_TEAMS_DAEMON_PASSWORD`.

Persistence is cached for the lifetime of one plugin instance. Stop the plugin before repairing
state on disk. Corrupt records are quarantined as `.corrupt` files and retain their repository locks.
If their repository cannot be recovered, creation is blocked until repair; healthy workflows remain available. Completed workflows delete their baseline.
Recent request IDs are retained (200 including the creation ID), so clients must not rely on
replaying requests after they leave that window. Prompts contain the last 20 conversation
entries, bounded text sections, file hashes and bounded diffs rather than base64 file copies.

`npm run check` runs type checking, ESLint, Prettier validation and tests. `npm run coverage`
requires at least 65% line coverage for loaded modules; the report excludes unimported modules
and the panel is exercised separately through its bundled renderer test. CI runs both commands
on Node 22, 24 and 26. `npm run format` applies the repository formatting rules.
