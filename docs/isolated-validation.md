# Real-model validation

All checks ran on a separate Paseo 0.11.2 daemon (own home, state directory and loopback port) with disposable Git repositories. The primary daemon only received the plugin through `paseo plugin reload`, after its workflows were confirmed idle.

## Team Auto — 23 October 2026

Daemon on `127.0.0.1:6891`. Roles: Claude Code Opus 5.5 (Plan), Codex GPT-6.1-Sol or Claude Code Sonnet 5.5 (Code), Claude Code Opus 5.5 or Sonnet 5.5 (Review). Fixtures: small ESM functions (`add`, `slugify`) with `node --test` suites.

| Check | Result |
| --- | --- |
| Complete missions in French and English | Plan, **go**, Code, verification, Review and summary in one thread, with each role row updated in place. |
| Role sessions | Created as children of the Team Auto agent (`paseo.parent-agent-id`), listed under **N subagents**, with no extra tabs. Titled in the interface language. |
| Permissions | With Code on Claude Sonnet in its `default` mode, the thread announced each request. Accepting from the Code session opened through the subagents list resumed the mission each time. |
| Correction cycle | A verification that fails once, only in the plugin's test environment, made the first run exit 1. The thread showed the correction, a second Code turn, a passing run, a passing review and the summary. Only the target file changed. |
| Restart | After a daemon restart the replayed thread matched the original, including the user's **go** and the plan message. |
| Default team | A saved model in the settings was used by the next new conversation. |
| Language | The settings page switched at once. A second open client followed within fifteen seconds. Rows already shown were not duplicated. |
| `/team-status` | Answers in the thread with the state, the team and the correction count. |
| Removed interface | No workspace panel, no history screen, no sidebar entries; the Command Center only offers *Agent Teams · Default team*. |
| Web client | 1280 px and 390 × 844 viewports, no horizontal overflow and no page errors. |

Defects found during these checks and fixed: the replay lost user and state messages after a restart; a language change duplicated finished rows; the Team card repeated the sheet title on mobile; a second client did not follow a language change; `/team-status` answered nothing.

## Engine — 19 to 21 October 2026

- **Correction loop.** Opus 5.5 → GPT-6.1-Sol → Sonnet 5.5 with a deliberately failed verification: the review failed, the same Code session corrected, and the second verification and review passed. Staged, unstaged and untracked user files stayed byte-identical.
- **Recovery.** The plugin was reloaded while a role turn was running. The workflow completed with exactly one dispatch of that turn.
- **Provider discovery.** Claude, Codex, Copilot, OpenCode, Pi and a custom Claude alias were discovered with their models and modes. Codex review ran with its native read-only sandbox (`sandboxPolicyType: read-only`).
- **Several repositories.** One workflow coordinated two repositories from a parent folder without Git; both test commands passed and the parent was never initialized.

## Internal graph receipt assessment — 24 October 2026

Paseo 0.11.2 on `127.0.0.1:6894`, disposable home, plugin data and Git repository in `/tmp/teams-graph-assessment-live-tyxvk4w9`. One actual Codex GPT-6.1-Sol turn, discovered through the official SDK, native read-only sandbox, 45-second wait budget. The plugin's official turn hook persisted a completed receipt; `GraphCheckpoints.assessReceipt` staged its build artifact as valid. The raw receipt, send attempt and repository contents remained intact. The graph stayed running with no resolved activation. After stopping and starting only this isolated daemon, assessment/checkpoint equality and exactly one native user prompt were verified, including an initial-send call with an old revision. The isolated daemon was stopped afterward.

Script: `/tmp/teams-graph-assessment-live.mts`. Evidence: `receipt.json`, `assessment.json`, `finished-proof.json`, `restarted-proof.json`, `discovery.json` under the isolated root. Six additional automated tests cover all three artifact contracts, incomplete work, malformed/missing output, native failures/cancellations, restart, concurrency, access and tampered assessment rejection. Those automated native events are simulated. No new Claude, browser or mobile check is claimed for this internal boundary; production transitions still need effective read-only and independent test gates.

## Not verified

- Native iOS and Android apps.
- Every harness, account and model combination. A listed model can still require credits the account does not have.


## Internal graph read-only evidence — 24 October 2026

Paseo 0.11.2 on `127.0.0.1:6895`, disposable home, plugin data and Git repository in `/tmp/teams-graph-integrity-live-rszydo03`. One actual Codex GPT-6.1-Sol turn, discovered through the official SDK, read-only native sandbox, 45-second wait budget. Its pre-send repository baseline was saved with the unique attempt. The official plugin hook persisted a completed receipt; its build artifact was assessed and `verifyGraphIntegrity` saved matching repository evidence. Exactly one native user prompt, README unchanged, no activation resolved and graph still running. After stopping and starting only this isolated daemon, checkpoint/evidence equality, idempotent integrity replay and no resend with an old revision were verified. The isolated daemon was stopped afterward.

Script: `/tmp/teams-graph-integrity-live.mts`. Evidence: `sent.json`, `receipt.json`, `assessment.json`, `integrity.json`, `finished-proof.json`, `restarted-proof.json`, `discovery.json` in that root. Six additional automated tests use real temporary Git repositories and simulated native APIs, covering root snapshots from a nested workspace, content/index/deletion/mode/symlink/untracked/HEAD changes, restart, concurrency, corruption, absent legacy baseline/receipt, scope/revision/repository checks and snapshot budget failure before sending. An explicit test confirms ignored files are outside the declared proof. `npm run check`: 230 tests pass. No additional Claude or UI/mobile test is claimed for this internal change.

## Internal graph independent tests — 24 October 2026

`npm run check` passes with 235 tests. Five new automated tests use actual temporary Git repositories and actual shell commands, with a simulated workspace API and native receipt. They verify root execution from a nested workspace, exact persisted results and restart replay, concurrent execution arbitration, uncertain claims without retry, nonzero exit, timeout/process termination, bounded output, command side effects in fingerprints, scope/revision/read-only checks, corruption rejection and definition budgets. These are local integration tests, not proof of a complete native graph workflow.

A real isolated daemon was attempted at `127.0.0.1:6896`, home/data/repository in `/tmp/teams-graph-tests-live-ish6a_lm`, using script `/tmp/teams-graph-tests-live.mts`. The globally installed CLI is now 0.13.0, while the principal daemon still runs 0.11.2. The isolated 0.13.0 daemon explicitly refused the plugin's declared `>=0.11.2 <0.13.0` compatibility range. A native Codex turn was attempted, but no official plugin receipt could be captured and the script failed its receipt assertion; independent graph test execution and native restart replay were **not validated**. The isolated daemon was stopped. Attempts to install the official CLI 0.11.2 separately failed with write error `-122` (quota); no compatibility declaration or Paseo source was changed to force loading. Main daemon and plugin were not restarted/reloaded. Re-run native integration with a complete compatible isolated installation before enabling production graph transitions.

Evidence: `/tmp/teams-graph-tests-check.log`, `/tmp/teams-graph-tests-path`, `/tmp/teams-roadmap-sdk-agents.json`, `/tmp/teams-graph-tests-agents-final.json`, `/tmp/teams-graph-tests-primary-after.json`, `/tmp/teams-graph-tests-schedules.json`, the isolated daemon log and npm logs `2026-10-24T16_43_44_833Z-debug-0.log` / `2026-10-24T16_44_14_407Z-debug-0.log` under `~/.npm/_logs/`.


## Internal graph result consumption — 24 October 2026

The previous compatible-installation blocker was resolved without changing Paseo: the official CLI/server 0.11.2 was installed separately in `/dev/shm/teams-paseo-compatible` with optional dependencies omitted. An initial `/tmp` installation again failed on quota; its incomplete package tree and the cache created by this pass were removed, retaining the earlier quota logs in `~/.npm/_logs/`. The usable installation required no Paseo source or compatibility-range changes.

Paseo 0.11.2 on `127.0.0.1:6897`, disposable home/data/repository in `/tmp/teams-graph-consumption-live-byn86l63`, voice/dictation/relay disabled. Actual Codex GPT-6.1-Sol, model/mode discovered through the official SDK, native read-only sandbox, one prompt and a 45-second turn budget. The official plugin hook saved a completed receipt; its build artifact was valid, integrity matched, and an explicitly saved shell test ran successfully. Test results replayed identically through a new Store with a stale revision. Consumption persisted exactly one transition to `review`, with no second activation or model turn. After stopping/starting only the isolated daemon, the checkpoint matched exactly, consumption replayed without another transition, send/test calls on the consumed operation were rejected, and the timeline still contained exactly one user prompt. README was unchanged. The isolated daemon was stopped afterward.

The first bounded real attempt used a repository under `/dev/shm/teams-graph-consumption-live-l4s62bxp`. The model reported that this path was inaccessible in its tool environment and returned a valid build artifact with remaining work. The plugin consumed that failure outcome after the independent shell test passed. The harness had wrongly assumed a successful candidate, so its ready-status assertion failed; it was not counted as a successful task execution. The second attempt moved the disposable repository to `/tmp` and passed all assertions. Two real Codex turns total; no automatic model retry loop, Claude or browser/device test is claimed.

Script: `/tmp/teams-graph-consumption-live.mts`. Evidence in the successful root: `sent.json`, `receipt.json`, `assessment.json`, `integrity.json` (completed independent tests), `consumed.json`, `finished-proof.json`, `restarted-proof.json`, `discovery.json`, `primary-before.json`, `primary-after.json`. Logs: `/tmp/teams-graph-consumption-live.log`, `/tmp/teams-graph-consumption-restart.log`, `/tmp/teams-graph-consumption-daemon.log`, `/tmp/teams-graph-consumption-daemon-restart.log`. The primary plugin alone was then reloaded after its agents were inactive. This **failed**: the still-running daemon 0.11.2 rejected `providers[0].requiresConfiguration` emitted by its on-disk plugin child runtime, now belonging to the globally updated CLI/server 0.13.0. The primary plugin is consequently `failed`; both daemon PIDs and all four workflow file hashes remained identical. No primary daemon restart, package downgrade or Paseo source patch was performed. Inspection of official installed runtime code found a fixed relative child entry point and no supported reload-time path override. Native graph tests above passed on the separate complete 0.11.2 installation, but primary plugin recovery requires aligning its runtime and daemon outside this pass's authorized scope. Evidence: `/tmp/teams-graph-consumption-primary-reload.json` (the CLI wrote the error on stderr; plugin status is also saved separately), `primary-before.json` / `primary-after.json` and `primary-plugin-failed.json`.

`npm run check`: 241 tests pass. Six added automated tests use real temporary repositories/commands and simulated native receipt/workspace APIs. They cover atomic consumption/concurrent calls/restart, permissions and corruption, absent/uncertain/failed/timed-out/truncated tests, fresh fingerprints and side effects, refusal of low-level bypass, native failures/no-test approval, write-step failure artifacts, transition exhaustion and historical checkpoint compatibility. Two existing receipt tests now expect the explicit consumption-gate error. No global roadmap criterion is marked complete: this is a single-activation internal boundary, not an end-to-end graph launcher.
