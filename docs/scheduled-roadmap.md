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

- État : en attente de la première exécution planifiée.
- Base connue : `22b6553` ; 97 tests passent après ajout du suivi après validation, des messages et des rendus d’étapes.
- Prochain incrément : examiner les contrats de plan et les messages de suivi pour l’axe 1, puis implémenter une itération du plan réconciliable avant de généraliser le moteur.
- À chaque passage, ajouter : date, axes traités, commits, tests et preuves réelles, limites rencontrées, prochain incrément. Cocher un critère uniquement après vérification.

## Tâche Paseo enregistrée

- Nom : Agent Teams — roadmap et tests (5 h)
- Identifiant : `f873454c`
- Cadence : intervalle exact de 18 000 000 ms (5 heures), première exécution différée.
- Premier passage : mardi 20 octobre 2026 à 04:40 (Europe/Paris).
- Agent : `codex/gpt-6.1-sol`, mode natif `full-access`, dans ce dépôt.
- Affichage et contrôle : vue **Schedules** de Paseo.
- Mettre cette tâche en pause après validation finale : `paseo schedule pause f873454c`.
- Le daemon et l’hôte doivent fonctionner pour exécuter les passages ; les journaux sont conservés dans Paseo.
