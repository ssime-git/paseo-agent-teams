# Couverture restante au 6 novembre 2026

Cette matrice complète le journal `scheduled-roadmap.md`. Les essais réels cités
ont été réalisés aux passages indiqués ; leur consultation ne constitue pas un
nouvel essai. Les preuves `/tmp` sont locales, les procédures et harnais sont
versionnés dans le dépôt.

| Critère encore ouvert | Couverture acquise | Limite et prochaine action |
| --- | --- | --- |
| Reviewer multi-tours, modèle, entrées invalides, concurrence, reprise | `c3c5a9d`, moteur et Store réels avec modèles simulés ; imports natifs réels des 3 et 5 novembre | Pas de changement réel de modèle pendant génération ni de permission native réellement émise/refusée. Tester séparément ces frontières avec budget explicite. |
| Clarification partielle, doublons, refus, contexte | `cedceb6` : réponse native partielle, réponse Team concurrente, deux reconstructions et rejeu ; `c3c5a9d` : refus natif simulé | Les permissions restent simulées. Ne pas refaire la clarification persistante réelle déjà acquise. |
| Preset historique et graphe personnalisé | Correction moteur réelle : `/tmp/teams-engine-live-MdTAfx-proof.json` ; correction graphe : `/tmp/teams-custom-live-2ZGFAz-proof.json` ; budget épuisé : `/tmp/teams-custom-live-4zafSj-proof.json` | Fixtures distinctes. Aucun scénario unique complet revendiqué ; ne pas répéter ces trois boucles. |
| Langue officielle de l'application | `9e77a58` : API cliente officielle 0.13 ; clients FR/EN simultanés desktop/mobile le 4 novembre | Locale serveur native absente : préférence explicite de conversation, puis repli hôte. L'ancienne mention « SDK 0.11.2 sans langue » décrit l'historique, pas le SDK courant. |
| Langue persistée et changement | `12b22a6`, `5b3b7c6`, `fe0c025` ; `/tmp/teams-language-eoWip9-proof.json`, `/tmp/teams-graph-language-sT7QEA-proof.json` avec reprise | Réponses figées à la création ; interface suit le client ; anciens états sans langue gardent leur comportement. Ne pas reprendre l'ancienne règle de changement immédiat pour les réponses d'une mission commencée. |
| Mobile et changement à chaud | `/tmp/roadmap-050940-graph-ui-verified/proof.json` : Chromium 1440 × 1050 et 390 × 844, deux clients, FR → EN, graphes inchangés | Nouvelle prévisualisation après changement couverte ; maintien d'un formulaire ouvert et admission depuis ce navigateur non couverts. Aucun appareil physique testé. |
| Parcours transversal | Clarification et révision : `/tmp/teams-native-live-iSKyIb-proof.json` ; suites correction/graphe ci-dessus | Preuve composée uniquement. Construire un orchestrateur borné réutilisant les checkpoints et choix explicitement autorisés ; aucun silence ne vaut livraison. |

Les cases transversales restent ouvertes. Priorité : vérifier si les modes des
providers détectés permettent de provoquer une permission native sans sortie du
dépôt isolé ; sinon consigner précisément cette limite, puis avancer sur le
parcours transversal indépendant. Ne pas lancer de modèle simplement pour
attendre une permission ou une réponse humaine.

La fixture d'injection moteur fait désormais partie de `npm test` et donc de
`npm run check`. Un marqueur JSON sans identifiant d'opération est refusé et
conservé, au même titre qu'un marqueur corrompu ; il ne prouve jamais une
correction. Les harnais `smoke-*.mjs` restent opt-in et ne sont pas lancés par
ces contrôles locaux.
