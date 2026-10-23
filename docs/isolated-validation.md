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

## Not verified

- Native iOS and Android apps.
- Every harness, account and model combination. A listed model can still require credits the account does not have.
