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
