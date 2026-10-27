import { clarificationSchema } from './contracts';

export function deliveryMethod(text?: string) {
  const value = text?.trim().toLowerCase();
  return value === 'pr' || value === 'pull_request' ? 'pull_request' : value === 'main' ? 'main' : undefined;
}

export const deliveryQuestion = clarificationSchema.parse({
  kind: 'clarification',
  summary: 'Les tests et la revue sont validés. Votre accord est nécessaire pour livrer les travaux.',
  questions: [
    {
      id: 'delivery',
      title: 'Comment souhaitez-vous livrer les travaux validés ?',
      recommendedOptionId: 'pull_request',
      options: [
        {
          id: 'pull_request',
          label: 'PR',
          tradeoff: 'Créer ou réutiliser une pull request pour relire les changements avant intégration.',
        },
        {
          id: 'main',
          label: 'main',
          tradeoff: 'Intégrer les changements validés sur main en local, sans pousser main sur le dépôt distant.',
        },
      ],
    },
  ],
});
