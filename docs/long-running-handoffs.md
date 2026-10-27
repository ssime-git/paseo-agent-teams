# Reprise des tâches longues — 27 octobre 2026

Analyse en lecture seule de la dernière mission enregistrée, `c42a15ba-3e6e-4b6e-bd74-6f74895ce7d8`, dans `~/.local/state/paseo-agent-teams`. Horaires ci-dessous en UTC.

La mission contient 27 dispatchs et 7 événements `timeout`. Le cas le plus net :

| Heure | Événement |
| --- | --- |
| 19:24:20 | Dispatch Code, opération `5621b7a1-ca39-4d91-b493-9b47ec151a5d`. |
| 19:25:20 | Premier timeout. |
| 19:26:21 | Deuxième timeout. |
| 19:27:22 | Troisième timeout : passage en `attention`, opération conservée. |
| 19:37:38 | Reprise explicite, puis consommation du résultat Code. |
| 19:38:50 | Vérifications terminées, dispatch Review. |

Cette chronologie prouve l'arrêt de l'enchaînement sur les délais d'observation. Elle ne donne pas l'heure exacte à laquelle Code a terminé.

Deux causes dans le code : `PaseoRuntime.run` puis `reconcile` attendaient chacun jusqu'à 60 secondes ; le moteur comptait ces délais et s'arrêtait au troisième. Le hook sauvegardait déjà un reçu, mais ne réveillait un workflow en `attention` que si sa boîte de réception contenait un message utilisateur. Le provider gardait aussi le tour principal ouvert pour mettre à jour les lignes natives de sous-agents.

La correction envoie chaque opération une seule fois, libère le moteur et ferme le tour principal. `agent.turn_ended` sert de notification de reprise : identité du membre, marqueur de l'opération et reçu durable. Le moteur valide le résultat puis choisit le prochain rôle selon l'étape, les tests et la revue. Les doublons du hook sont ignorés ; une fin arrivant avant l'accusé d'envoi ou pendant la sortie du moteur ne perd pas son réveil. Les pauses et la reprise explicite après redémarrage restent respectées.

Une mention textuelle entre membres ne suffit pas à prouver une fin ni à autoriser un nouvel envoi. Le hook fournit déjà ce passage de relais pour le pipeline Plan → Code → tests → Review. Un protocole de consultations libres entre membres, avec mise en attente puis retour au demandeur, reste une extension distincte ; il n'est pas ajouté par cette correction. Les graphes admis conservent leur continuation explicite.

Le suivi en cours reste disponible dans Team et les sessions natives. Les comptes rendus et sorties de vérification sont publiés dans le fil une fois terminés, pour éviter de conserver un tour ouvert ou de dupliquer les lignes natives.

Le dernier état de cette mission est un blocage de livraison distinct : création initiale de `main` requise pour la PR, mais interdite par le prompt de livraison. Ce blocage n'est pas un timeout et la mission existante n'a pas été modifiée pendant l'analyse.

Validation locale : typage, lint et formatage passent ; 336 tests sur 339 passent. Les trois échecs (`PR receipts…`, `failures, timeouts and output limits…`, `consumption keeps missing…`) sont également reproduits sur une copie intacte de `HEAD`, hors des fichiers modifiés. Les nouveaux cas couvrent le relais complet Plan → Code → tests → Review, les doubles hooks, la fin avant accusé d'envoi, les tâches longues, les anciens arrêts par timeout et les pauses explicites. Les tests des hooks et du provider utilisent des événements simulés ; aucune nouvelle exécution avec modèles réels ni aucun rechargement du daemon principal n'est revendiqué. Logs : `/tmp/paseo-event-check-final.log` et `/tmp/paseo-event-baseline.log`.

## Cartes de progression intercalées dans la timeline

Un nouveau blocage apparaît sur le suivi lancé à 19:57:48 UTC, opération `b43f59d2-f747-42cf-a551-04a046a9ce79`. Le Planner est au repos et sa réponse structurée est présente dans le tour natif `foreground-turn-18`, séquence finale 2363. Le reçu est absent ; les deux reprises à 19:58:49 et 19:58:55 ne peuvent donc pas consommer cette réponse.

La timeline canonique contient aussi les cartes `agent-teams-progress` du plugin, sans `turnId`. Leurs plages de séquence peuvent chevaucher les tours natifs : une carte commence à 2265 et sa dernière mise à jour atteint 2368, autour du prompt à 2267 et de la réponse à 2273–2363. Le lecteur du hook rejetait ces métadonnées comme une ambiguïté native. La correction ignore les éléments `plugin` pour l'attribution des tours, conserve les curseurs réels de pagination et maintient les refus sur les messages natifs étrangers ou incomplets. Les pages constituées uniquement de cartes sont aussi couvertes.

Pour les réponses de coordination en lecture seule dont le hook a déjà été perdu, une reprise explicite peut importer l'échange natif exact : opération liée au dernier prompt, tour unique, réponse structurée, agents au repos, même workspace et répertoire, deux lectures identiques et empreinte du dépôt inchangée. L'import est journalisé avec sa source native. Il ne crée aucun reçu de hook et ne réenvoie pas le prompt. Cette exception ne s'applique ni aux implémentations ni aux verdicts de revue. Une lecture de hook impossible est désormais signalée dans les logs du plugin.

Validation de cette correction : **346 tests passent**, avec typage, lint et formatage valides (`/tmp/paseo-progress-hooks-check.log`). La suite a été exécutée hors sandbox ; les trois échecs précédemment reproduits sur HEAD disparaissent également dans cet environnement.

Après rechargement du plugin principal, la reprise explicite a importé uniquement la réponse existante de `b43f59d2`, sans fabriquer de reçu. Le relais réel a ensuite fonctionné : Code `f4375926` terminé à 20:06:09 avec reçu officiel, puis Planner `8b09f525` terminé à 20:06:23 avec reçu officiel. Le message utilisateur en file a été pris en charge automatiquement par Planner `4a305533`, terminé à 20:06:39. La mission est revenue au checkpoint de livraison, sans opération conservée. La livraison reste bloquée par l'écriture interdite dans `.git` ; la réponse au message en file demande aussi de préciser le mot « tinier ». Ces attentes sont distinctes de la perte du hook et ne justifient aucun renvoi automatique de tâche.
