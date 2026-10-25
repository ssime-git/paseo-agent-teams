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

Graph dispatch completion is captured from the official `agent.turn_ended` hook only. Paseo 0.13 sends an empty hook timeline: `completedTurnTimeline` reads history through the official hook context SDK, scoped to the hook's exact turn ID. It validates workspace identity before and after reading, stable epochs, non-overlapping pages and complete turn boundaries, with a maximum of ten 100-entry pages. Missing IDs/history, later turns, multiple prompts, reset/gap/stale pages and read errors leave the operation unresolved. Unknown agents do not trigger history reads. The hook outcome remains the completion proof; fetched assistant text or an idle agent cannot manufacture it. The checkpoint stores the native agent, saved send attempt, turn ID, terminal outcome and final assistant text read from that identified native turn. Capture requires one exact saved user prompt in that turn and matching workspace/session; ambiguous or oversized output leaves the operation pending. Duplicate receipts are idempotent, conflicting receipts are rejected. A receipt survives restart but does not resolve the activation, validate an artifact, verify read-only behavior or release the repository reservation. Missing hooks remain uncertain and never authorize resending. Graph launching is still internal.

The internal `GraphCheckpoints.assessReceipt` boundary stages a typed result from that saved receipt in a separate immutable revision. It distinguishes valid artifacts, invalid output, native failure and cancellation. Parsing accepts the existing presentation separator/fence normalization, but never extracts JSON from surrounding prose. Loading recomputes the assessment from the exact saved receipt and step contract; a conflicting result is rejected. Missing receipts remain pending. Assessment is idempotent across restart and does not dispatch, run commands, resolve an activation or release its reservation. A valid model result is still only a candidate: production launching still needs orchestration of the independent evidence and consumption boundaries below. Existing checkpoints without assessments and V1 workflows retain their semantics. This boundary has no RPC or UI launcher yet.


Read-only graph sends now persist a SHA-256 repository baseline with the unique send attempt, before native I/O. `verifyGraphIntegrity` checks the reserved repository through the official workspace API, snapshots its root (even for a nested workspace) and publishes a separate immutable observation after a saved terminal receipt. The snapshot uses the V1 bounded working set: HEAD, index/staged diff, unstaged diff, tracked and non-ignored untracked file contents, modes and symlink targets; ignored files are excluded. The 20 MiB snapshot budget fails closed before sending. Existing attempted operations without a baseline remain readable but cannot acquire retroactive integrity evidence or be resent.

A matching observation is historical evidence, not a continuous filesystem monitor or permission to transition. A mismatch remains saved after restoration; no files are automatically restored and no graph result is resolved. Replay returns the original observation. The consuming boundary described below enforces this evidence and rechecks the working set at the transition boundary; model-reported tests are still not independent test evidence. This module remains internal, without a graph launcher or additional interface.

Independent graph tests are staged by internal `runGraphTests`, with no launcher or transition API. Steps may explicitly save 1–10 commands, each with a 100 ms–30 s timeout and a combined timeout budget of 120 s. Human steps cannot carry commands. Existing definitions without `tests` remain unchanged; missing tests never become an implicit passing result. Model plan commands are not executed through this boundary.

Execution requires a saved valid native assessment, workspace/repository identity and, for read-only steps, matching durable integrity evidence plus a fresh fingerprint. An immutable claim with a unique test attempt and repository fingerprint is published before shell execution; concurrent callers cannot both execute. Commands run sequentially at the reserved Git root using the existing V1 bounded-output/process-group timeout runner and its environment filtering. Completion stores exact command results, errors and a final repository fingerprint. Command side effects are recorded, never restored. Loading validates command order, timeouts, output budgets and linkage to the activation's native evidence. A saved claim without completion is uncertain after restart and never automatically rerun. Failures, timeouts, truncation, absent tests and changed fingerprints remain blocked at the consuming boundary; this staging boundary does not resolve an activation or release its repository reservation.


Internal `consumeGraphResult` consumes exactly one saved valid native candidate. It refreshes the workspace/repository fingerprint and atomically publishes the structured result, consumed fingerprint and derived transition in one immutable revision. It never sends a native prompt, runs a command or reserves the next activation. The evidence must include a completed receipt, valid assessment, explicit independent tests with all commands successful (no errors, timeouts or truncation), and matching fingerprints before/after tests and at consumption. Read-only steps additionally require their durable unchanged integrity observation. These fingerprints cover the declared Git working set, not ignored files or external tools; the plugin reservation does not prevent external filesystem edits.

A stale retry observes the saved consumption without new filesystem validation or another transition, including after restart. Concurrent consumers arbitrate on the same immutable revision. A completed build with remaining work or a failed review retains its failure outcome when its independent tests pass. Missing tests (including old definitions), uncertain claims, failed tests, native failures and changed repositories stay reserved with their existing evidence and an explicit error; no no-test approval or technical-failure transition is inferred. Handling those test cases as authorized graph decisions and connecting the human/clarification boundaries to authenticated user submissions remain necessary before a production launcher.

New native attempts cannot use the old low-level `resolve`/`resolveArtifact` path to bypass consumption. Historical checkpoints without consumption evidence remain readable and keep their original results; no proof is invented retroactively. New consumption records validate their evidence again on load. V1 workflow files and operations are unchanged. There is still no graph-launch RPC, background loop or separate UI.


Human graph gates have an internal explicit-input boundary, `GraphCheckpoints.decideHuman`. It atomically persists a unique decision ID, approve/reject outcome and nonempty reason with the derived transition in one immutable revision. A pending human activation survives restart and keeps the repository reservation. No timeout or model artifact invokes this boundary, and it never dispatches the next step. Identical retries return the saved state even with a stale revision; conflicting decisions and IDs reused on another activation are rejected. Load validates that the saved decision matches the human result. Historical human results without decision metadata retain their original semantics and cannot be relabelled through this API. This is not an authenticated user submission endpoint: the future Team/native adapter must establish explicit human input. No graph RPC/UI was added.


Les étapes `plan` en lecture seule peuvent désormais rendre le contrat structuré de clarification existant (2–3 options, compromis, recommandation et réponse libre). `assessReceipt` conserve la demande dans une révision immuable et passe à `waiting_human`, uniquement après preuve durable d’intégrité inchangée. Aucun résultat final, test shell, choix implicite ni étape suivante n’en découle. Les évaluations historiques `invalid` restent lisibles sans réinterprétation.

`GraphCheckpoints.answerClarification` enregistre une réponse explicite par question et par révision. Les réponses partielles restent en attente ; les doublons identiques se rejouent, les contradictions ou options inconnues sont refusées, et les clients concurrents arbitrent sur la même révision. Après la dernière réponse, le graphe redevient `ready` sur **la même étape** (ou `exhausted` si son budget est épuisé). Une nouvelle activation réserve une nouvelle opération, sans renvoi du premier prompt ; le prompt conserve les demandes, options et réponses antérieures. Chaque tour de clarification compte dans le budget d’activations. Les checkpoints et opérations V1 sont inchangés. Cette frontière reste interne : le futur adaptateur Team/natif doit authentifier la réponse humaine ; aucun nouveau RPC, écran ou boucle de modèles n’est exposé ici.

`GraphCheckpoints.rejectTests` permet désormais un rejet humain explicite des tests absents, non lancés, incertains ou échoués d'une activation native évaluée valide. La raison technique est dérivée des preuves sauvegardées ; un identifiant unique et un motif humain borné sont persistés avec un résultat `failure` sans artefact dans une seule révision. Les preuves natives et les résultats shell restent intacts. La transition d'échec configurée et le budget d'activations s'appliquent ; aucune correction n'est lancée automatiquement. Le contexte d'une correction conserve décision et preuves des tests rejetés. Une complétion tardive d'une tentative incertaine déjà rejetée est refusée.

Cette frontière interne ne permet aucune approbation ni dérogation aux tests. Les tests réussis ne sont pas assimilés à un blocage ; une empreinte périmée reste à traiter séparément. Replays identiques, portée workspace, concurrence et contradictions suivent les révisions immuables existantes. Les anciens checkpoints restent lisibles sans métadonnée inventée. Le raccordement à une soumission humaine authentifiée Team/natif et l'acceptation explicite de l'absence de tests restent à livrer avant lancement produit.
