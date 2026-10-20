# Agent Teams — feuille de route planifiée

Demande utilisateur : implémenter et tester les quatre axes ci-dessous, avec une exécution récurrente toutes les **5 heures**. Ce fichier sert de contexte durable entre les exécutions ; ne pas recommencer les éléments déjà validés.

## Cadre d’exécution

- Projet indépendant : `/home/razer/Projects/paseo/paseo-agent-teams`, dépôt public `ssime-git/paseo-agent-teams`.
- Utiliser les API officielles de Paseo et les providers/modèles réellement détectés. Préserver les workflows existants et leur reprise ; ne pas modifier ni forker Paseo.
- À chaque passage : lire ce fichier, l’historique Git et l’état réel ; traiter le prochain incrément utile, l’implémenter, le tester et consigner les preuves et le travail restant.
- Travailler par incréments cohérents. Préserver les modifications d’autrui. Si un agent ou workflow actif travaille dans ce dépôt, ne pas lancer un deuxième éditeur concurrent : consigner le blocage et reprendre au passage suivant. Ne jamais annuler un workflow de l’utilisateur.
- Tester sur un daemon et un dépôt isolés. Ne jamais redémarrer le daemon principal ni activer de réglages globaux non autorisés. L’utilisation isolée de Claude Code et Codex a été autorisée ; ne pas lancer des boucles de modèles sans limite.
- Exécuter `npm run check` et les contrôles spécifiques à l’incrément. Vérifier les formats desktop et mobile pour les changements d’interface. Un test simulé ne remplace pas une preuve d’intégration : distinguer les deux.
- Commit et push sur `main` autorisés pour les incréments vérifiés. Ne pas déplacer les tags existants. Ne pas créer de release, merger de PR ni envoyer de message/issue/commentaire externe sans demande explicite supplémentaire.
- Une fois stable, recharger uniquement le plugin principal si ses agents sont inactifs, puis vérifier la compatibilité et l’état conservé. Sinon différer ce rechargement et l’indiquer.
- Garder les messages, récapitulatifs et le journal en français. Limiter chaque passage à un incrément testable, environ 60–90 minutes ; enregistrer un point de reprise si le travail reste incomplet.
- Lorsque les quatre axes et leur intégration sont validés, mettre cette tâche planifiée en pause, puis produire un bilan final. Ne pas laisser tourner une maintenance indéfinie sur une tâche terminée.

## Si l’utilisateur est absent

- Pour cette tâche de développement planifiée, ne pas attendre une réponse interactive à chaque passage. Prendre les décisions techniques courantes, réversibles et déjà dans le périmètre autorisé, puis les documenter avec leurs raisons.
- Si une décision exige réellement l’utilisateur (objectif incompatible, accès manquant ou action hors autorisation), enregistrer une question avec 2–3 propositions et une recommandation dans le journal et le bilan. Ne pas inventer sa réponse.
- Suspendre uniquement le travail dépendant de cette réponse et avancer sur les autres critères indépendants. Ne pas reposer la même question à chaque passage : conserver un registre des questions en attente et le mettre à jour.
- Si tous les travaux restants sont bloqués, terminer proprement le passage avec un bilan clair. Ne pas laisser un agent attendre une saisie indéfiniment et ne pas consommer des boucles de modèles pour attendre.
- Pour le futur Planner du produit, conserver la question et le contexte, afficher « En attente de réponse » et permettre de répondre plus tard dans Team ou la session native puis de reprendre. Un timeout, une nouvelle échéance ou l’absence de réponse ne valent jamais approbation. Les choix automatiques ne sont permis que pour des défauts explicitement autorisés par la configuration.

## 1. Itérer sur le plan depuis le thread du Reviewer

- [ ] Permettre la discussion et la proposition de révisions du plan dans la session du Reviewer, depuis Team et depuis le thread natif.
- [ ] Récupérer une version finale structurée et validée du plan dans le workflow ; identifier clairement le plan retenu et sa provenance.
- [ ] Conserver les versions précédentes, les décisions et les sessions. Une discussion ne doit pas remplacer silencieusement le plan approuvé.
- [ ] Invalider l’ancienne approbation lorsque le plan ou les commandes de test changent ; respecter ensuite la politique de validation configurée.
- [ ] Tester l’itération multi-tours, la récupération de réponse native, le changement de modèle, les réponses invalides, les actions concurrentes et la reprise après redémarrage sans double envoi.

## 2. Questions de clarification du Planner, avec propositions

- [ ] Le Planner peut signaler une ambiguïté et poser une ou plusieurs questions avant de finaliser son plan.
- [ ] Présenter des choix concrets, une proposition recommandée et ses compromis, avec réponse libre possible ; éviter les questions vagues qui renvoient tout le travail à l’utilisateur.
- [ ] Afficher et permettre les réponses depuis Team ; réconcilier aussi les réponses données dans la session native lorsque l’API le permet.
- [ ] Persister les réponses et décisions dans le contexte partagé. Ne pas lancer le Builder avant résolution d’une clarification bloquante.
- [ ] Définir explicitement le comportement des trois politiques de validation : une absence de réponse ne vaut jamais approbation.
- [ ] Tester les réponses partielles, doublons, refus, reprise, permissions natives et conservation du contexte.
- [ ] Tester l’utilisateur absent : question persistante et reprise ultérieure, sans réponse supposée, sans double envoi ni démarrage prématuré du Builder.

## 3. Workflows personnalisés et boucles configurables

- [ ] Fournir un preset simple Code ↔ Review, avec tests configurables et limite de corrections explicite.
- [ ] Permettre de créer, nommer, sauvegarder, modifier, importer et exporter ses propres workflows versionnés.
- [ ] Permettre un nombre et un ordre d’étapes personnalisés, leurs harnais/modèles/permissions et leurs conditions de transition ; ne pas limiter le moteur à trois rôles fixes.
- [ ] Représenter clairement les étapes, branches, conditions, boucles, points humains et limites dans l’interface. Prévoir une création utilisable sans écrire soi-même du JSON.
- [ ] Valider les graphes avant lancement : références inconnues, étapes inaccessibles, sorties ambiguës et boucles sans limite ne doivent pas être exécutées silencieusement.
- [ ] Garder le verrou par dépôt, les contrats de résultats, l’idempotence, la reprise et les propriétés de lecture seule pour les étapes d’analyse.
- [ ] Préserver les configurations et états V1 existants via migration et tests de compatibilité. Ne pas réinterpréter silencieusement un workflow déjà commencé.
- [ ] Tester le preset historique, Code ↔ Review et un graphe entièrement personnalisé, avec échecs, limites, permissions, redémarrages et clients concurrents.

## 4. Langue de l’application dans Team

- [ ] Vérifier l’API officielle qui expose la langue de l’application, puis l’utiliser pour l’interface Team et les consignes de réponse des agents.
- [ ] Localiser les boutons, erreurs, statuts, étapes, questions, bilans, historique et cartes natives. Commencer au minimum par français et anglais.
- [ ] Prévoir un repli explicite si un client ne transmet pas sa langue ; ne pas prétendre suivre une préférence inaccessible. Proposer une sélection locale si nécessaire.
- [ ] Définir la langue persistée d’un workflow et le comportement lors d’un changement de langue ou de clients de langues différentes.
- [ ] Conserver tels quels le code, les identifiants, commandes et sorties brutes des outils ; traduire les explications et les libellés.
- [ ] Tester français/anglais, changement de langue, reprise, export/import et libellés longs en format mobile.

## Validation transversale avant clôture

- [ ] `npm run check` vert et tests de régression ciblés sur les quatre axes.
- [ ] Essai réel isolé : clarification → itération du plan avec Reviewer → plan final approuvé → workflow personnalisé → test/review refusée → correction → validation → bilan.
- [ ] Contrôle desktop et mobile, historique, cartes natives, messages et résultats rendus lisiblement.
- [ ] Compatibilité avec les providers détectés, configurations V1 et workflows persistants existants.
- [ ] Documentation, captures utiles, commits et bilan de livraison à jour ; limites et blocages décrits sans fausse validation.

## Journal des passages

### Mise en place

- État initial : en attente de la première exécution planifiée (premier passage consigné ci-dessous).
- Base connue : `22b6553` ; 97 tests passent après ajout du suivi après validation, des messages et des rendus d’étapes.
- Prochain incrément : examiner les contrats de plan et les messages de suivi pour l’axe 1, puis implémenter une itération du plan réconciliable avant de généraliser le moteur.
- À chaque passage, ajouter : date, axes traités, commits, tests et preuves réelles, limites rencontrées, prochain incrément. Cocher un critère uniquement après vérification.

### 20 octobre 2026, 04:40–04:46 (Europe/Paris) — versions du plan

- **Livré :** `fe7fece` (`Preserve plan versions, provenance and approval history`), premier incrément de l’axe 1. Ajout optionnel de `planVersions` aux états V1 et au résultat de `teams.workflow_record`. Chaque version contient le plan effectif, sa provenance, sa session, son opération et la sélection harnais/modèle/permission lorsqu’elles sont connues. Les approbations conservent leur politique et l’acceptation explicite de l’absence de tests.
- **Comportement :** les modifications humaines des commandes produisent une nouvelle version ; un remplacement par le Planner retire l’approbation courante et l’empreinte de validation sans effacer les anciennes versions/décisions. Les commandes imposées au lancement sont appliquées avant d’enregistrer la version effective. Les politiques existantes restent appliquées : cette fondation ne change pas le choix automatique déjà autorisé par configuration.
- **Compatibilité :** les plans V1 chargés sans historique reçoivent une version `legacy`, sans inventer de session ni de modèle. La date reprend le dernier événement disponible (ou une sentinelle epoch si aucun événement n’existe), pas une date de génération prétendument connue. Les approbations et opérations persistées restent inchangées ; la migration est idempotente. Les nouvelles décisions apparaissent aussi sous forme d’événements lisibles `plan_version` / `plan_approved`.
- **Contrôle préalable :** aucun `AGENTS.md` trouvé ; arbre Git initial propre. `paseo ls --json` et les deux fichiers d’état du plugin ont été contrôlés : seul l’agent de ce passage (`PASEO_AGENT_ID=1d87a262-0a8f-4f61-bd70-39c83f3102e4`) était actif sur ce dépôt ; tous les agents du plugin étaient inactifs et les deux workflows terminés sans opération en cours. Aucun verrou supprimé.
- **Preuves automatisées :** `npm run check` réussi (typecheck, lint, format, **101 tests**, zéro échec), `git diff --check` réussi. Quatre nouveaux tests couvrent l’historique/provenance et les commandes humaines avec replanification/rechargement du Store, les commandes effectives approuvées par configuration, le remplacement invalide sans second Builder et la migration V1 avec opération conservée. Les tests existants de doublons/concurrence et d’acceptation sans tests vérifient aussi l’absence de double décision et la décision archivée. Le runtime des tests moteur est simulé ; il ne constitue pas une conversation réelle avec un modèle.
- **Intégration réelle bornée :** daemon Paseo **0.11.2** séparé sur `127.0.0.1:6879`, home/états/dépôt Git jetables dans `/tmp/teams-roadmap-plan-qvd1kl_p`. Plugin installé localement puis chargé avec statut `running`. Une fixture V1 en pause, avec plan approuvé, a été lue par le véritable RPC `teams.workflow_record` via le transport exporté du SDK installé : version `1`, provenance `legacy`, approbation `legacy`, statut `paused`. Après rechargement du plugin isolé, comparaison profonde de la réponse : identique. `paseo ls --home … --json` renvoie `[]` : aucun agent/modèle lancé. Daemon isolé arrêté en fin de test. Script et réponses locales : `/tmp/teams-roadmap-plan-integration.mts`, `record-before-reload.json` ; contrôle complet : `/tmp/teams-roadmap-plan-check.log`.
- **Incident isolé résolu :** le premier démarrage avec la configuration minimale avait laissé les fonctions vocales par défaut actives, provoquant un téléchargement automatique puis une erreur de quota d’écriture. Arrêt du seul daemon isolé, suppression de son seul répertoire de modèles jetable, puis redémarrage avec `features.dictation.enabled=false`, `features.voiceMode.enabled=false` et `pluginsEnabled=true`. Aucun changement de configuration principal.
- **Rechargement principal :** après nouvelle vérification d’inactivité, seul `paseo plugin reload paseo-agent-teams` a été exécuté. Statut `running` ; PID superviseur **1923177** et worker **1923188** inchangés ; SHA-256 des deux états persistés inchangés. Preuves locales : `primary-before.json` / `primary-after.json` dans le répertoire isolé. Aucun redémarrage du daemon principal.
- **Limites et couverture :** aucune case fonctionnelle globale cochée. Cet incrément est la fondation de traçabilité ; il n’ajoute pas encore la discussion Reviewer ni l’adoption de son plan. Aucun nouvel essai avec modèle réel, navigateur ou appareil mobile ; l’interface n’a pas changé. Axes 2–4 et validation transversale encore ouverts.
- **Prochain incrément :** action explicite de discussion/révision du plan dans la session Reviewer, contrat de réponse distinguant discussion et proposition structurée, adoption explicite d’une nouvelle version avec provenance Reviewer et application de la politique d’approbation. Couvrir réponses invalides, plusieurs tours, réception native, pause/reprise et absence de double envoi avant de cocher les critères correspondants.
- **Intervention nécessaire :** aucune. Aucune question utilisateur ouverte. Tâche `f873454c` laissée active : la couverture complète n’est pas atteinte.

### 20 octobre 2026, 09:40–09:48 (Europe/Paris) — discussion et adoption du plan Reviewer

- **Livré :** `b284b7f` (`Discuss and explicitly adopt versioned Reviewer plan proposals`), deuxième incrément de l’axe 1. Au checkpoint d’un workflow automatique possédant un plan, le message peut être envoyé avec **Réviser le plan avec le Reviewer**. Le moteur réutilise la session Reviewer et exige une réponse structurée distinguant `discussion` et `proposal`. Une proposition complète est persistée séparément (`planProposal` : plan, motif, version de départ, session, opération, sélection harnais/modèle/permission et date). Les réponses et décisions antérieures restent dans les événements ; la discussion ne remplace ni le plan ni son approbation.
- **Adoption et politiques :** **Adopter ce plan** crée une version `reviewer`, avec la provenance de la proposition même si le modèle a été changé ensuite. Retrait de l’approbation courante et de l’empreinte de tests ; application de la politique existante (`plan`, `final`, `autonomous`), y compris les commandes explicitement imposées au lancement et l’acceptation explicite de l’absence de tests. Une pause reste une pause ; la reprise retrouve le checkpoint d’approbation si nécessaire. Un changement de plan invalide la proposition en attente. Les versions et approbations historiques restent conservées. Aucun nouveau droit d’exécution implicite n’est ajouté.
- **Interface :** proposition lisible et bouton d’adoption distincts ; numéro et provenance du plan à approuver ; JSON de discussion/proposition rendu en Markdown dans les composants partagés Team/historique/cartes natives. Correction du rafraîchissement des commandes à approuver lorsque la version change sans changement du résumé (tout en conservant un brouillon humain lors d’un simple rafraîchissement). Documentation d’utilisation ajoutée au README.
- **Contrôle préalable :** aucun `AGENTS.md` dans le dépôt ni ses parents applicables ; arbre initial propre, derniers commits lus. `paseo ls --json` : seul l’agent de ce passage (`a901576d-8223-4678-9de6-c5260d23bde6`) actif sur ce dépôt, les agents du plugin inactifs. Les deux workflows principaux sont `completed` sans opération. Aucun verrou supprimé, aucune modification utilisateur trouvée ou écrasée.
- **Preuves automatisées :** `npm run check` réussi sur le code final : typecheck, ESLint, Prettier et **108 tests**, zéro échec ; `git diff --check` réussi. Sept nouveaux tests couvrent les discussions et propositions multi-tours avec conservation du plan, la persistance et la provenance après changement de modèle, les réponses invalides, l’adoption idempotente et les clients concurrents sous les trois politiques, l’invalidation après replanification, la pause/reprise avec opération conservée et sans second envoi, la détection d’une écriture pendant la lecture seule et le rendu lisible. Le test de panneau existant a été étendu pour les actions révision/adoption en modes compact et large, leur désactivation pendant un tour et le renouvellement des commandes pour un même résumé. **Ces tests utilisent des runtimes/hôtes simulés** ; pas de nouveau test navigateur ni d’appareil mobile physique. Log local : `/tmp/teams-roadmap-reviewer-check.log`.
- **Intégration réelle bornée :** daemon Paseo **0.11.2** indépendant sur `127.0.0.1:6879`, home/données/dépôt Git jetables : `/tmp/teams-roadmap-reviewer-wn5s2rno`. Voix/dictée désactivées dans ce seul home avant démarrage. SDK officiel installé : ouverture du workspace `wks_77f9781601fd5409`, inventaire réel des providers puis sélection de **Codex `gpt-6.1-sol`**, présent dans cet inventaire. Fixture V1 approuvée migrée en v1 `legacy` ; deux vrais tours Reviewer via `teams.action` ont produit une discussion en français puis un plan proposant la vérification des liens du README. Après chaque tour, comparaison du plan courant et de son approbation : inchangés. Rechargement du seul plugin isolé, comparaison de la proposition persistée, puis adoption : v2 `reviewer`, statut `awaiting_plan`, `testsApproved=false`, approbation historique `legacy` conservée. **Deux dispatchs Reviewer, zéro dispatch Planner/Builder** (les trois sessions ont été créées, seul le Reviewer a reçu des prompts). Dépôt isolé resté propre. Attente bornée à 150 s par tour, aucune boucle de modèles.
- **Reprise réelle :** arrêt puis redémarrage du seul daemon isolé ; comparaison des versions et du plan adopté, statut `awaiting_plan` et absence d’approbation : identiques. Daemon isolé arrêté en fin d’essai. Ce redémarrage au checkpoint valide la persistance ; la reprise d’un tour actif sans second envoi est couverte ici par le test simulé, pas par un nouvel essai réel en cours de génération. Scripts locaux : `/tmp/teams-roadmap-reviewer-discover.mts`, `/tmp/teams-roadmap-reviewer-integration.mts` (modes `seed`, `run`, `adopt`, `compare`). Preuves locales dans le répertoire isolé : `discovery.json`, `discussion.json`, `proposal-before-reload.json`, `adopted.json`, état et `daemon-run.log`. Lors de la préparation, la fixture écrite après initialisation du cache n’était pas encore visible ; un rechargement du seul plugin isolé avant les tours réels a permis sa lecture. Aucun succès n’est déduit de cette tentative de préparation.
- **Rechargement principal :** après une nouvelle vérification d’inactivité des agents du plugin et des workflows, `paseo plugin reload paseo-agent-teams` exécuté ; statut `running`. PID superviseur **1923177**, worker **1923188** et SHA-256 des deux états principaux strictement inchangés. Preuves : `primary-before.json` et `primary-after.json` dans le répertoire isolé ; script local `/tmp/teams-roadmap-reviewer-primary.py`. Aucun redémarrage du daemon principal.
- **Limites / couverture :** aucune case globale cochée : la discussion initiée dans Team et son adoption fonctionnent, mais l’import explicite de tours supplémentaires initiés directement dans le thread natif du Reviewer reste à implémenter. Le runtime conserve volontairement comme ambiguë une opération suivie d’un autre prompt natif ; ne pas retirer ce garde-fou sans contrat et tests. L’affichage détaillé de toutes les versions historiques peut encore être amélioré ; les données complètes sont présentes dans le record. Aucun essai réel Claude supplémentaire ni vérification physique mobile dans ce passage. Les axes 2–4 restent ouverts et l’essai transversal complet n’est pas réalisé.
- **Prochain incrément :** définir une récupération explicite, bornée et réconciliable des propositions depuis la timeline native du Reviewer (curseur/identifiant du tour et choix explicite du résultat), conserver les échanges et décisions, gérer les prompts concurrents et les réponses invalides sans transformer un silence en approbation. Tester un échange natif réel et une reprise pendant un tour ; ensuite avancer vers les questions persistantes du Planner. Réutiliser les contrats discussion/proposition et l’adoption, sans refaire la traçabilité déjà validée.
- **Intervention nécessaire :** aucune ; aucune question utilisateur ouverte. Tâche `f873454c` laissée active, la couverture complète n’étant pas atteinte.

### 20 octobre 2026 — workflow sur plusieurs dépôts depuis un parent sans Git

- **Demande directe livrée :** sélection de plusieurs dépôts dans un seul workflow, depuis un dossier de coordination sans Git. Découverte bornée des dépôts enfants, sélection visible dans Team et ajout de chemins absolus ou relatifs, y compris hors du parent. Le périmètre affiché est figé au lancement ; aucun `git init` du parent.
- **Moteur :** verrouillage de tous les dépôts sélectionnés avant capture initiale, prise en compte des worktrees partageant un Git common-dir, snapshots/diffs/empreintes par dépôt et conservation de l’index et des fichiers préexistants. Compatibilité des workflows persistés à dépôt unique conservée. Les agents restent dans le dossier de coordination et reçoivent les racines sélectionnées ; les commandes de test précisent leur dossier. La livraison peut demander une PR par dépôt.
- **Preuves :** `npm run check` réussi, **116 tests** ; cas de découverte, sélection externe, index initialement modifié, fichiers non suivis, worktrees, verrous secondaires, créations concurrentes avant snapshot et états corrompus. Essai réel isolé Codex sur deux dépôts : plan approuvé → implémentation → deux commandes `node --test` réussies → revue favorable. Index et fichiers protégés inchangés, parent toujours sans Git. Preuves locales : `/tmp/teams-multirepo-live-XiiSn2/result.json` et `workflow.json`.
- **Interface réelle :** navigateur desktop et viewport mobile 390×844, sélection/désélection et application des chemins, lancement disponible depuis le parent sans Git, aucune erreur navigateur ni débordement horizontal. Captures et `ui-result.json` dans `/tmp/paseo-agent-teams-smoke.rKjEX5/browser/`. Aucun essai physique iOS supplémentaire.
- **Suite :** cette demande complète le périmètre de travail ; elle ne clôt aucun des quatre axes ci-dessus. Continuer l’itération Reviewer et les clarifications persistantes selon les prochains incréments déjà consignés. L’ajout d’un dépôt à un workflow déjà lancé nécessite un nouveau workflow avec le périmètre étendu.

## Tâche Paseo enregistrée

- Nom : Agent Teams — roadmap et tests (5 h)
- Identifiant : `f873454c`
- Cadence : intervalle exact de 18 000 000 ms (5 heures), première exécution différée.
- Premier passage : mardi 20 octobre 2026 à 04:40 (Europe/Paris).
- Agent : `codex/gpt-6.1-sol`, mode natif `full-access`, dans ce dépôt.
- Affichage et contrôle : vue **Schedules** de Paseo.
- Mettre cette tâche en pause après validation finale : `paseo schedule pause f873454c`.
- Le daemon et l’hôte doivent fonctionner pour exécuter les passages ; les journaux sont conservés dans Paseo.
