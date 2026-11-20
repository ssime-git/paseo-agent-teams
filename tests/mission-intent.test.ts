import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewOnlyTask } from '../server/mission-intent';
test('review launch hints honor negated writes and do not absorb implementation followed by review', () => {
  for (const text of [
    'Réalise la revue de la PR 18. Ne corrige aucun fichier.',
    'Fais uniquement une revue en lecture seule de price.cjs : total(5,3) doit valoir 15.',
    'Review PR 18, do not edit files',
    'Audit this module',
  ])
    assert.equal(reviewOnlyTask(text), true, text);
  for (const text of [
    'Implémente la fonctionnalité puis fais une revue',
    'Add tests and review the result',
    'Crée un composant avec une revue indépendante',
    'Corrige les erreurs signalées par la revue',
    'Prépare une réponse',
  ])
    assert.equal(reviewOnlyTask(text), false, text);
});
