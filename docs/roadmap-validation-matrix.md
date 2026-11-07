# Couverture restante au 7 novembre 2026

Cette matrice complète le journal `scheduled-roadmap.md`. Les essais réels cités
ont été réalisés aux passages indiqués ; leur consultation ne constitue pas un
nouvel essai. Les preuves `/tmp` sont locales, les procédures et harnais sont
versionnés dans le dépôt.

| Critère encore ouvert | Couverture acquise | Limite et prochaine action |
| --- | --- | --- |
| Reviewer multi-tours, modèle, entrées invalides, concurrence, reprise | `c3c5a9d`, moteur et Store réels avec modèles simulés ; imports natifs réels des 3 et 5 novembre | Pas de changement réel de modèle pendant génération. Refus Write dans un workflow Team désormais réel (7 novembre 16:40), distinct d’une permission de mode du Reviewer ; conserver cette distinction. |
| Clarification partielle, doublons, refus, contexte | `cedceb6` : réponse native partielle, réponse Team concurrente, deux reconstructions et rejeu ; `c3c5a9d` : refus natif simulé | Refus natif Claude Write réel le 6 novembre 20:40 (`/tmp/teams-permission-live-1Tn8Dc-proof.json`), sans mutation et avec reprise ; refus Builder via RPC Team réel le 7 novembre 16:40 (`/tmp/teams-denial-live-BMprxx-proof.json`), pause et opération conservées après redémarrage. Pas de permission dans une clarification ni de mode Reviewer réellement refusée. Ne pas refaire la clarification persistante réelle déjà acquise. |
| Preset historique et graphe personnalisé | Correction moteur réelle : `/tmp/teams-engine-live-MdTAfx-proof.json` ; correction graphe : `/tmp/teams-custom-live-2ZGFAz-proof.json` ; budget épuisé : `/tmp/teams-custom-live-4zafSj-proof.json` | Fixtures distinctes. Aucun scénario unique complet revendiqué ; ne pas répéter ces trois boucles. |
| Langue officielle de l'application | `9e77a58` : API cliente officielle 0.13 ; clients FR/EN simultanés desktop/mobile le 4 novembre | Locale serveur native absente : préférence explicite de conversation, puis repli hôte. L'ancienne mention « SDK 0.11.2 sans langue » décrit l'historique, pas le SDK courant. |
| Langue persistée et changement | `12b22a6`, `5b3b7c6`, `fe0c025` ; `/tmp/teams-language-eoWip9-proof.json`, `/tmp/teams-graph-language-sT7QEA-proof.json` avec reprise | Réponses figées à la création ; interface suit le client ; anciens états sans langue gardent leur comportement. Ne pas reprendre l'ancienne règle de changement immédiat pour les réponses d'une mission commencée. |
| Mobile et changement à chaud | `/tmp/roadmap-050940-graph-ui-verified/proof.json` : Chromium 1440 × 1050 et 390 × 844, deux clients, FR → EN, graphes inchangés | Complément réel du 7 novembre 11:40 : formulaire maintenu monté pendant les réglages, objectif et prévisualisation FR conservés, nouvelle prévisualisation EN puis admission explicite desktop/mobile ; `/tmp/roadmap-071140-open-admission-verified/proof.json`. Aucun appareil physique testé. |
| Parcours transversal | Clarification et révision : `/tmp/teams-native-live-iSKyIb-proof.json` ; suites correction/graphe ci-dessus | Preuve composée uniquement. Construire un orchestrateur borné réutilisant les checkpoints et choix explicitement autorisés ; aucun silence ne vaut livraison. |

Les cases transversales restent ouvertes. Priorité : changement réel de modèle
pendant génération, puis parcours transversal borné ; le refus natif Write
rattaché à Team est désormais couvert, sans sortie du dépôt isolé. Ne pas lancer de modèle simplement pour
attendre une permission ou une réponse humaine.

La fixture d'injection moteur fait désormais partie de `npm test` et donc de
`npm run check`. Un marqueur JSON sans identifiant d'opération est refusé et
conservé, au même titre qu'un marqueur corrompu ; il ne prouve jamais une
correction. Les harnais `smoke-*.mjs` restent opt-in et ne sont pas lancés par
ces contrôles locaux.

Le 6 novembre 20:40, `scripts/smoke-native-permission.mjs` a provoqué une vraie
requête Claude `Write`, puis l'a refusée via le SDK officiel. Un seul tour,
fichier inchangé, aucune permission restante ; reprise sans génération et
contenu/identifiant natif du reçu conservés. Le daemon recharge la session en
`closed` et régénère les enveloppes de timeline : aucune identité byte-à-byte
de la timeline n'est revendiquée. Cette preuve concerne une session native
isolée, pas un workflow Team ni Codex. Le refus des imports côté Team reste
couvert par les tests runtime simulés de `c3c5a9d`.

Le 7 novembre 06:40, les régressions de `tests/graph-launcher.test.ts`
provoquent désormais un vrai nouveau rendu React après changement de langue.
Deux cas supplémentaires simulent l’API officielle cliente de locale : changement
avant la prévisualisation et pendant sa requête. Objectif et sélection conservés,
libellés anglais malgré le repli hôte français, langue de prévisualisation figée
puis transmise seulement après confirmation explicite ; aucune continuation
implicite. Le transport RPC et les primitives natives sont simulés : ceci ne
ferme pas le contrôle navigateur/mobile avec formulaire maintenu ouvert ni
l’admission réelle. Le test de reprise après erreur réseau ne se contente plus
de modifier une variable sans rendre de nouveau le composant.

Le 7 novembre 11:40, le harnais navigateur mesure l'identité réelle du champ
objectif avant et après les réglages natifs. Desktop et mobile conservent le
nœud monté, sa valeur et la prévisualisation FR pendant le passage en anglais.
Avec `--admit`, la nouvelle prévisualisation EN est confirmée depuis chaque
browser : deux checkpoints ready sans activation, puis étape humaine sans
dispatch modèle et décision RPC explicite rejouée identiquement. Les états
préexistants restent profondément identiques. Preuve :
`/tmp/roadmap-071140-open-admission-verified/proof.json`. Les premières tentatives
et leur course d'observation sont conservées séparément ; elles ne constituent
pas des succès complets. Le harnais attend désormais la réponse réussie dans
l'interface avant de relire les checkpoints. Ceci ne couvre ni refus natif dans
Team, ni changement de modèle pendant génération, ni parcours transversal unique.


Le 7 novembre 16:40, `scripts/smoke-team-permission.mjs` a rattaché le refus natif
au workflow Team `1b464be8-96f2-4214-ae9a-da15638504d0` : un tour Planner Codex,
approbation Team explicite, un tour Builder Claude Always Ask et une permission
Write réelle. Pause explicite puis refus par `teams.action`, rejoués à l’identique.
Le fichier reste intact, un seul Write failed identifié, aucun outil après refus,
aucun Reviewer, opération conservée en pause. Claude termine en error à cause de
l’interruption `interrupt:true` ; ce n’est pas une complétion Builder réussie.
Après redémarrage isolé : checkpoint et opération profondément identiques,
prompt/reçu natif conservés, aucun nouvel envoi ; diagnostic transitoire système
non restauré, seule différence de contenu tolérée explicitement par le validateur.
Preuve `/tmp/teams-denial-live-BMprxx-proof.json` et fichier `-restart.json` associé.
Les deux premières assertions trop strictes (idle et diagnostic intégral) sont
conservées dans les logs ; capture sans nouveau tour. Aucun parcours navigateur,
permission Codex ou reprise effective de la génération interrompue revendiqué.
