# Isolated validation — 2026-10-19

Tests ran against a separate Paseo 0.11.2 daemon home, state directory, loopback port and disposable Git repository. No existing project was used as the execution target. The primary Paseo configuration remained unchanged throughout these tests.

## Real provider pipeline

| Role | Harness | Model | Permission mode |
| --- | --- | --- | --- |
| Planner | Claude Code | Opus 5.5 | plan |
| Builder | Codex | GPT-6.1-Sol | auto |
| Reviewer | Claude Code | Sonnet 5.5 | plan |

The fixture was an ESM module with an unimplemented integer addition function and existing node:test assertions. Protected fixture files included a README with staged and unstaged changes, an untracked user note, the tests and package manifest.

The approved verification ran the real tests followed by an external, deterministic one-shot failure gate. The gate only activated during the plugin's verification phase, so an agent running the same command while building could not consume it. This was a synthetic verification failure to exercise orchestration, not a claim that the reviewer discovered an organic code defect.

Observed sequence:

1. Planner returned schema-valid JSON; the test driver approved the plan and verification command.
2. Builder implemented the addition function.
3. First plugin verification exited **1**; Reviewer returned **fail** with actionable feedback.
4. The same Builder session received the failure and correction context.
5. Second verification exited **0**; the same Reviewer session returned **pass**.
6. Workflow completed with **one correction cycle**: one planner turn, two builder turns and two reviewer turns, reusing the original three agents.

The protected files remained byte-identical, and the staged diff was unchanged. Git may refresh index metadata during native agent commands; index bytes are not a semantic staging invariant. Agent sessions now also receive `GIT_OPTIONAL_LOCKS=0` to avoid optional Git index refreshes.

## Manual handoff and persistence

A separate Manual Switch workflow passed the task to Codex, which changed only the implementation file and ran the existing tests successfully. The protected files and index bytes were unchanged in that run. Native sessions and logical workflow state survived daemon and plugin reloads.

For automatic recovery, the driver observed acceptance of an operation in the native timeline, reloaded the plugin while that turn was active, and then watched the persisted state without polling any plugin RPC. The workflow completed its handoff response, retained a recovery cursor, and recorded **exactly one dispatch**. No second prompt was sent. The driver then explicitly closed the workflow to release its repository lock.

## Actual client checks

Chromium loaded the real web client from the isolated daemon. The Command Center opened Agent Teams, provider/model discovery populated the form, workflow history rendered and native progress cards appeared in the planner timeline.

The panel also rendered at **390 × 844**, with discovered models, no page JavaScript errors and no document-level horizontal overflow. These checks cover the web client and responsive layout, not native iOS/Android execution.

## Integration findings and fixes

- **Expired Claude OAuth:** the provider returned an authentication failure as an assistant message with an idle SDK result. It is now surfaced as a provider error. Testing resumed only after the user restored authentication.
- **Native plan approval:** Claude attempted `ExitPlanMode`, which could block a pipeline role. Read-only Claude sessions now disable editing/plan-transition tools and explicitly return results to the plugin's approval checkpoint.
- **Presentation separators:** Codex final replies sometimes started with a Markdown horizontal rule. The parser accepts that presentation wrapper and fenced JSON, while still rejecting prose, trailing explanations and invalid stage payloads.
- **Model entitlement:** Fable 5.1 was discoverable but required usage credits on this account. This is surfaced as a provider error; the plugin does not silently substitute models. The test driver explicitly selected Sonnet for the successful run.
- **Shutdown race:** an old engine could persist `Daemon client closed` during plugin teardown, preventing recovery. A closed engine now leaves its accepted operation intact. Both a regression test and the repeated live recovery scenario passed.
- **Fresh Git installs:** the manifest prepares the pinned production SDK dependency when it is absent. Existing developer dependencies are not pruned by a reload.

Every code finding has automated coverage. Typechecking and 33 automated tests passed after these corrections. A fresh Git installation of revision `4171e0d` also reached `running`, compiled both entries with only its production SDK dependency installed, and served the catalog RPC successfully. The same pinned revision was then installed into the primary daemon by reloading configuration; its supervisor and worker PIDs were unchanged. The installation health check confirmed that the client bundle and RPC were available and that isolated workflow data had not been imported.

## Separate account provider discovery

An additional isolated-daemon check registered `claude-alias-test` extending Claude. The plugin catalog returned the distinct provider ID, its display label, 19 discovered models and Claude's `plan` mode. The updated typecheck and all 35 automated tests passed, including alias selection in the compact iOS host mock and preservation of the alias plus read-only restrictions at agent creation. This check did not launch an agent or verify a second account's credits. At that point, the primary installation remained pinned to the earlier revision; the later multi-harness deployment is recorded below.

## Mobile access and Codex review follow-up

The user's iPhone screenshot confirmed that the installed workspace panel renders in native iOS. It also exposed a disabled start button with an empty Codex reviewer mode. The updated panel explains incomplete configuration, and the catalog offers a plugin read-only permission backed by Codex's native sandbox options when only `auto` is advertised. A real Codex review on the isolated repository returned a passing JSON verdict; the daemon trace recorded a `read-only` sandbox. All 38 automated tests and typechecking passed.

A real compact Chromium session opened a native agent from the panel, found the new Agent Teams composer button and used it to reopen the panel. There were no page errors or horizontal overflow. This button opens the existing workflow UI; the SDK does not provide a model-picker contribution point. Native iOS interaction with this new button still requires confirmation on the phone.

## All-harness discovery

The isolated plugin catalog was checked against the real daemon provider inventory. It included Claude, Codex, Copilot, OpenCode, Pi and a custom Claude alias, preserving discovered model IDs and modes. OpenCode returned its detected free-model catalog and native Plan mode. Pi returned no model or mode IDs; its explicitly labelled default choices omit those values at launch. Typechecking and all 41 tests passed, including generic model IDs containing slashes, launch defaults, compact role selection and instruction-only repository-change detection across recovery. This does not claim successful execution of every provider/account/model combination.

## Final deployment

Commit `1696271` was installed from Git into the isolated daemon and reached `running`, then installed into the primary daemon after confirming there were no unfinished plugin workflows and backing up its configuration. The primary plugin health check reported the expected revision, a compiled client bundle and no imported isolated workflows; supervisor and worker PIDs were unchanged. CI passed for that code revision. A compact browser test on the Git installation selected Codex review with its read-only permission and confirmed the start button enabled, then selected Pi with its explicit instruction-only permissions; there were no page errors or horizontal overflow.

## Workspace and desktop compatibility correction

A native screenshot exposed a launch attempt from `/home/razer/Projects/paseo`, which is a non-Git parent of the plugin repository. The catalog now runs a Git preflight, explains this requirement and suggests accessible immediate child repositories without initializing or cleaning any directory. The panel blocks launch until preflight completes. Its repository button uses the public workspace API and opens Agent Teams in the selected repository. An actual desktop-width browser test confirmed the parent was blocked, the button opened the child repository, and launch became available after entering a task, without page errors or any agent execution.

The previous `<0.12.0` manifest ceiling excluded the connected desktop version. The official 0.11.2 and 0.12.0 SDK client contracts, button contracts and server contracts used here were compared and were identical. The manifest now permits `>=0.11.2 <0.13.0`; a regression test runs Paseo's official compatibility checker against daemon 0.11.2, mobile 0.11.4 and desktop 0.12.0. Typechecking and all 43 tests passed. The physical desktop's rendering still requires confirmation after this update.

## Planner-selected autonomous tests

At the user's request, autonomous and final-validation workflows no longer require a predefined list of test commands to launch. The Planner chooses commands after inspecting the repository; the plugin runs that plan automatically. Explicitly supplied launch commands remain an optional override. The UI explains this default. Tests cover launch with an empty command list, execution of planner-selected tests under both policies, preserved explicit overrides, and a pause when the Planner proposes no tests without an explicit no-tests acceptance. Typechecking and all 46 tests passed.

## Single-thread Team Auto, default team and FR/EN — 2026-10-23

A separate Paseo 0.11.2 daemon (`127.0.0.1:6891`, home and repository under `/tmp/teams-subagents-v8gD`) loaded the plugin from this directory, with `PASEO_AGENT_TEAMS_DAEMON_URL` and `PASEO_AGENT_TEAMS_DATA_DIR` pointing to that daemon and its own state. Real roles: Claude Code Opus 5.5 (Plan), Codex GPT-6.1-Sol (Code), Claude Code Opus 5.5 or Sonnet 5.5 (Review). The fixture was an ESM `add(a, b)` stub with an existing `node --test` suite.

- **One thread.** Four missions ran in a Team Auto thread: Plan row, native task list, plan-ready message, **go**, Code row with its real tool calls, `node --test` Shell row, Review row and the mission summary. Each sub-agent row went from running to completed in place.
- **Role sessions as subagents.** Planner, builder and reviewer sessions carried `paseo.parent-agent-id` set to the Team Auto agent. The web client listed them under **3 subagents** above the composer and opened no role tabs.
- **Restart.** After a daemon worker restart, the replayed thread matched the previous one, including the user's **go** and the plan-ready message. The first attempt lost those messages, because Paseo rebuilds the thread from the provider replay; they are now recorded in the session persistence.
- **Default team.** Saving Review = Sonnet 5.5 through the settings RPC made a new Team Auto session open with `Plan · Opus 5.5`, `Code · GPT-6.1-Sol`, `Review · Sonnet 5.5`. The settings page rendered with Paseo's native settings components; **Modifier l’équipe par défaut** in the Team card opened it.
- **Language.** Choosing **English** in the settings page switched the page immediately. A new mission then ran in English, with English Team card and composer modes (`Approve the plan`).
- **Client checks.** Desktop (1440 px) and 390 px web viewports, no page errors. The Team card initially clipped its third role on desktop; its width was reduced.

Follow-up checks on the same daemon, the same evening:

- **Permission from the subagents list.** With Code on Claude Sonnet 5.5 in its `default` mode, the thread announced the pending permission; the **1 working** pill listed the Code session, which showed Paseo's native diff with **Deny / Accept**. Accepting three requests (an edit and two test runs) from that UI resumed the mission each time.
- **Correction cycle.** A one-shot verification failure, active only in the plugin's reduced test environment, made the first `sh check.sh` exit 1. The thread showed the failed Shell row, the review's requested changes, “Correction 1/1: review rejected. Back to Code.”, a second Code row, `sh check.sh` exiting 0, a passing review and the summary. Only `math.js` changed.
- **Live language change.** Switching the language from the Team card's settings link renamed the pill in that client without a page load. A second open client kept the old label until reload, so each client now follows the host setting every ten seconds; it then switched within fifteen seconds. Its card and panel followed too.
- **Duplicate rows found and fixed.** That language change re-emitted finished sub-agent rows, which Paseo showed twice (five rows became ten): it merges a tool call only within the native turn that started it. Finished rows are now never re-emitted; after a restart and a new language change the thread kept five rows.
- **English on mobile.** At 390 × 844: thread, Team card, advanced panel, its configuration, export (JSON shown) and import, and the settings page, without horizontal overflow or page errors. The card repeated the sheet's own “Team” title on compact layouts; it is now hidden there.

Not checked for real: native iOS/Android apps. The primary daemon was only reloaded with the plugin after its single unfinished workflow was confirmed idle.

## Remaining limits

Native iOS panel visibility was confirmed by the user; complete workflows on native devices and every model/account combination have not been tested. Codex does not advertise a `read-only` mode on this daemon; the plugin now supports its native read-only sandbox options instead. A subsequent real Codex review completed with a passing JSON verdict, and the daemon trace confirmed `sandboxPolicyType: read-only`. Ambiguous operations still require intervention by design; a missing completion receipt is never treated as permission to resend.
