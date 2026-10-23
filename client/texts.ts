import type { Role } from '../shared/contracts';

// French source texts translated where they are shown (see tests/i18n.test.ts).
export const hint: Record<Role, string> = {
  planner: 'Analyse le dépôt et propose le plan, en lecture seule.',
  builder: 'Modifie les fichiers et lance les commandes.',
  reviewer: 'Relit les changements et les tests, en lecture seule.',
};

export const validation = [
  { value: 'plan', label: 'Valider le plan' },
  { value: 'final', label: 'Valider le résultat' },
  { value: 'autonomous', label: 'Validation autonome' },
] as const;
