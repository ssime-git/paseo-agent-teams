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

## Remaining limits

Native iOS/Android devices and every model/account combination have not been tested. On this daemon, Codex does not advertise a `read-only` mode, so Claude supplies the read-only roles. Ambiguous operations still require intervention by design; a missing completion receipt is never treated as permission to resend.
