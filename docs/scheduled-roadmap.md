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

## Tâche Paseo enregistrée

- Nom : Agent Teams — roadmap et tests (5 h)
- Identifiant : `f873454c`
- Cadence : intervalle exact de 18 000 000 ms (5 heures), première exécution différée.
- Premier passage : mardi 20 octobre 2026 à 04:40 (Europe/Paris).
- Agent : `codex/gpt-6.1-sol`, mode natif `full-access`, dans ce dépôt.
- Affichage et contrôle : vue **Schedules** de Paseo.
- Mettre cette tâche en pause après validation finale : `paseo schedule pause f873454c`.
- Le daemon et l’hôte doivent fonctionner pour exécuter les passages ; les journaux sont conservés dans Paseo.
