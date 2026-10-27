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
