# Goal execution: behavior and live validation

Enable **Poursuivre jusqu’à l’objectif** (*Keep going until the goal*) in the advanced panel configuration. Team Auto conversations do not enable goal mode; they use the default team and validation mode from the settings. Choose the three native providers/models independently. The initial human plan checkpoint remains the default; choose **Autonome** to authorize execution from the first plan. Existing configurations retain their bounded pipeline behavior until this option is enabled.

The Code role (builder) develops, runs tests, inspects failures and fixes them in its own turn. The plugin then runs recorded verification commands against the resulting working artifact. An independent Reviewer inspects the actual changes, original acceptance criteria, test quality and outputs. A failed verification goes directly back for diagnosis, without spending a Reviewer turn on known failed tests. Review failures trigger corrections; after the configured number of corrections, the Planner diagnoses implementation assumptions, verification commands and dependencies, then execution continues. This threshold no longer terminates goal execution.

The default budget is **30 agent turns / 2 hours** (`goalMaxTurns`, `goalTimeBudgetMs`), including formatting repair turns. The panel shows turns and replans. Pause remains available; a native turn already accepted may finish. A time limit preserves an in-flight operation rather than blindly replaying it. At a stopped checkpoint, **Poursuivre jusqu’à l’objectif** renews the budget and starts a Planner diagnosis using existing evidence. Continuing a selected phase also explicitly renews its goal budget.

Goal mode explicitly authorizes the Planner's verification commands and subsequent command corrections. The first plan approval is honored; subsequent replans record a version and configuration approval. A Builder may return optional `tests` commands with its report to correct a broken invocation. Explicit launch commands take precedence. An empty suite still requires explicit acceptance, and neither a command correction nor a replan counts as successful verification. Review checks the original approved acceptance baseline as well as the current plan.

Malformed reports are not implementation failures. A single valid fenced JSON report surrounded by prose is accepted, as is harmless whitespace around report keys. Conflicting results and key collisions are rejected. Other invalid reports receive at most two formatting-only turns, with a repository fingerprint guard; these turns cannot repeat implementation work. Exhausted repairs remain visible for intervention.

Goal recovery reconciles saved operations after plugin reloads or transport reconnection. Active turns are observed without new sends; uncertain acceptance is never retried as a new operation. Authentication, permissions requiring a human response, unknown operation outcomes and interrupted test commands with uncertain effects can still require intervention. These are displayed explicitly; they are not reported as success.

## Context and native skills

Hand-offs carry role-specific artifacts and bounded diffs and failure logs. Acceptance and verification appear before long plan prose so truncation cannot hide them behind a large summary. Enabling goal mode in the UI also enables automatic restart recovery and fresh sessions per correction. Each new review uses an independent session. Existing user changes, repository boundaries and index ownership are preserved; the artifact is identified by its verified working-tree fingerprint, with no automatic commit or publication.

Each selected native session advertises its own skills through the official SDK `commands()` API. The plugin selects at most eight relevant names/descriptions for that task, bounded to 4 KiB; agents read and apply the skill through their own tools. Discovery has a two-second fallback and cannot block an otherwise usable harness. Skills are not copied between providers or installed/changed automatically. Metadata discovery is an aid, not proof that a model applied a skill: the live case below checks actual report markers from different native skill files.

## Live cases, 20 October 2026

All cases used a separate Paseo 0.11.2 daemon and disposable repositories, with **Claude Sonnet → Codex GPT-6.1-Sol → Claude Sonnet**, native Builder auto-accept and real model turns. No mock responses substituted for these turns.

1. **Review refusal and autonomous replan.** The first Builder was explicitly instructed to implement only trimming in a function whose requirements also included whitespace collapsing, lowercasing and input errors. The first Reviewer independently rejected it. Planner diagnosis, a new Builder turn and an independent review followed without a manual action. Completed in **114.6 seconds / six model turns / one replan**. Nine behavior tests passed. Both the staged/unstaged user file and the exact Git index SHA-256 were preserved. Evidence: `/tmp/teams-goal-live-M4HXLT/{result.json,workflow.json}`.
2. **Invalid verification path and reload during a Builder turn.** The initial plan deliberately used a nonexistent test file, while the Builder implemented and tested the correct behavior. The isolated plugin was reloaded while that Builder operation was running. Recovery continued, the failed verification returned to the Planner, the command was corrected, and tests and review completed without a manual workflow action. The polling test client encountered the expected temporary RPC unavailability during reload; observation was reconnected without creating or resuming a workflow. Evidence: `/tmp/teams-goal-live-cnImvD/{result.json,workflow.json,reload-proof.json}`. Staged entries and user file contents were preserved; the first case separately verifies the exact index byte hash.
3. **Native skills.** Dedicated skill fixtures live under each harness's native project skill directory. The selected session's SDK inventory was checked separately. An initial run exposed a Reviewer that skipped its skill; the independent-read instruction was strengthened. The final run completed in **58.0 seconds / three model turns**, with fourteen behavior tests passing. All three role reports contain the marker from their own native skill file; tool-call history separately verifies each read. Exact Git index and user file hashes were preserved. Evidence: `/tmp/teams-goal-live-8S84zS/{result.json,workflow.json,skill-proof.json}`.

The real web UI was exercised on desktop and a 390×844 mobile viewport: goal toggle, budget selection, execution counters and configuration render without browser errors or horizontal overflow. This is browser validation, not a new physical iOS test. These fixtures validate orchestration behavior on small tasks; they do not establish universal model reliability or a measured token-cost reduction.

## Repeat the small live correction case

Install the plugin in an isolated daemon with Claude and Codex authenticated. Then run:

```sh
PASEO_TEAMS_SMOKE_URL=ws://127.0.0.1:17677/ws node scripts/smoke-goal.mjs
```

This runs real providers and consumes model tokens. The script refuses the primary port 6767, creates its own disposable Git repository, injects a first-turn defect, and requires a review refusal followed by autonomous replan/correction and successful verification. It compares the exact initial user-file and index hashes and saves evidence under the printed temporary directory. It neither starts nor reconfigures a daemon.
