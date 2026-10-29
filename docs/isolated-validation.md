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


## 25 octobre 2026 — décisions humaines de graphes

Daemon officiel 0.11.2 isolé à `127.0.0.1:6898`, home/dépôt/données dans `/tmp/teams-human-live-s1qa4ae2`, plugin running. Script `/tmp/teams-human-live.mts` : ouverture d'un workspace via le SDK officiel, graphe humain seul, réservation persistée `waiting_human`, seconde admission du dépôt refusée. Après arrêt puis redémarrage du seul daemon isolé : checkpoint identique, rejet explicite enregistré par l'API interne `decideHuman`, statut failed, reprise idempotente via nouveau Store et ancienne révision, approbation contradictoire refusée. Zéro agent natif créé ; aucun test avec modèle, navigateur ou mobile revendiqué. Daemon isolé arrêté en fin d'essai. Preuves `pending.json`, `decided.json` dans cette racine, logs `/tmp/teams-human-live.log`, `/tmp/teams-human-live-restart.log`. Premier essai interrompu sur une assertion du harnais utilisant `.length` au lieu du champ officiel `.entries.length` ; correction puis reprise du checkpoint existant, sans effacer de réservation. Cette preuve exerce une vraie connexion daemon et une vraie reprise disque, mais la décision passe directement par le moteur interne : elle ne valide pas un parcours humain dans Team ou en session native.

`npm run check` : 244 tests réussis. Les trois tests ajoutés couvrent décisions atomiques/reprise, accès et révision, entrées invalides, métadonnées incohérentes, conflit concurrent, rejet puis correction et non-réutilisation d'identifiant, compatibilité des résultats historiques sans provenance. V1 reste inchangé. ENV-001 reste ouvert ; aucun reload ou redémarrage principal.


## 25 octobre 2026, 08:40 — clarifications persistantes de graphes

Daemon officiel **0.11.2** isolé à `127.0.0.1:6899`, plugin running, home/données/dépôt jetables `/tmp/teams-clarification-live-4rsi5b6e`, voix/dictée/relais désactivés. Un seul tour **Codex GPT-6.1-Sol**, modèle découvert via SDK officiel, sandbox read-only, attente bornée à 45 secondes : deux questions structurées avec options/compromis/recommandation, reçu completed du hook officiel, intégrité inchangée, statut `waiting_human`, seconde admission du dépôt refusée. Après arrêt puis démarrage du seul daemon isolé : checkpoint profondément identique, réservation suivante et renvoi natif refusés pendant l’attente. Réponses libres explicites soumises par le harnais via la frontière interne, reprise idempotente via nouveau Store/ancienne révision, retour sur la même étape sans artefact final. Nouvelle activation réservée et prompt vérifié avec contexte complet, sans lancer ce second tour. Timeline : exactement un message utilisateur ; un seul agent natif. README inchangé. Daemon isolé arrêté, statut stopped confirmé.

Script `/tmp/teams-clarification-live.mts` ; preuves `receipt.json`, `pending.json`, `resumed.json`, `discovery.json` dans cette racine ; logs `/tmp/teams-clarification-live.log`, `/tmp/teams-clarification-live-restart.log`, `/tmp/teams-clarification-live-daemon.log`, `/tmp/teams-clarification-live-restart-daemon.log`. Ces résultats ne prouvent pas encore une réponse depuis l’interface Team ou un import de message humain natif : les réponses sont entrées explicitement par l’API moteur interne. Aucun essai Claude/navigateur/mobile revendiqué pour cet incrément.

`npm run check` : **248 tests réussis**, dont quatre nouveaux tests disque couvrant attente/reprise/contexte, réponses partielles et libres, doublons/conflits, permissions/révisions/entrées, corruption, concurrence, budget épuisé et lecture des anciennes évaluations invalides sans réinterprétation. Les reçus et sessions de ces tests automatisés sont simulés ; le tour Codex ci-dessus est réel. Log `/tmp/teams-graph-clarification-check.log`. Principal : quatre workflows completed sans opération, empreintes SHA-256 identiques au passage précédent et PIDs 1923177/1923188 présents ; plugin toujours failed, ENV-001 conservée sans supposer de réponse, aucun reload/redémarrage ni changement global. Preuves `/tmp/teams-clarification-primary-state.json`, `/tmp/teams-clarification-primary-plugins.json`.

## 25 octobre 2026 — rejet explicite de tests bloqués

Daemon officiel **0.11.2** isolé à `127.0.0.1:6900`, home/données/dépôt `/tmp/teams-test-rejection-live-y7d5lm3i`, plugin chargé. Un seul tour **Codex GPT-6.1-Sol** découvert via SDK officiel, sandbox read-only, attente bornée à 45 s : reçu completed et artefact build valide, empreinte inchangée. Une commande sauvegardée explicitement dans la définition (`printf isolated-failure >&2; exit 7`, timeout 1 s) a réellement rendu code 7 et stderr attendu ; aucun résultat/transition automatique.

Après arrêt/démarrage du seul daemon isolé, checkpoint profondément identique. Rejet explicite via `GraphCheckpoints.rejectTests` : état failed selon l'arête configurée, preuves shell et natives conservées, replay identique via nouveau Store/ancienne révision, motif contradictoire refusé. Timeline avec exactement un message utilisateur et un seul agent natif. Script `/tmp/teams-test-rejection-live.mts`, preuves `pending.json`, `rejected.json`, `receipt.json`, `discovery.json` dans cette racine ; logs `/tmp/teams-test-rejection-live.log`, `/tmp/teams-test-rejection-restart.log`, `/tmp/teams-test-rejection-daemon.log`, `/tmp/teams-test-rejection-daemon-restart.log`. Daemon isolé arrêté après essai. Ceci valide la frontière interne avec un vrai résultat natif et shell, pas une soumission humaine depuis Team ou session native ; aucun essai Claude/navigateur/mobile revendiqué. Tests automatisés de reçu/session simulés distincts de cet essai réel.


## Paseo 0.13 migration — 25 October 2026

Latest official npm stable versions verified: `@getpaseo/cli`, `@getpaseo/plugin` and `@getpaseo/client` **0.13.0**. The CLI was already installed globally; both project SDKs were upgraded together, preserving their exact matching peer versions. App/daemon compatibility is now `>=0.13.0 <0.14.0`; earlier hosts are deliberately rejected rather than claimed compatible. No Paseo source, global installation or running primary daemon was modified.

`npm run check`: **257 tests pass**. Six new tests cover fetching the exact native turn after an empty 0.13 lifecycle hook, pagination, native completed/failed/canceled outcomes, workspace identity, missing or ambiguous history, resets/gaps/stale cursors, epoch changes, overlapping pages, cursor loops, the 1000-entry budget and a new active turn racing the read. Existing V1/pending-operation and graph regressions remain green.

Main isolated environment: official daemon 0.13.0 on `127.0.0.1:6901`, disposable home/data/repos in `/tmp/teams-013-live-9ye1uxr1`, explicit isolated plugin SDK URL, dictation/voice/relay disabled. The actual runtime initially exposed the 0.13 breaking change: `agent.turn_ended.timeline` is always empty, so the first actual Codex turn produced no graph receipt. Its unresolved operation was preserved, with no synthetic receipt or resend. After adapting the plugin to fetch history from the official hook context and exact turn ID, a new operation in a different disposable repository completed: Codex GPT-6.1-Sol read-only → official receipt → valid build → unchanged integrity → successful explicit independent shell test → one transition to Review. No Review activation was launched for that graph. After isolated restart and plugin reload, checkpoint equality and exactly one native prompt were verified, with consumed operations refusing sends/tests. Scripts `/tmp/teams-013-graph.mts`; evidence `before-adaptation-sent.json`, `before-adaptation-receipt.json`, `receipt.json`, `integrity.json`, `consumed.json`, `restarted-proof.json`.

Native Team Auto/V1: a separate repository, discovered Codex GPT-6.1-Sol for all three roles, mission to add only `greeting.mjs` and `greeting.test.mjs`. The first call correctly stopped for explicit approval of Planner-proposed shell commands, despite autonomous validation: missing launch-time command authorization never became implicit consent. Explicit test reply `go` then ran Code, independent `node --test greeting.test.mjs` (one test, exit 0), and Review (pass). The continuation client's 150-second wait timed out shortly before the backend Reviewer finished. Subsequent persisted state proved **completed**, three role dispatches, matching accepted review and passing verification; no model retry or extra role turn was launched. Stop requests after that completion returned zero active agents. The initial timeout assertions are retained as failed harness assertions, not described as successful synchronous waits.

After restarting only this isolated daemon and reloading only its plugin, the completed V1 workflow was identical, native commands/timeline reopened, and all three native children retained exactly one user prompt each. Scripts `/tmp/teams-013-native.mts`, `/tmp/teams-013-native-continue.mts`; evidence `native-awaiting-plan.json`, `native-timeout-workflow.json`, `native-workflow.json`, `native-restarted.json`, `native-children-proof.json`, `native-discovery.json`; logs `/tmp/teams-013-native*.log`. Two graph model turns plus three actual V1 role turns total; no Claude run claimed.

Real browser on the bundled official 0.13 web app, Chromium/Playwright: **1440×1050** desktop and **390×844** mobile viewport, completed mission, native Team Auto card, rendered tests/review, no horizontal overflow and no JavaScript errors. Screenshot `ui-mobile.png` was visually inspected. Evidence `ui-proof.json`, `ui-desktop.png`, `ui-mobile.png`, `/tmp/teams-013-browser.mjs`. Initial UI probes hit a disabled web UI (enabled only for the isolated daemon afterward), then navigated before host initialization; initializing the official web app before opening the deep link fixed the test harness. These are web viewports, not physical mobile apps.

Actual daemon-data upgrade test: copied a stopped disposable **0.11.2** home and graph state from `/tmp/teams-test-rejection-live-y7d5lm3i` into `/tmp/teams-013-upgrade-j0q99lqp`, opened the copy with official **0.13.0** at `127.0.0.1:6902`. Plugin loaded running; the existing native Codex session/workspace reopened with exactly one user prompt and the graph checkpoint remained deeply identical. No model turn or resend. Script `/tmp/teams-013-upgrade.mts`, `proof.json` under the upgrade root, log `/tmp/teams-013-upgrade.log`. Both isolated daemons were stopped after validation.

Four actual completed primary V1 files were separately copied for offline reading with the migrated Store. They remained byte-identical on disk; the pre-existing in-memory legacy plan-version normalization remained the only addition for older files. Proof `legacy-proof.json`, script `/tmp/teams-013-legacy.mts`. No primary files were written. Primary daemon PIDs **1923177/1923188**, version **0.11.2**, and SHA-256 of all four workflow files stayed identical (`primary-unchanged.json`). A protected backup of the daemon home and plugin data, excluding logs/sockets, was prepared outside the repository (`backup-proof.json`).

The user selected migration to latest, resolving ENV-001's version choice. Primary deployment is **pending explicit authorization to restart**, because the earlier instruction expressly prohibits restarting that daemon. The plugin is still unavailable there; a reload against the old primary daemon was not retried. See [migration procedure](paseo-013-migration.md). No roadmap completion or full custom graph launcher is implied by this version migration.


## Primary 0.13 cutover — 25 October 2026

After the user's explicit “Oui redémarre”, one official `paseo daemon restart` was issued. The conversation was interrupted during the command, so its empty CLI output was not treated as success. Subsequent direct checks confirmed the primary daemon is **0.13.0**, running/reachable, with its original server identity and supervisor PID 1923177, new worker PID 134766; Agent Teams is **running**, and the official SDK lists `agent-teams/auto`. The four workflow file hashes and scheduled task identities/names/statuses match their pre-restart values. No model turn or test workflow was launched against primary user repositories. Evidence: `/tmp/teams-013-primary-cutover-tt6hwnxx`, including `status-after.json`, `plugins-after.json`, `team-auto.json`, before/after state hashes and schedules. This completes the previously pending primary rollout, without implying completion of the remaining functional roadmap.


## 25 octobre 2026, 18:40 — exception explicite pour tests absents

Daemon officiel **0.13.0** isolé à `127.0.0.1:6903`, home/données/dépôt jetables `/tmp/teams-no-tests-live-iaiw_8vo`, plugin running, voix/dictée/relais désactivés. Script `/tmp/teams-no-tests-live.mts` : **un seul tour réel Codex GPT-6.1-Sol**, découvert via SDK officiel, sandbox read-only, attente maximale 45 secondes. Le hook terminé et son historique officiel produisent un reçu completed ; artefact build valide et intégrité inchangée. Aucune commande de test configurée : consommation ordinaire refusée, activation toujours réservée. Appel explicite à la frontière interne `acceptGraphWithoutTests` avec identifiant et motif : décision/empreinte/consommation atomiques, transition unique vers Review, aucun résultat shell inventé et aucune activation de Review.

Après arrêt/démarrage du seul daemon isolé, décision/checkpoint profondément identiques, replay depuis un nouveau Store avec ancienne révision, renvoi et exécution de tests sur l'opération consommée refusés. Timeline : exactement un message utilisateur ; README inchangé. Preuves `pending.json`, `decision.json`, `receipt.json`, `consumed.json`, `restarted-proof.json`, `discovery.json` dans cette racine ; logs `/tmp/teams-no-tests-live.log`, `/tmp/teams-no-tests-restart.log`, `/tmp/teams-no-tests-daemon{,-restart}.log`. Daemon isolé arrêté et statut stopped confirmé (`/tmp/teams-no-tests-stopped.json`). L'appel humain est effectué directement par le harnais interne : aucune soumission authentifiée Team/native, aucun essai Claude/navigateur/mobile revendiqué. Les tests unitaires de sessions simulées couvrent séparément concurrence, contradiction, corruption, empreinte périmée, tests configurés non contournables, résultats négatifs et budget fini.

## Orchestration incrémentale de graphes — 25 octobre 2026

Daemon officiel **0.13.0** isolé `127.0.0.1:6904`, home/données/dépôt `/tmp/teams-orchestration-live-ge7usybr`, plugin chargé, voix/dictée/relais désactivés. Script `/tmp/teams-orchestration-live.mts` : graphe personnalisé à une seule étape read-only et budget d'une activation, **un seul tour Codex GPT-6.1-Sol** réellement découvert, attente modèle maximale 45 s. Appels successifs à `advanceGraph` : réservation → préparation → envoi → reçu du hook officiel/historique → intégrité → évaluation → commande indépendante sauvegardée `test -f README.md && printf executor-verified` → consommation → succeeded. Chaque replay d'une ancienne révision retourne stale sans nouvelle action ; un seul message utilisateur natif, README inchangé, stdout et exit 0 conservés. Les étapes ne sont pas parcourues par une boucle de modèle ou une API produit : le harnais appelle explicitement la frontière interne.

Preuves : `stages.json`, `receipt.json`, `completed.json`, `discovery.json`, `proof.json` dans cette racine, log `/tmp/teams-orchestration-live.log`. Les tests unitaires `tests/graph-executor.test.ts` utilisent des sessions/reçus simulés, des checkpoints réels sur disque et des commandes shell réelles ; ils couvrent aussi les blocages, permissions, décisions humaines et budgets sans constituer une interaction réelle Team/native. Aucun écran ni essai navigateur/mobile/Claude ajouté par cet incrément.

Après arrêt/démarrage du seul daemon isolé : checkpoint terminal profondément identique, `terminal` à révision courante, `stale` à ancienne révision et un seul prompt dans l'historique natif. Preuve `restarted-proof.json`, log `/tmp/teams-orchestration-restart.log`. Daemon isolé arrêté en fin d'essai, statut stopped confirmé dans `/tmp/teams-orchestration-stopped.json`.

## 26 octobre 2026 — décisions explicites par RPC

Daemon officiel **0.13.0** isolé `127.0.0.1:6905`, home/données/dépôts `/tmp/teams-human-live-7zw1gfci`, plugin running, voix/dictée/relais désactivés. Script `/tmp/teams-human-live.mts` : workspace réel ouvert via SDK, harnais Codex et modèles détectés, **aucun modèle lancé**. Un checkpoint de test est créé par le harnais interne, avec une première étape humaine et une Review suivante. Le transport officiel `DaemonClient.invokePluginRpc` lit le checkpoint, refuse workspace étranger, décision manquante et ancienne révision, puis publie une décision explicite unique par `teams.graph_action`. Le graphe passe à ready/Review avec une seule activation ; aucune session Review n'est créée. Replay identique inerte, contradiction refusée, lecture depuis un nouveau Store identique, README inchangé et zéro agent.

Après arrêt/démarrage isolé : checkpoint profondément identique et replay de la même décision toujours inerte, zéro agent. Preuves `proof.json`, `restart-proof.json`, `discovery.json` dans cette racine ; logs `/tmp/teams-human-{daemon,restart}.log`, statut arrêté `/tmp/teams-human-status-stopped.json`. Les premières tentatives du harnais ont exposé deux erreurs du script (résultat SDK paginé traité comme tableau ; champs supplémentaires transmis au RPC de lecture strict), corrigées avant la réussite finale. Elles n'ont lancé aucun agent et ne constituent pas un défaut produit. Le premier checkpoint fixture reste dans son dépôt isolé ; aucun verrou supprimé pour relancer l'essai.

`tests/graph-actions.test.ts` couvre séparément les quatre actions, les réponses partielles puis libres, reprise disque, concurrence, contradictions, révisions, workspace absent/étranger et changement de dépôt. Ses reçus natifs sont simulés, les dépôts et checkpoints sont réels. `npm run check` : **274 tests verts**, typecheck/lint/format réussis (`/tmp/teams-human-check.log`). Aucun écran, parcours humain Team Auto, conversation native, Claude ou contrôle mobile revendiqué par cet incrément. L'authentification reste celle du transport RPC du daemon ; aucune nouvelle authentification individuelle n'est ajoutée.

### 26 October 2026 — saved graph admission and native Team ownership

Official daemon **0.13.0** at `127.0.0.1:6906`, disposable home/data/Git repository
`/tmp/teams-admission-live-gayt7i8x`. Script `/tmp/teams-admission-live.mts` uses the
real SDK and RPC transport to save a definition, discover Codex models and create
one actual native `agent-teams/auto` conversation without sending a prompt. The
admission RPC rejects false confirmation, an unknown owner and a missing revision.
Two concurrent identical requests return one ready checkpoint, with the exact saved
source and owner, zero activations. A later saved definition revision does not alter
the snapshot; contradictory replay and a second repository admission are rejected.
No model turn, independent shell test or native child session was launched.

After stopping and starting only this isolated daemon: admission replay and record
are deeply identical, the sole native session is still the Team owner, with no graph
activation. Evidence: `proof.json`, `restart-proof.json`, `discovery.json` in that root;
logs `/tmp/teams-admission-{daemon,restart}.log`. The isolated daemon was stopped
(`/tmp/teams-admission-status-stopped.json`). This is an actual RPC/session integration,
not a Team UI launch, model execution, Claude or mobile validation.

`npm run check`: **277 tests pass**, typecheck/lint/format succeed, log
`/tmp/teams-admission-check.log`. Three new automated tests use actual temporary Git
repositories/catalog/checkpoint files and simulated workspace/agent APIs. They cover
exact revision/commands, confirmation, owner/workspace scope, replay after reload and
progress, conflicts, concurrency and moved-workspace rejection. Primary plugin-only
reload succeeded, with the same daemon PIDs/identity/version and four byte-identical
workflow files (`/tmp/teams-admission-primary-{before,after,status-before,status-after,plugins,reload}.json`).


## 26 octobre 2026 — continuation explicite bornée par RPC

Daemon officiel **0.13.0** isolé `127.0.0.1:6907`, home/données/dépôt
`/tmp/teams-continuation-live-5bqchq9h`, voix/dictée/relais désactivés.
Script `/tmp/teams-continuation-live.mts` : SDK officiel, découverte Codex réelle,
conversation Team Auto native sans message et définition sauvegardée à une étape
humaine (budget 1). Admission explicitement confirmée puis vrai RPC
`teams.graph_advance` : propriétaire inconnu et champs supplémentaires refusés,
une seule réservation, attente humaine persistée, rejeu périmé inerte et appel
courant toujours en attente. Après arrêt/démarrage du seul daemon isolé : checkpoint
profondément identique, attente conservée et une seule session native. README intact,
**zéro tour de modèle** ; aucun test shell ni interface interactive revendiqué.
Preuves `proof.json`, `restart-proof.json`, `discovery.json` dans cette racine ; logs
`/tmp/teams-continuation-{start,restart,stop-final}.log`. Daemon isolé arrêté après essai.
La préparation/envoi/tests réels de l’exécuteur restent couverts par le passage
antérieur sur le port 6904 ; cet essai ne les revendique pas via le nouveau RPC.

### 26 octobre 2026 — récupération des graphes admis après reconnexion

Daemon officiel 0.13.0 séparé sur `127.0.0.1:6908`, home/état/dépôt dans
`/tmp/teams-recovery-live-agmm0bcu`, voix/dictée/relais désactivés. Script SDK/RPC
`/tmp/teams-recovery-live.mts` : deux conversations natives Team Auto sans message,
modèles Codex détectés, zéro tour de modèle. `teams.graph_list` renvoie la liste vide
avant admission, le snapshot exact après admission puis après réservation humaine ;
une autre conversation ne voit pas le graphe, un propriétaire inconnu et les champs
supplémentaires sont refusés. Après arrêt/démarrage du seul daemon isolé, la liste
retrouve le checkpoint profondément identique, toujours en attente sans décision ni
activation supplémentaire. README inchangé, deux sessions propriétaires seulement.
Preuves `proof.json`, `restart-proof.json`, `discovery.json` dans la racine ci-dessus ;
daemon isolé arrêté, `/tmp/teams-recovery-status-stopped.json`. Aucun essai UI,
mobile, Claude ou modèle exécuté revendiqué pour cet incrément de lecture.

## 27 octobre 2026 — statut des graphes dans le thread Team Auto

Commit produit `6a6b670`. Daemon officiel **0.13.0** isolé sur `127.0.0.1:6909`,
home/états/dépôt `/tmp/teams-native-graphs-live-nivhl9bz`. SDK et timeline natifs
réels ; modèles Codex découverts, **aucun tour de modèle** lancé.

`/team-graphs` avant une mission V1 renvoie une liste vide, puis affiche un graphe
humain explicitement admis par RPC et réservé en `waiting_human`. Une autre
conversation Team reste vide. Après arrêt/démarrage isolé, nouvel appel natif :
compte rendu présent et checkpoint profondément identique. Seulement deux agents
Team natifs, README inchangé. Script `/tmp/teams-native-graphs-live.mts`, preuves
`proof.json`, `restart-proof.json` et `discovery.json` sous la racine isolée.

Chromium réel, application officielle embarquée : **1440 × 1050** et **390 × 844**,
compte rendu français visible (version, révision, attente humaine et budget 1/1),
aucun débordement horizontal de page ni erreur JavaScript. Captures inspectées :
[desktop](screenshots/graph-status-desktop.png), [mobile](screenshots/graph-status-mobile.png).
Script `/tmp/teams-native-graphs-browser.mjs`, `ui-proof.json` et textes/captures
sous la racine isolée. Ces captures valident ce compte rendu français ; elles ne
valident pas le futur lanceur, l’éditeur ou les actions humaines. L’anglais et les
réponses partielles sont couverts par les tests automatisés, pas par ce navigateur.

Le premier essai natif a été refusé car l’URL de récupération du plugin isolé
n’avait pas été définie ; correction de l’environnement isolé avant réussite.
Les premiers essais navigateur recevaient HTTP 404 (interface web désactivée).
Activation de `features.webUi.enabled` dans le seul fichier de configuration
jetable, puis réussite. Aucun changement de configuration principal ou de Paseo.
Daemon isolé arrêté à la fin (`/tmp/teams-native-graphs-status-stopped.json`).

`npm run check` vert : **291 tests**, typecheck/lint/format ; six nouveaux tests
couvrent présentation, langues, limites, clarification partielle, accès et entrées,
rejeu persistant sans mission V1, coexistence V1 et erreur de projection qui termine
le tour. Sessions/API simulées dans les tests unitaires. Log
`/tmp/teams-native-graphs-check-verified.log`. Plugin principal rechargé seul après
contrôle d’inactivité : running, PID superviseur **1923177**, worker **134766** et
quatre états persistés SHA-256 inchangés. Preuves
`/tmp/teams-native-graphs-primary-{before,after,status-before,status-after,reload,plugins-after}.json`.

## 27 octobre 2026 — continuation explicite dans le thread Team Auto

Incrément `7e4a245` : `/team-advance UUID REVISION` appelle la continuation bornée
existante avec le propriétaire et le workspace natifs. La commande n'accepte ni
approbation ni réponse humaine ; une révision périmée ne progresse pas.

Daemon officiel **0.13.0** sur `127.0.0.1:6910`, racine
`/tmp/teams-native-advance-live-adv4tt3s`, home/états/dépôt isolés. Script
`/tmp/teams-native-advance-live.mts` : définition humaine sauvegardée et admise via
RPC, puis commande native créant exactement une activation. Une seconde commande
avec l'ancienne révision affiche « Révision périmée », une commande courante garde
l'attente humaine. Une tentative depuis l'autre conversation ne change pas le
checkpoint ; sa découverte reste vide. Après arrêt/démarrage du seul daemon isolé,
la commande conserve le checkpoint profondément identique et l'attente humaine.
Deux conversations Team, modèles Codex découverts, **zéro tour de modèle** et README
inchangé. Preuves `proof.json`, `restart-proof.json`, `discovery.json` dans la racine.
Le daemon isolé est arrêté (`/tmp/teams-native-advance-status-stopped.json`).

Application officielle embarquée, Chromium à **1440 × 1050** et **390 × 844** :
commande et compte rendu français visibles, aucun débordement horizontal ni erreur
JS. Captures inspectées : [desktop](screenshots/graph-advance-desktop.png),
[mobile](screenshots/graph-advance-mobile.png). Script
`/tmp/teams-native-advance-browser.mjs`, preuve `ui-proof.json` et captures dans la
racine isolée. Les captures finales ont été refaites daemon disponible après un
premier passage montrant une reconnexion pendant l'arrêt isolé. Aucun essai navigateur
en anglais ni envoi d'étape à un modèle revendiqué pour cet incrément.

`npm run check` final : **293 tests**, typecheck/lint/format verts, zéro échec
(`/tmp/teams-native-advance-check-verified.log`). Tests du provider avec backend
simulé : portée/propriétaire, révision exacte, rapport persistant et retransmission
après reconnexion sans nouvel appel, coexistence V1 sans approbation, arguments
invalides et refus du backend. La continuation réelle reste couverte par l'essai
natif humain ci-dessus ; la retransmission du même identifiant est un test unitaire.
Premiers contrôles corrigés : cast de fixture de présentation incomplet, puis entrée
anglaise manquante pour la description de commande, détectée par le test i18n.

Seul le plugin principal a été rechargé après vérification d'inactivité et contrôles
verts. Plugin running, PID superviseur **1923177**, worker **134766**, identité et
version inchangés ; les quatre états V1 gardent leurs SHA-256. Preuves
`/tmp/teams-native-advance-primary-{before,after,status-before,status-after,reload,plugins-after}.json`.

## 27 octobre 2026 — réponses aux graphes dans un modal natif du chat

Incrément `d2c9fdd`. Les nouveaux comptes rendus `/team-graphs` et `/team-advance`
exposent **Ouvrir les actions du workflow**. Le renderer ouvre `Modal` et `TextInput`
du SDK officiel 0.13.0, retrouve les graphes de la conversation et masque la saisie
technique des UUID/révisions/opérations. Il permet de répondre aux clarifications
(choix recommandé non présélectionné ou texte libre) et aux étapes humaines
(approbation/refus et motif), sans continuation implicite.

Daemon isolé 0.13.0 sur `127.0.0.1:6911`, racine
`/tmp/teams-response-live-r3rmhzbd`, voix/dictée/relais désactivés. Deux conversations
natives Team, découverte Codex officielle, zéro tour de modèle. Les scripts
`/tmp/teams-response-live.mts` et `/tmp/teams-response-pending.mts` créent des graphes
humains via les RPC officiels. Chromium ouvre le thread puis le modal à **1440 × 1050**
et **390 × 844** ; sélection par nom, envoi désactivé avant choix et motif, décision
mobile explicite réellement enregistrée. Aucun débordement horizontal ni erreur JS.
Captures finales inspectées : [desktop](screenshots/graph-response-desktop.png),
[mobile](screenshots/graph-response-mobile.png),
[réponse enregistrée](screenshots/graph-response-mobile-saved.png).
Scripts navigateur `/tmp/teams-response-browser{,-final}.mjs`, preuves
`modal-ui-proof.json`, `response-proof.json` et `pending-response-proof.json` dans
la racine. Premier essai navigateur arrivé trop tôt avant l'initialisation du host,
corrigé par l'attente d'initialisation déjà employée dans les essais antérieurs.

Le script `/tmp/teams-response-verify.mts resume after-restart` confirme, après
arrêt/démarrage du seul daemon isolé, la décision et le checkpoint profondément
identiques (`response-restart-proof.json`), avec une seule activation et aucun
second envoi. Le deuxième parcours conserve aussi la décision explicite dans
`pending-response-proof.json`. Daemon isolé arrêté à la fin
(`/tmp/teams-response-status-stopped.json`). Aucun vrai Planner/Claude, choix de
clarification produit par un modèle ou navigateur anglais revendiqué ici : le
parcours de clarification est testé avec backend UI simulé.

`npm run check` final : **296 tests**, zéro échec, typecheck/lint/format verts
(`/tmp/teams-response-check-release.log`). Trois nouveaux tests : composant réel avec
hôte simulé (choix recommandé, réponse libre, réponse partielle, fermeture sans envoi,
brouillon conservé après refus, portée exacte et absence de continuation), réponse
serveur sur checkpoints disque réels (propriétaire étranger refusé, décision explicite,
relecture/retransmission), carte native persistante avec repli texte sans capacité
`timeline.plugin`. Les fixtures initiales ont été corrigées après détection par les
contrôles de graphe (étape humaine read-only et aucune étape inaccessible), la
compilation du harnais React et le contrôle de traduction ; aucune frontière de
validation produit assouplie.

Seul le plugin principal a été rechargé après inactivité et contrôles verts. Running,
PID superviseur **1923177**, worker **134766**, identité/version inchangées et quatre
SHA-256 V1 conservés. Preuves
`/tmp/teams-response-primary-{before,after,status-before,status-after,reload,plugins-after}.json`.

## 27 octobre 2026 — carte automatique de réponse dans le chat

Incrément `a0a8f4f`. Sans commande utilisateur, les attentes des graphes admis et
les clarifications du Planner V1 affichent une carte **En attente de réponse →
Répondre** dans la conversation Team. Le bouton ouvre le modal avec la demande
persistée courante ; la carte d'un graphe cible ce graphe automatiquement. Les
anciens transcripts en attente sont enrichis de métadonnées sans effacer leur texte.
Les clients sans `timeline.plugin` conservent la restitution texte.

Daemon officiel **0.13.0**, `127.0.0.1:6912`, home/états/dépôt isolés sous
`/tmp/teams-auto-card-live-9c0dpp59`, voix/dictée/relais désactivés. Script
`/tmp/teams-auto-card-live.mts` : découverte officielle Codex, session Team chargée
par l'API de lecture des commandes natives (aucun prompt), admission/réservation
explicite d'un graphe humain. La carte est retrouvée dans la timeline sans message
`/team-graphs` ni `/team-advance` et sans tour de modèle (`graph-proof.json`). Ce
checkpoint a ensuite été approuvé explicitement par le harnais pour libérer le dépôt.

Deuxième phase : réglages du seul hôte isolé sauvegardés avec le RPC officiel des
settings, rôles sur le modèle Codex réellement découvert **GPT-6.1-Sol**. Un message
naturel à Team demande deux précisions avant tout plan. **Un seul tour Planner
réel**, deux questions structurées, carte native automatique et aucun envoi Builder.
Cinq agents natifs existent (deux conversations Team et trois sessions de rôles
préallouées) ; la session Builder existe mais sa timeline ne contient aucun message
utilisateur, sans tour actif. Ne pas confondre création d'une session et exécution.

Chromium **1440 × 1050** et **390 × 844** : carte visible sans saisie d'identifiant ou
commande, ouverture du modal, recommandation affichée sans présélection, réponse libre
mobile à la première question et seconde question toujours en attente. Zéro erreur JS
et débordement horizontal. Scripts `/tmp/teams-auto-card-browser{,-final}.mjs`, preuves
`planner-proof.json`, `ui-proof.json`, `ui-final-proof.json`, `partial-proof.json` et
`restart-proof.json` dans la racine. Le harnais de vérification
`/tmp/teams-auto-card-verify.mts` contrôle la réponse persistée, la seconde question,
l'absence de prompt Builder, le README intact et une seule carte après restauration.
L'arrêt natif met le workflow en pause selon le comportement V1 existant ; ses
réponses/questions restent conservées. Le second redémarrage depuis cette pause
conserve le workflow profondément identique, sans nouveau tour Planner ou Builder.

Captures finales inspectées après correction du rendu Markdown et attente de
l'animation native : [carte desktop](screenshots/automatic-question-desktop.png),
[carte mobile](screenshots/automatic-question-mobile.png),
[modal desktop](screenshots/automatic-question-modal-desktop.png),
[modal mobile](screenshots/automatic-question-modal-mobile.png). Le modal final montre
la seconde question après réponse partielle et redémarrage. Pas de navigateur anglais,
Claude, appareil iOS/Android physique ou résolution complète des deux questions
revendiqués pour cet incrément. Daemon isolé arrêté à la fin
(`/tmp/teams-auto-card-status-stopped.json`).

`npm run check` final : **300 tests**, zéro échec, typecheck/lint/format verts
(`/tmp/teams-auto-card-check-final-verified.log`). Quatre tests ajoutés : notification
durable sans mutation/annulation par un observateur, carte de graphe automatique sans
prompt/relecture seulement sur changement/reprise sans doublon, carte Planner
spontanée avec restauration d'un ancien transcript, contrôle propriétaire natif/dépôt
pour les réponses V1. Le test UI existant vérifie aussi le ciblage automatique du
modal graphe. Les tests unitaires simulent les APIs natives ; le parcours Codex et
navigateur décrit ci-dessus est réel. Fixtures et harnais corrigés lorsqu'ils
supposaient à tort qu'une session Builder préallouée devait être absente/idle après
arrêt, qu'une fermeture V1 ne produisait pas son action pause, ou omettaient le marqueur
d'opération requis dans une fixture. Le sélecteur navigateur a été précisé pour
distinguer le titre de question dans la carte et dans le modal. Aucun contrat produit
assoupli pour faire passer ces essais.

Seul le plugin principal a été rechargé après contrôles verts et inactivité : running,
superviseur **1923177**, worker **134766**, identité/version inchangées, quatre SHA-256
V1 conservés. Preuves
`/tmp/teams-auto-card-primary-{before,after,status-before,status-after,reload,plugins-after}.json`.

## 27 octobre 2026 — formulaires directement dans le fil, sans modal

Incrément `0c7d593`. Les cartes Planner V1 et graphes rendent automatiquement les
choix, le champ libre et **Envoyer la réponse** dans la timeline. Aucun composant
Modal ni bouton d'ouverture. Chargement initial en lecture seulement, rechargement
sur changement de contexte et actualisation explicite ; pas de polling ajouté.
Options à choix unique avec rôle `radio`, état `checked` et indicateur visuel,
aucune présélection. Les RPC et opérations persistées conservent leurs contrats.
Les cartes de graphe sont liées à leur activation pour ne pas présenter une
nouvelle question dans une ancienne carte.

Daemon officiel **0.13.0** isolé, `127.0.0.1:6912`, home/états/dépôts sous
`/tmp/teams-auto-card-live-9c0dpp59`. Cette fois, **aucun nouveau tour de modèle** :
réutilisation de la vraie clarification Codex persistée au passage précédent,
encore en pause avec sa seconde question en attente. Le script
`/tmp/teams-inline-setup.mts` lit cet état et crée un graphe humain sur un second
dépôt isolé `inline-graph-repo` (admission/réservation officielles, aucune exécution
modèle). La première requête avait bien été produite par Codex antérieurement ;
ne pas présenter ce passage comme une nouvelle génération réelle.

Le script `/tmp/teams-inline-browser.mjs` ouvre les deux conversations à
**1440 × 1050** et **390 × 844**, sans commande ni clic d'ouverture du formulaire.
Assertions DOM pour chaque champ : descendant de `agent-chat-scroll`, hors de
`overlay-root`, **zéro dialogue**, deux radios initialement non cochées, bouton
d'envoi initialement désactivé, zéro erreur JS et débordement horizontal. Sur
mobile, sélection de la recommandation + texte libre Planner puis envoi réellement
enregistré ; sélection d'approbation du graphe + motif puis envoi réellement
enregistré. Les captures ont été inspectées :
[Planner desktop](screenshots/inline-planner-desktop.png),
[Planner mobile](screenshots/inline-planner-mobile.png),
[graphe desktop](screenshots/inline-graph-desktop.png),
[graphe mobile](screenshots/inline-graph-mobile.png).
Preuves `inline-{planner,graph}-before.json`, `inline-ui-proof.json` et captures
`inline-*.png` dans la racine isolée.

`/tmp/teams-inline-verify.mts` relit les RPC : réponse Planner avec option/texte
exacts, deux réponses conservées, clarification résolue, workflow toujours en pause
selon V1 ; graphe succeeded, une activation et motif explicite exact. Après
arrêt/démarrage du seul daemon isolé, comparaison profonde du workflow et du
graphe : identiques (`inline-response-proof.json`, `inline-restart-proof.json`).
README des deux dépôts inchangés, timeline Builder vide et toujours un seul prompt
Planner historique. Aucun appel nouveau à Codex ou Claude, navigateur anglais,
appareil mobile physique ni reprise automatique après la pause revendiqués.
Daemon isolé arrêté (`/tmp/teams-inline-isolated-stopped.json`).

**Limite NATIVE-IDLE-001, à garder ouverte :** après redémarrage, le SDK peut ne pas
restaurer les cartes émises à l'état idle dans une conversation graphe créée par API
sans premier prompt utilisateur. Les réponses et le checkpoint sont conservés ;
l'historique natif peut être vide. Les lectures de commandes natives mises en cache
ne rouvrent pas nécessairement ce provider. Des appels explicites `/team-graphs`
ont servi au diagnostic dans la fixture seulement ; aucun prompt caché n'est ajouté
au produit ni au daemon principal. Une reconstruction locale de cartes depuis le
checkpoint a été essayée puis retirée : elle ne résout pas le cycle natif dormant.
Ne pas revendiquer de réparation de cette limite dans ce passage. La prochaine
intégration du lanceur doit traiter ce cycle avec les API officielles, sans modifier
Paseo. Traces `inline-graph-native-history.json` et `/tmp/teams-inline-verify-restart*.log`.

`npm run check` final : **301 tests**, zéro échec, typecheck/lint/format verts
(`/tmp/teams-inline-check-final-verified.log`), `git diff --check` vert. Nouveau test
UI Planner avec hôte/RPC simulés : formulaire visible au montage sans overlay,
radios non sélectionnées, réponse explicite, erreur conservant le brouillon,
double clic borné à un seul appel en vol, réponse partielle et changement de
clarification sans mélange de brouillons. Test graphe existant adapté au formulaire
inline et à la désactivation d'une ancienne carte d'activation. Harnais partagé ne
permettant pas de rendre un Modal. Contrôle i18n nettoyé des anciens libellés
d'ouverture/fermeture devenus inutilisés. Les tests temporaires du prototype de
reconstruction retiré ne sont pas comptés dans ces 301 tests.

Plugin principal rechargé seul après contrôles verts et inactivité. Running,
superviseur **1923177**, worker **134766**, identité/version inchangées, quatre
SHA-256 V1 conservés. Preuves
`/tmp/teams-inline-primary-{before,after,status-before,status-after,reload,plugins-after}.json`.


### 27 octobre 2026 — prévisualisation exacte avant admission

Daemon officiel 0.13.0 séparé sur `127.0.0.1:6913`, home, état et dépôt
`/tmp/teams-preview-live-nm7t34me`. Plugin chargé depuis le dépôt, provider Codex
et modèles découverts via l'API officielle ; aucun tour de modèle lancé.
Le script `/tmp/teams-preview-live.mts` vérifie les véritables RPC : sauvegarde,
prévisualisation sans réservation, modification du catalogue sans réinterprétation
de l'ancienne révision, refus d'une tâche/révision ne correspondant pas à l'empreinte,
confirmation explicite et réessai identique. Une continuation réserve uniquement
l'étape humaine ; après arrêt/démarrage du daemon isolé, confirmation et aperçu
renvoient les mêmes données, checkpoint en attente conservé et README intact.
Preuves locales : `providers.json`, `proof.json`, `restart-proof.json` dans cette
racine ; arrêt final `/tmp/teams-preview-isolated-stopped.json`.

Trois nouveaux tests dans `tests/graph-launch.test.ts` couvrent aussi schémas stricts,
propriétaire/dépôt modifiés, reprise et confirmations concurrentes dans l'unique Store
du plugin. `npm run check` : 304 tests verts, typecheck/lint/format verts
(`/tmp/teams-preview-check-final.log`). APIs unitaires simulées et dépôts/checkpoints
réels sur disque. Aucun navigateur, appareil mobile, Claude ou conversation modèle
revendiqué : interface inchangée, lanceur visuel et NATIVE-IDLE-001 encore ouverts.

## 29 octobre 2026 — compatibilité Paseo 0.14

L’application 0.14 rejetait le manifeste `>=0.13.0 <0.14.0` avant de charger
le client. La borne supérieure passe à `<0.15.0` ; les SDK restent en 0.13,
car les API utilisées sont conservées dans les paquets officiels 0.14 installés.
Les différences inspectées ajoutent notamment `session.can_stop_runtime`
(capacité non annoncée par Team), des champs aux hooks d’ouverture et
`agent.reload` ; aucun changement de données persistées n’est nécessaire.
Le test de compatibilité couvre les deux runtimes app/daemon en 0.13 et 0.14,
et refuse toujours 0.12, 0.15 et 1.0.

`npm run check` réussit : typecheck, lint, format et **346 tests**.
Log : `/tmp/teams-014-check-unsandboxed.log`. Une première exécution dans le
sandbox échouait sur trois tests de sous-processus ; la suite complète hors
sandbox passe sans modification de ces tests ni du moteur.

Essai réel : daemon officiel **0.14.0**, home, état du plugin et dépôt jetable
sous `/tmp/teams-014-compat`, port loopback 6914, relais désactivé. Le client
0.14 vérifie les exigences officielles app/daemon ; le SDK 0.13 du plugin
exécute le RPC `teams.workflow_index`, ouvre le workspace et une session native
`agent-teams/auto`, puis récupère commandes et timeline. **Zéro tour de modèle** :
il s’agit d’une preuve de chargement/intégration, pas d’un workflow de modèles
complet. Script `smoke.mjs`, preuve `smoke-proof.json` dans ce répertoire.

L’application web officielle 0.14 affiche la session Team et sa carte « Team
Auto » à **1440 × 1050** et **390 × 844**, sans exception JavaScript ni
débordement horizontal. Le navigateur ouvre d’abord la session sur desktop,
puis applique chaque viewport (pas de validation de la navigation mobile).
Preuves : `browser.mjs`, `ui-proof.json`, `ui-{desktop,mobile}.{txt,png}`.
Seul le daemon isolé a été redémarré pour activer son interface web.
