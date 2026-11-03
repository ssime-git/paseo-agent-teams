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

### 30 octobre 2026 — lanceur inline de définitions sauvegardées

- `674bdc8` : sélection nom/révision, objectif, prévisualisation officielle `teams.graph_preview`, définition intégrale et dépôt affichés, confirmation `teams.graph_confirm`. Modifier objectif/sélection invalide la prévisualisation ; une erreur réseau conserve l’identité de réservation pour la nouvelle tentative. La continuation reste distincte.
- `npm run check` : **347/347**, typecheck/lint/format verts. Le nouveau test de composant utilise un transport simulé et vérifie absence d’admission implicite, invalidation et nouvelle tentative idempotente. Log `/tmp/teams-roadmap-300840-check.log`.
- Daemon réel **0.14.0**, home `/tmp/teams-014-compat/home`, port **6914**, données `/tmp/teams-014-compat/state`, dépôt Git jetable `/tmp/teams-014-compat/repo`. Variables `PASEO_AGENT_TEAMS_DATA_DIR` et `PASEO_AGENT_TEAMS_DAEMON_URL` explicitement isolées. Aucun changement de Paseo.
- Chromium réel : commande native `/team-graphs`, sélection d’une définition sauvegardée par RPC, saisie d’objectif, prévisualisation à **1440 × 1050** et **390 × 844**, puis confirmation mobile. Pas de débordement horizontal ni d’exception JavaScript ; admission persistée **ready**, zéro activation, révision exacte. Relecture identique après rechargement du plugin isolé. Scripts `launcher-{setup,open,browser,verify}.mjs`, preuves `launcher-{proof,ui-proof,admission-proof}.json` et captures `launcher-ui-{desktop,mobile}.png`, `launcher-admitted-mobile.png` sous `/tmp/teams-014-compat`.
- Limites : ouverture de la session en desktop avant redimensionnement ; navigation initiale mobile non vérifiée. Un changement de taille peut remonter la carte et effacer son formulaire temporaire ; une nouvelle prévisualisation explicite est nécessaire. Affichage complet de définition en JSON lisible, éditeur et représentation visuelle du graphe encore à faire. Ce parcours n’atteste ni NATIVE-IDLE-001 ni une boucle de modèles personnalisée.
- Incident de harnais : démarrage initial sans variables d’isolation complètes, arrêté puis corrigé avant admission. Le premier envoi CLI de `/team-graphs` était un message texte, et a lancé un tour réel Claude Planner V1 dans le dépôt isolé ; il a demandé une clarification. Session interrompue, workflow de fixture clôturé par RPC officiel avec workspace/révision avant admission. Les commandes natives ont ensuite été sélectionnées dans l’UI. Ne pas annoncer « zéro tour de modèle » pour l’ensemble de cet essai ; seule l’admission n’en lance aucun.

### 30 octobre 2026 — lecture structurée du graphe avant confirmation

Le lanceur rend maintenant une carte par étape depuis la définition exacte reçue
par `teams.graph_preview` : entrée, budget global d'activations (répétitions et
étapes humaines incluses), contrat, accès, provider/mode, instruction, commandes
et délais de tests, sorties étiquetées et destination ou fin du parcours. La
projection ne modifie aucune définition ; le JSON exact reste disponible.

Preuve réelle bornée sur le daemon officiel 0.14 isolé existant, port 6914,
home/état/dépôt sous `/tmp/teams-014-compat`, relais désactivé. La révision 2 de
la fixture sauvegardée contient Code → Revue → Décision humaine, une branche de
correction vers Code et un test explicitement configuré. Le navigateur Chromium
vérifie le budget de six activations, les branches et la fin humaine à 1440 × 1050
et 390 × 844, sans exception JS ni débordement horizontal. Navigation initiale
ouverte en desktop avant redimensionnement mobile ; aucun appareil physique ni
parcours initial mobile revendiqué. Aucune admission ni activation supplémentaire,
aucun tour de modèle. Scripts `definition-setup.mjs`, `definition-browser.mjs`,
réponses `definition-source-proof.json`, `definition-ui-proof.json`, textes et
captures `definition-ui-{desktop,mobile}.{txt,png}` dans ce répertoire temporaire.
Le test de composant `tests/graph-definition.test.ts` couvre aussi français et
anglais, conservation des commandes/identifiants/instructions et absence de
mutation de la définition ; son transport hôte est simulé.

### 30 octobre 2026, 23:40 — création inline du preset Code ↔ Review

Le rapport `/team-graphs` propose **Créer Code ↔ Review** : nom, modèles et
permissions détectés dans le workspace par `teams.catalog`, commande de test
explicite, délai (1–30 secondes) et limite de corrections (0–100, choix proposés).
Le budget affiché compte Code et Revue, soit `2 × (limite + 1)` activations.
La revue propose uniquement Codex `read-only` et Claude `plan`, les permissions
natives vérifiées par le moteur. La commande est attachée à l'étape Code.
La sauvegarde via `teams.save_definition` sélectionne la révision retournée pour
le lanceur existant ; ni admission ni exécution implicite. Le formulaire exige
une commande ; les exceptions sans tests et l'édition arbitraire restent à faire.

Essais réels sur le daemon officiel **0.14.0**, home/état/dépôt jetables existants
`/tmp/teams-014-compat`, port loopback **6914**, relais et voix désactivés :

- Chromium **1440 × 1050** : création et prévisualisation de `Preset isolé desktop`.
- Chromium **390 × 844** : création et prévisualisation de `Preset isolé mobile`,
  menus de modèles, limite de deux corrections, délai de cinq secondes et
  commande `node --test`. Captures du formulaire et des sélecteurs inspectées.
- Les deux définitions ont une révision 1, un budget de six activations et les
  sélections exactes `codex/gpt-6.1-sol` (`auto`) et `claude/claude-opus-5-5`
  (`plan`). Les commandes sont uniquement sauvegardées, jamais exécutées ici.
- Aucun clic sur la confirmation : les checkpoints de graphes sont profondément
  identiques avant/après, dont le graphe préexistant ready avec zéro activation.
  Définitions et checkpoints relus identiques après reload du plugin isolé.
- Aucun débordement horizontal ou exception JS dans les parcours réussis. Le
  premier essai de navigation initiale mobile s'est arrêté sur l'écran hôte
  d'ouverture du projet : le parcours mobile réussi ouvre l'espace en desktop
  puis redimensionne avant de créer le preset. Aucun démarrage mobile autonome,
  appareil physique ou parcours de modèle revendiqué.

Preuves locales : `preset-{before,after,reloaded,persistence-proof}.json`,
`preset-ui-desktop.txt`, `preset-ui-mobile.txt`, `preset-mobile-proof.json`,
`preset-form-{desktop,mobile}.png`, `preset-preview-{desktop,mobile}.png`,
`preset-selectors-mobile.png`. Scripts `preset-browser.mjs`, `preset-rpc.mjs`,
`preset-selectors.mjs` ; daemon isolé arrêté normalement après vérification.
Le test de composant `tests/graph-preset.test.ts` utilise un transport simulé et
vérifie séparément FR/EN, modèles détectés, exclusion des permissions de revue
non prises en charge, absence de sauvegarde avant saisie complète, budget sans
correction, conservation des identifiants/commande, double clic et absence
d'admission. Il ne constitue pas un essai réel de modèle.

## 31 octobre 2026 — édition inline des définitions sauvegardées

Daemon officiel 0.14.0 isolé sur `127.0.0.1:6914`, home/dépôt/état jetables
`/tmp/teams-014-compat`, `PASEO_AGENT_TEAMS_DATA_DIR` et URL daemon explicitement
isolés. Relais et voix désactivés ; aucun tour de modèle ou test shell lancé.

- Chromium desktop 1440 × 1050 puis mobile 390 × 844 : sélection de chaque preset
  sauvegardé, prévisualisation, ouverture de l'éditeur, retrait de l'ancienne
  confirmation et prévisualisation désactivée pendant l'édition. Budget zéro
  refusé ; nom, budget 8, consignes Code, commande littérale et délai 1000 ms
  modifiés, sauvegardés en révision 2, puis nouvelle prévisualisation explicite.
- Zéro débordement horizontal ou exception JS. Capture mobile inspectée. Le
  parcours mobile ouvre l'espace en desktop puis redimensionne ; aucun démarrage
  mobile autonome, appareil physique ou essai réel en anglais revendiqué.
- RPC officiels : historique exactement `[révision 1, révision 2]`, refus d'une
  écriture concurrente à révision 1 sans mutation, étape Revue et branches
  inchangées. Définitions, historique et graphe déjà admis profondément identiques
  après reload du seul plugin isolé ; aucune admission ou activation supplémentaire.
- Premier démarrage isolé effectué sans les variables du plugin : arrêté avant
  tout RPC de test, puis relancé avec répertoire/URL isolés. Les sept états
  principaux sont byte-identiques aux empreintes du passage précédent ; aucune
  mutation ni session de modèle déclenchée par ce démarrage.

Preuves locales : `editor-browser.mjs`, `editor-verify.mjs`,
`preset-editor-before.json`, `editor-ui-proof.json`, `editor-persistence-proof.json`,
`editor-ui-{desktop,mobile}.txt`, `editor-form-{desktop,mobile}.png`,
`editor-preview-{desktop,mobile}.png` sous `/tmp/teams-014-compat`.
Le premier contrôle RPC a attendu le mot « revision » au lieu du message réel
« Workflow definition changed; reload before saving » ; assertion corrigée et
vérification complète réussie avant/après reload. Daemon isolé arrêté normalement.

Les composants sont vérifiés séparément par transport simulé :
`tests/graph-editor.test.ts` et `tests/graph-launcher.test.ts` couvrent budget et
délais invalides, conflit conservant le brouillon, retry sans changement d'identité,
double clic, FR/EN, annulation, sélection de la nouvelle révision et impossibilité
de confirmer l'ancien aperçu. Le test a détecté une propriété optionnelle
`tests: undefined` ajoutée à une étape intacte ; corrigé avant validation finale.
L'édition de la structure, des modèles et des exceptions sans tests reste à faire.

### 31 octobre 2026 — ajout et suppression de tests dans l’éditeur

Incrément `5c038b9`. `npm run check` réussi : **352/352 tests**, typage,
lint et format ; journal `/tmp/teams-roadmap-310940-check.log`. Deux tests
ciblés de l’éditeur réussissent également. Le nouveau test de composant
(transport simulé) vérifie suppression du dernier test sans tableau vide,
commande vide bloquante, limite de dix tests, conservation des commandes et
absence de mutation de la définition source.

Intégration RPC réelle : daemon officiel **0.14.0**, port **6914**, home,
dépôt et états isolés `/tmp/teams-014-compat`, variables de données et URL
explicitement isolées. Suppression des tests sur une révision sauvegardée,
refus d’une commande vide, ajout de deux commandes explicites, historique
exact et graphe déjà admis inchangé. Après reload du seul plugin isolé,
relecture profondément identique des définitions et graphes. Script et preuve :
`test-editor-rpc.mjs`, `test-editor-rpc-proof.json` dans ce répertoire.
Aucune admission, activation, exécution shell de ces commandes ou conversation
avec un modèle déclenchée par cet essai.

**Limite réelle du navigateur :** le harnais Chromium n’a pas atteint le
formulaire. Après ouverture du workspace, le contenu des sessions reste en
chargement ; les tentatives bornées de sélection de texte puis du bouton
accessible n’ont pas fait apparaître le lanceur. Capture et texte de diagnostic
`test-editor-debug.{png,txt}`, script `test-editor-browser.mjs`. Aucune preuve
de succès desktop/mobile de cet incrément, aucun appareil physique ni essai
anglais réel revendiqué. La cause du chargement hôte n’est pas établie.
Le rechargement du plugin principal est différé jusqu’au contrôle visuel réussi.
Le daemon isolé est arrêté en fin de passage ; daemon principal inchangé.

### 31 octobre — rechargement explicite après conflit de définition

Daemon officiel 0.14.0 isolé, `/tmp/teams-014-compat/home`, état et dépôt jetables
associés, port 6914 ; variables de données et URL explicitement isolées.
Chromium desktop 1440 × 1050 puis mobile 390 × 844 : lecture d'une définition,
édition, sauvegarde concurrente par RPC officiel, refus de la sauvegarde périmée,
brouillon conservé, abandon/relecture explicites puis sauvegarde à la nouvelle
révision. Historique relu : deux nouvelles révisions exactes ; graphes admis
inchangés. Les contrôles ajout/suppression de tests du passage précédent ont aussi
été exercés : retrait du dernier test, avertissement humain, commande vide bloquée,
commande saisie autorisant la sauvegarde. Pas de débordement horizontal ni exception
JS ; capture mobile inspectée. Navigation initiale desktop avant redimensionnement,
aucun appareil physique, démarrage mobile autonome ou essai réel anglais revendiqué.

Preuves : `reload-editor-browser.mjs`, `reload-editor-proof.json`,
`reload-conflict-{desktop,mobile}.png` sous `/tmp/teams-014-compat`.
Après reload du seul plugin isolé, `reload-editor-verify.mjs --compare` confirme
les définitions et graphes profondément identiques. Aucun nouveau tour de modèle,
commande shell de workflow, admission ou activation. Daemon isolé arrêté après
validation. `npm run check` : 353/353, typage/lint/format réussis, log
`/tmp/teams-roadmap-311440-check.log`. Test de composant simulé distinct des essais
réels : pas de relecture automatique, définition disparue conservant le brouillon,
double clic, puis utilisation de la révision relue lors de la sauvegarde.

### 1er novembre 2026 — duplication et suppression des étapes sauvegardées

Daemon officiel 0.14.0 isolé sur 6914, home/états/dépôt sous
`/tmp/teams-014-compat`, relais et voix désactivés, variables du plugin explicitement
isolées. Chromium 1440 × 1050 puis 390 × 844 : duplication de Revue,
sauvegarde bloquée tant que la copie reste inaccessible, branche de succès reliée
explicitement, suppression d’une seconde copie sans références, consignes modifiées
et sauvegarde versionnée. Suppression bloquée pour l’entrée et les étapes référencées.
RPC officiels : historique précédent exact, copie conservant contrat/modèle/droits,
et graphes admis inchangés. Relecture profondément identique après reload du seul
plugin isolé ; daemon isolé arrêté normalement.

Preuves locales : `step-editor-browser.mjs`, `step-editor-proof.json`,
`step-editor-verify.mjs --compare` et captures `step-editor-{desktop,mobile}.png`
dans ce répertoire. Capture mobile inspectée : bas du formulaire et prévisualisation
lisibles, sans débordement horizontal ; les boutons de duplication/suppression sont
exercés par le script. Zéro exception JS. Navigation ouverte en desktop avant
redimensionnement ; aucun démarrage mobile autonome, appareil physique ou parcours
réel anglais revendiqué. Aucun tour de modèle, test shell de workflow, admission ou
activation supplémentaire. Le test de composant utilise un transport simulé ;
il couvre aussi les copies indépendantes de tests, les identifiants uniques,
la suppression après retrait d’une référence et les libellés anglais.

### 1er novembre 2026, 15:40 — modèles et permissions dans l’éditeur

Incrément `0ee8073`. Catalogue officiel `teams.catalog`, deux sélecteurs par
étape automatique : modèle et permissions natives. Recherche explicite,
conservation des choix historiques et des permissions lors d’un changement de
modèle, sans défaut automatique. Lecture seule : seuls Codex `read-only` et
Claude `plan` sont proposés, conformément à la validation serveur existante.
Les humains n’ont aucun sélecteur exécutable. L’admission revérifie toujours
la disponibilité et les permissions ; sauvegarder ne lance aucun agent.

Daemon officiel **0.14.0** isolé sur 6914, home/données/dépôt sous
`/tmp/teams-014-compat`, variables DATA_DIR/DAEMON_URL explicitement isolées,
voix et relais désactivés. Chromium desktop 1440 × 1050 puis 390 × 844 :
recherche, changement des deux modèles, choix des permissions, passage du Code
à lecture seule puis sélection explicite du mode correspondant, sauvegarde et
relecture de l’historique via RPC officiels. Les étapes, transitions et budget
hors sélection restent identiques ; ancienne révision exacte. Définitions et
graphes déjà admis profondément identiques après reload du seul plugin isolé.
Aucun débordement horizontal ni exception JS ; capture mobile inspectée.
Scripts `native-editor-{browser,verify}.mjs`, preuve `native-editor-proof.json`,
captures `native-editor-{desktop,mobile}.png` dans cette racine ; logs
`/tmp/roadmap-011540-browser-split.log`. Le texte de succès du script navigateur
hérite du harnais précédent (« human editor ») ; les assertions du script et
la preuve portent bien sur les modèles/permissions.

Trois tentatives bornées du sélecteur combiné initial ont rencontré un choix
hors viewport (30 s puis 10 s, avec et sans défilement). La version finale
sépare modèles et permissions ; parcours réussi avec clics Playwright normaux
après défilement, sans clic forcé sur les choix. Le lien d’ouverture de la
conversation reprend le clic forcé du harnais existant. Aucun modèle n’a été
lancé, aucune admission/activation ou commande shell de workflow exécutée.
Le daemon isolé a été arrêté normalement (`forced: false`).

Tests de composants : transport simulé, panne du catalogue avec brouillon
conservé, modèles avec slash, absence de remplacement implicite, refus d’un
choix non détecté, permissions natives filtrées, humains exclus, FR/EN.
`npm run check` final : **357/357** tests, typage/lint/format verts ; dix tests
éditeur/i18n ciblés verts. Logs `/tmp/roadmap-011540-{check-final,targeted-final}.log`.
Aucun parcours navigateur anglais ni démarrage mobile autonome/appareil physique
revendiqué ; la fenêtre mobile est ouverte en desktop avant redimensionnement.

Principal : inactivité revérifiée, plugin seul rechargé avec statut `running` ;
sept états persistés byte-identiques, PID superviseur **1923177** et worker
**1891564** inchangés. Preuve `/tmp/roadmap-011540-reload-proof.json`.

### 2 novembre 2026 — import visuel portable

Daemon officiel 0.14.0 isolé, port 6914, home/données/dépôt sous
`/tmp/teams-014-compat`, DATA_DIR et DAEMON_URL explicitement isolées,
voix/relais désactivés. `import-editor-browser.mjs` exerce Chromium desktop
1440 × 1050 puis mobile 390 × 844 : JSON invalide refusé sans sauvegarde,
validation et aperçu lisible, confirmation créant une nouvelle identité en
révision 1 et historique propre. Anciennes définitions et graphes admis inchangés.
`import-editor-verify.mjs --compare` confirme l'égalité profonde après reload du
seul plugin isolé. Preuve `import-editor-proof.json`, captures
`import-editor-{desktop,mobile}.png` ; capture mobile inspectée, aucun débordement
horizontal ni exception JS. Daemon isolé arrêté normalement. Aucun modèle,
admission ou commande shell de workflow lancé. Mobile redimensionné depuis
desktop ; aucun appareil physique, démarrage mobile autonome ou navigateur anglais
revendiqué. Tests de composant à transport simulé : schéma strict, référence
invalide, aperçu invalidé par modification, double clic, erreur conservant la
saisie, sauvegarde sans identifiant local et libellés anglais.

Limite : le RPC existant de création ne possède pas de clé d'idempotence client.
Le verrou local évite le double clic simultané ; une réponse perdue après une
sauvegarde effective peut laisser une copie enregistrée dont le client ignore
l'identité. Une nouvelle confirmation après cette erreur peut créer une seconde
copie ; aucun lancement ou remplacement implicite n'en découle.

## 2 novembre 2026 — accès explicite au fil des graphes (NATIVE-IDLE-001)

Daemon officiel 0.14.0 isolé sur 6914, home/états/dépôts jetables sous
`/tmp/teams-014-compat`, variables DATA_DIR et DAEMON_URL explicitement isolées,
voix/relais désactivés. Deux conversations Team créées par API et deux graphes
humains à une étape, sans premier prompt natif. Le bouton de la carte Équipe
**Afficher les workflows de cette conversation** envoie `/team-graphs` via
`agents.ref(id).send`, après vérification d'inactivité, avec
`activeTurnBehavior: 'steer'` explicite : le défaut SDK interrupt n'est pas utilisé.
Aucun envoi au montage, aucun modèle ou commande shell de workflow.

Chromium desktop 1440 × 1050 puis mobile 390 × 844 après ouverture desktop : bouton
exercé par clics, commande visible et cartes lisibles, checkpoints profondément
identiques, aucune exception JS ni débordement horizontal. Un essai de navigation
mobile initiale a échoué dans le harnais (sélecteur du workspace), sans preuve de
parcours mobile autonome. Aucun navigateur anglais ni appareil physique revendiqué.
Les premières captures ont pris l'animation d'ouverture ; nouvelle capture stable
séparée après attente bornée. Les captures finales montrent les graphes déjà
terminés après le test de réponse ultérieure ; la preuve JSON conserve les états
attendant la réponse et les timelines de restauration.

Arrêt normal puis redémarrage du seul daemon isolé : timeline native relue par API
officielle sans prompt, cartes présentes, checkpoint humain profondément identique.
Réponse humaine explicite ultérieure, succès puis rejeu idempotent. Scripts
`native-idle-{setup,browser,verify,captures}.mjs`, preuve `native-idle-proof.json`,
captures `native-idle-{desktop,mobile}-{button,thread}.png` dans ce répertoire.

Limite conservée : ce parcours initialise une conversation par une commande
utilisateur visible ; il ne prétend pas restaurer automatiquement toutes les
anciennes conversations créées seulement par API. Le même bouton peut les rouvrir
explicitement. Aucun faux prompt caché, reconstruction locale du ledger ou
modification de Paseo. Tests à transport simulé : blocage actif/permission/workspace,
double clic, erreur conservant la carte et libellés anglais ; test du provider
confirmant le refus du steering sans découverte, création ou approbation.

### 2 novembre 2026 — périmètre des imports natifs Planner et Reviewer

Le runtime vérifie désormais le workspace **et** le cwd de la session rafraîchie
avant de lire son timeline, pour tous les imports natifs. La récupération d’une
opération conservait déjà ce contrôle. Aucun changement de contrat ou de migration.

Essai réel sur le daemon officiel 0.14.0 isolé sur 6914, home/état sous
`/tmp/teams-014-compat`, DATA_DIR/DAEMON_URL explicites, voix/relais désactivés.
Script `native-scope.mts`, découverte `native-scope-discovery.json`, preuve
`native-scope-proof.json` dans cette racine ; journal
`/tmp/roadmap-021640-native.log`. Deux modèles détectés ready : Codex
`gpt-6.1-sol` pour le Planner et Claude `claude-opus-5-5` pour le Reviewer.
Un seul prompt réel par session, délai maximal 120 secondes par appel.
Lecture canonique acceptée dans le périmètre attendu ; même référence de session
refusée avec WORKSPACE_ACCESS_DENIED dans un workflow portant un autre workspace,
puis un autre cwd. Relire dans le bon périmètre donne un résultat identique ;
le timeline contient toujours un seul message utilisateur. README et état Git du
dépôt jetable inchangés. Les contextes de workflow divergents sont construits
explicitement par le script : aucun déplacement réel de session n’est revendiqué.
Daemon isolé arrêté normalement après constat d’inactivité des deux modèles.

Ce test utilise le vrai runtime et les API officielles avec des conversations
réelles. Il ne passe pas par `teams.action`, ne crée pas d’opération persistée et
ne prouve pas le scénario transversal complet ni une adoption de plan. Aucun
navigateur/mobile lancé, aucune modification d’interface. Le test unitaire
complémentaire simule un déplacement révélé par refresh et vérifie zéro lecture
de timeline avant le refus ; les cas workspace/cwd manquants sont aussi refusés.

## 2 novembre 2026 — checkpoints natifs via le moteur et redémarrage

Harnais reproductible : `scripts/smoke-native-checkpoints.mjs`. Il exige
`PASEO_TEAMS_SMOKE_URL`, un port loopback explicite différent de 6767, crée son
propre dépôt temporaire et utilise les RPC du plugin et le SDK officiels. Deux
phases séparées permettent au conducteur de redémarrer uniquement le daemon
isolé entre elles :

```sh
PASEO_TEAMS_SMOKE_URL=ws://127.0.0.1:6914/ws node scripts/smoke-native-checkpoints.mjs
# Arrêter et redémarrer uniquement le daemon isolé, avec les mêmes home/data/URL.
PASEO_TEAMS_SMOKE_URL=ws://127.0.0.1:6914/ws node scripts/smoke-native-checkpoints.mjs /tmp/teams-native-live-EXEMPLE/proof.json
```

Chaque attente de checkpoint est limitée à 150 secondes et chaque appel natif à
120 secondes. Le parcours nominal utilise six tours réels au total : deux tours
Planner du moteur, une réponse humaine native traitée par le Planner, une
discussion Reviewer du moteur et deux propositions natives Reviewer. Aucun tour
Builder, test shell de workflow, approbation de plan ou publication. La reprise
`--continue proof.json` est limitée à une préparation interrompue avant le premier
tour natif ; elle évite de recréer un workflow pour une erreur du harnais.

Essai sur daemon **0.14.0**, port **6914**, home/état isolés sous
`/tmp/teams-014-compat`, avec Codex **gpt-6.1-sol** et Claude
**claude-opus-5-5** réellement détectés. Workflow
`17e16618-fdc0-47ce-8736-33ae869c8dcb`, dépôt et preuve
`/tmp/teams-native-live-WFXyzW/proof.json` :

- Clarification concrète avec recommandation, puis réponse libre + choix dans le
  JSON humain de la session native. Import réel par `teams.action` pendant la
  pause ; résolution conservée sans approbation. Reprise Planner et plan citant
  GUIDE.md. Les sessions des trois rôles sont précréées : l'absence de travail du
  Builder est prouvée par `lastUserMessageAt=null`, fenêtre de timeline vide et
  zéro message utilisateur, plutôt que par l'absence d'une session.
- Discussion Reviewer, proposition native et import explicite : le plan initial
  reste identique. Après arrêt normal et redémarrage du seul daemon isolé, le
  `teams.workflow_record` est profondément identique, y compris clarification,
  proposition, versions et événements.
- **Limite réelle de reprise :** les sessions sont restaurées `closed` et
  l'historique Reviewer relu ne fournit plus d'identifiant de tour unique. Le
  runtime accepte désormais la lecture des sessions `closed` inactives, mais
  refuse toujours cet import ambigu. Aucun identifiant synthétique, prompt caché,
  rejeu automatique ni mutation du checkpoint. La réimportation de l'ancien
  échange après redémarrage n'est donc **pas validée** sur cette combinaison.
- Une **nouvelle** proposition native explicite, sur la même session et le même
  checkpoint, est importée puis adoptée. Historique v1 Planner et v2 Reviewer,
  provenance native conservée, commandes de test révisées. La pause subsiste ;
  après reprise, statut `awaiting_plan`, `testsApproved=false`, aucun prompt au
  Builder. README.md byte-identique. Aucune approbation finale revendiquée.

Preuves locales : `/tmp/roadmap-022140-native{,-resume}.log`,
`/tmp/roadmap-022140-{stop,restart}.log`, preuve JSON ci-dessus. Les premières
exécutions du harnais ont été corrigées : valeur de politique `explicit`, état
`attention` pour la question, sessions précréées et timeline vide signalant
`hasOlder=true`. Un premier workflow isolé a seulement posé sa question ; le
second a été continué sans réémettre cette question. Les refus après redémarrage
ont été conservés comme limites, pas comptés comme réussites. Pas de navigateur,
mobile ni appareil physique dans cet essai ; aucune modification d'interface.


## 3 novembre 2026 — adoption de la proposition persistée après redémarrage

Le harnais `scripts/smoke-native-checkpoints.mjs` propose désormais un chemin de
reprise sans réimport ni nouvel appel de modèle :

```sh
PASEO_TEAMS_SMOKE_URL=ws://127.0.0.1:6914/ws node scripts/smoke-native-checkpoints.mjs
# Arrêter puis redémarrer uniquement le daemon isolé avec les mêmes home/data/URL.
PASEO_TEAMS_SMOKE_URL=ws://127.0.0.1:6914/ws node scripts/smoke-native-checkpoints.mjs --adopt-persisted /tmp/teams-native-live-EXEMPLE/proof.json
```

Ce chemin exige le dossier profondément identique au checkpoint de préparation.
Il adopte la proposition native déjà importée, vérifie la provenance, les versions
antérieures et les réponses de clarification conservées, puis rejoue exactement
la requête d'adoption : même réponse et dossier complet inchangé. La reprise
reste à `awaiting_plan`, sans approbation de tests. Les dates de dernier message utilisateur des trois rôles doivent rester
identiques avant/après ; le Builder conserve zéro prompt. Le scénario utilise
cinq tours réels lors de la préparation et aucun lors de l'adoption. La limite de
réimport de l'historique restauré reste distincte et inchangée.

Le test moteur complémentaire reconstruit Store et Engine, appelle la reprise
automatique et fournit un runtime dont la lecture native échouerait. Adoption,
rejeu du reçu et reprise explicite réussissent sans lecture native, création de
session, tour de modèle ni test shell. Ce test est simulé, distinct du parcours
réel ci-dessus.

Deux assertions du harnais ont été corrigées pendant les essais : la liste Team
masque les reçus, donc son résultat ne doit pas être comparé à la réponse complète
d'action ; le rejeu se compare à lui-même et le dossier complet à lui-même.
De même, les bornes du timeline peuvent évoluer pendant la restauration sans
nouveau prompt : seules les dates des derniers messages utilisateur sont
comparées pour ce contrôle. Les deux parcours intermédiaires ont effectivement
adopté leur proposition ; le premier est resté en pause, le second est revenu à
l'approbation du plan. Ils ne sont pas comptés comme harnais entièrement réussi.
Aucune réémission d'un ancien prompt ou mutation de leur état pour forcer le
nouvel essai ; chaque préparation corrective a créé son propre dépôt.

Essai final réussi : daemon officiel **0.14.0**, port **6914**, home et états
`/tmp/teams-014-compat`, DATA_DIR/DAEMON_URL explicites, voix/relais désactivés.
Modèles détectés Codex **gpt-6.1-sol** et Claude **claude-opus-5-5**.
Workflow `94011c02-e3b5-4922-9602-27138c4def17`, preuve
`/tmp/teams-native-live-nSkIl3/proof.json`. Les cinq tours de préparation ont
réellement été exécutés ; après arrêt normal et redémarrage du seul daemon isolé,
le chemin `--adopt-persisted` passe entièrement avec zéro tour supplémentaire.
Après reload du seul plugin isolé, comparaison profonde du dossier final
identique (`/tmp/roadmap-030240-after-reload-proof.json`). Logs
`/tmp/roadmap-030240-native-verified.log`, `adopt-verified.log`,
`restart-verified.log`, `after-reload.log`, `final-stop.log` avec le même préfixe
`/tmp/roadmap-030240-`. Daemon isolé arrêté normalement en fin de passage.
Les trois préparations, dont deux corrections bornées du harnais, totalisent
quinze tours de modèles ; aucun prompt Builder, approbation de tests, test shell
de workflow, navigateur/mobile ou publication. Aucun code de production ou
interface modifié ; plugin principal non rechargé et daemon principal intact.

## 3 novembre 2026 — nouveau tour Reviewer après restauration et approbation native

Le daemon 0.14 restaure certains anciens messages sans `turnId`. Le hook officiel
`agent.turn_ended` d'un **nouveau** tour possède pourtant son identifiant, de même
que son prompt, ses outils et sa réponse. `completedTurnTimeline` refusait ce tour
uniquement parce que les échanges précédents n'avaient plus d'identifiant.
Le lecteur ignore désormais cette ancienne portion ; le tour courant doit rester
contigu, entièrement identifié, avec un unique prompt initial et la bonne portée.
L'import d'un ancien échange sans identité reste refusé, sans provenance inventée.

Preuve réelle : daemon officiel **0.14.0** isolé sur **6914**, home et données
`/tmp/teams-014-compat`, variables DATA_DIR/DAEMON_URL explicites, voix/relais
désactivés. Codex **gpt-6.1-sol** et Claude **claude-opus-5-5** détectés.
Workflow `f4946451-103c-486b-94fe-d36496c7eb3c`, dépôt
`/tmp/teams-native-live-PcGHPb` : clarification → réponse humaine native → plan →
discussion Reviewer → proposition native → arrêt/redémarrage isolé → adoption
persistée → approbation explicite et révision humaine des tests → un tour Builder
→ deux tests indépendants réussis → revue Claude `pass` → question de livraison.
Les trois versions Planner/Reviewer/humain et la clarification résolue restent
conservées. Aucun accord de livraison, commit, publication ou tour de livraison.
Après reload du seul plugin isolé : dossier complet profondément identique.

Le harnais supplémentaire se lance après la préparation et l'adoption déjà
documentées :

```sh
PASEO_TEAMS_SMOKE_URL=ws://127.0.0.1:6914/ws node scripts/smoke-native-approval.mjs /tmp/teams-native-live-EXEMPLE/proof.json
# Après reload du plugin isolé : comparaison seule, sans envoi.
PASEO_TEAMS_SMOKE_URL=ws://127.0.0.1:6914/ws node scripts/smoke-native-approval.mjs /tmp/teams-native-live-EXEMPLE/proof.json --verify
```

Il exige le checkpoint exact, approuve une seule fois, rejoue son reçu et attend
au plus 240 s. `--capture` reprend uniquement les assertions après une approbation
déjà enregistrée, sans envoyer d'action. La preuve est extérieure au dépôt testé
(`${root}-approval-proof.json`) pour ne pas modifier l'artefact vérifié. Le test
Node contrôle le nouveau fichier non suivi : contenu non vide, un paragraphe,
absence d'espaces finaux et README byte-identique. `git diff --check` seul ne
couvre pas un fichier non suivi. Quatre fixtures locales ont confirmé ces contrôles
(un paragraphe accepté ; deux paragraphes, espaces finaux et vide refusés).

Incidents conservés : le premier essai sur l'ancien checkpoint
`94011c02-e3b5-4922-9602-27138c4def17` n'a rien implémenté car sa consigne « ne
jamais implémenter » était ambiguë entre Planner et Builder ; test de contenu et
revue ont échoué honnêtement. Le hook Reviewer non consommé a révélé le défaut
corrigé ci-dessus (`/tmp/roadmap-030740-reviewer-timeline.json`). Aucune réponse
ancienne n'a été réémise pour fabriquer un reçu. La fixture de préparation précise
maintenant les autorisations par rôle. Sur le second essai, une assertion lisant
stdout dans `teams.list` (projection résumée) a été corrigée pour utiliser
`teams.workflow_record` ; `--capture` a vérifié le résultat déjà atteint sans
nouveau tour. Le premier harnais a terminé sur une erreur RPC lors du reload
isolé ; ce premier essai n'est pas déclaré réussi.

Preuves : `/tmp/teams-native-live-PcGHPb/proof.json`,
`/tmp/teams-native-live-PcGHPb-approval-proof.json`,
`/tmp/roadmap-030740-{native,adopt,approval-fixed,capture,reload-verified}.log`,
`/tmp/roadmap-030740-content-check-proof.json`. `npm run check` : **364/364** ;
les **9 tests** du lecteur de tours incluent restauration, pagination et refus des
identités manquantes dans le tour courant. Aucun nouveau navigateur/mobile ni
graphe personnalisé exécuté ; la validation transversale complète reste ouverte.

## 3 novembre 2026 — graphe personnalisé, refus et correction réels

Harnais opt-in `scripts/smoke-custom-graph.mjs`, sur un daemon loopback isolé
avec port explicite hors 6767. Il détecte les modèles ready et vérifie les modes
natifs avant admission. Chaque appel `graph_advance` avance une frontière
persistée ; attente bornée à 300 s et 340 appels par invocation, au maximum
quatre envois natifs et cinq activations par graphe. Les erreurs ne déclenchent
aucun renvoi. Les preuves sont écrites hors du dépôt testé.

```sh
PASEO_TEAMS_SMOKE_URL=ws://127.0.0.1:6914/ws node scripts/smoke-custom-graph.mjs
# Si une assertion du harnais doit être corrigée : continuer le même checkpoint,
# sans créer de workflow ni rejouer les prompts déjà envoyés.
PASEO_TEAMS_SMOKE_URL=ws://127.0.0.1:6914/ws node scripts/smoke-custom-graph.mjs --continue /tmp/teams-custom-live-EXEMPLE-proof.json
# Après arrêt normal et redémarrage du seul daemon isolé :
PASEO_TEAMS_SMOKE_URL=ws://127.0.0.1:6914/ws node scripts/smoke-custom-graph.mjs --resume /tmp/teams-custom-live-EXEMPLE-proof.json
# Après reload/restart isolé, lecture seule :
PASEO_TEAMS_SMOKE_URL=ws://127.0.0.1:6914/ws node scripts/smoke-custom-graph.mjs --verify /tmp/teams-custom-live-EXEMPLE-proof.json
```

Le graphe comporte quatre étapes personnalisées : brouillon volontairement
incorrect, inspection Claude en lecture seule, réparation Codex et décision
humaine. Le test de contenu du brouillon doit réellement échouer. Un rejet
explicite idempotent suit la branche failure ; la revue refuse le brouillon,
la réparation reçoit les preuves et constats précédents, puis les tests et une
seconde revue valident la correction. La dernière activation attend sans modèle.
Le harnais exige un checkpoint identique après redémarrage et une approbation
explicite rejouable avant le succès terminal. Aucun commit ou publication n'est
autorisé dans le dépôt d'essai. Les consignes et réponses sont demandées en
anglais ; cela ne vérifie pas le réglage de langue de l'interface.

Essai final réel : daemon officiel **0.14.0** sur **6914**, home/états sous
`/tmp/teams-014-compat`, DATA_DIR/DAEMON_URL explicites, voix/relais désactivés.
Codex **gpt-6.1-sol** en `full-access`, Claude **claude-opus-5-5** en `plan`,
modèles et modes détectés. Preuve : `/tmp/teams-custom-live-2ZGFAz-proof.json`.
Les cinq activations sont `draft → inspect → repair → inspect → human` ; les
quatre reçus natifs proviennent de quatre sessions distinctes. Test initial
Node exit 1, décision de rejet rejouée à l'identique, première revue fail,
réparation avec les constats et le test rejeté dans son prompt, test Node exit 0,
seconde revue pass. Les deux inspections ont leur empreinte de lecture seule
inchangée et des tests indépendants réussis ; README byte-identique.
Après redémarrage normal du seul daemon isolé : checkpoint humain profondément
identique, nouvelle continuation sans effet ni approbation ; décision humaine
explicite, rejeu identique et succès terminal. Relecture après reload isolé
profondément identique. Aucun commit ni publication dans le dépôt testé.

Un premier graphe `/tmp/teams-custom-live-9kmdC9-proof.json` a réellement corrigé
le fichier et réussi son test, mais terminé en échec : son Builder avait rempli
`remaining` avec la vérification future. Le contrat interprète un tableau non
vide comme échec. Cet essai ne compte pas comme parcours complet réussi. La
consigne de réparation précise désormais `remaining: []` quand aucun défaut
d'implémentation ne reste. Deux assertions initiales trop strictes sur le statut
natif `running` ont été corrigées et le même checkpoint continué sans renvoi.
Deux graphes seulement, **sept tours réels au total**, aucune boucle corrective
indéfinie. Aucun nouveau navigateur/mobile, réglage de langue d'interface,
clarification ni révision de plan dans ce harnais : les preuves natives du
passage précédent restent distinctes de cet essai de graphe personnalisé.
