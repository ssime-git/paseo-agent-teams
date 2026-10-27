import type { Translate } from '../shared/i18n';
import { translator } from '../shared/i18n';
const french = translator('fr');

/** French source texts, translated at display time (see `tests/i18n.test.ts`). */
export const errorTexts: Record<string, string> = {
  REPOSITORIES_REQUIRED:
    'Sélectionnez au moins un dépôt Git accessible, ou ajoutez son chemin dans les dépôts du workflow.',
  REPOSITORY_LIMIT: 'Sélectionnez au plus 20 dépôts pour ce workflow.',
  REPOSITORY_CHANGED: 'Un dépôt a changé de chemin ou d’identité Git. Vérifiez le périmètre avant de reprendre.',
  VALIDATION_REQUIRED:
    'Le dépôt doit correspondre à une validation réussie avant de créer une PR. Repassez par le Plan pour valider les changements actuels.',
  CHECKPOINT_REQUIRED: 'Attendez la fin du tour courant ou réconciliez l’opération en attente avant de continuer.',
  MODE_UNAVAILABLE: 'Cette permission n’est pas disponible.',
  PROVIDER_UNAVAILABLE: 'Le harnais ou le modèle choisi n’est pas disponible.',
  READ_ONLY_REQUIRED: 'Ce rôle nécessite une permission de lecture seule.',
  STATE_FILENAME_MISMATCH: 'Le nom du fichier ne correspond pas au workflow.',
  INVALID_WORKFLOW_ID: 'Identifiant de workflow invalide.',
  WORKFLOW_NOT_FOUND: 'Workflow introuvable.',
  WORKSPACE_ACCESS_DENIED: 'Accès au workspace refusé.',
  PLUGIN_DISPOSED: 'Le plugin est arrêté.',
  WORKSPACE_NOT_FOUND: 'Workspace introuvable.',
  WORKSPACE_DIRECTORY_MISSING: 'Le workspace ne possède pas de dossier.',
  DATA_DIRECTORY_RELATIVE: 'Le dossier de données doit être absolu.',
  DATA_DIRECTORY_IN_REPOSITORY: 'Le dossier de données doit être situé hors du dépôt.',
  TIMELINE_CHANGED: 'L’historique a changé pendant la reprise.',
  TESTS_NOT_APPROVED: 'Les commandes de test doivent être approuvées.',
  REQUEST_ID_CONFLICT: 'Cet identifiant de requête a déjà été utilisé avec un autre contenu.',
  REPOSITORY_LOCKED: 'Un autre workflow utilise ce dépôt. Reprenez-le ou terminez-le.',
  REVISION_CONFLICT: 'Le workflow a changé. Actualisez avant de réessayer.',
  WORKFLOW_COMPLETED: 'Le workflow est déjà terminé.',
  PLAN_MISSING: 'Aucun plan à approuver.',
  PLAN_REVISION_UNAVAILABLE: 'La révision nécessite un workflow automatique en cours avec un plan enregistré.',
  PLAN_PROPOSAL_STALE: 'Aucune proposition de la Revue applicable au plan courant. Demandez une nouvelle révision.',
  NO_TESTS_APPROVAL_REQUIRED: 'Acceptez explicitement l’absence de tests.',
  APPROVAL_NOT_PENDING: 'Aucune approbation en attente.',
  HANDOFF_ROLE_REQUIRED: 'Choisissez un rôle pour le transfert manuel.',
  MESSAGE_EMPTY: 'Le message ne peut pas être vide.',
  ACTIVE_STEP: 'Mettez en pause et attendez la fin de l’étape active avant de fermer.',
  AGENT_UNAVAILABLE: 'Un agent est actif ou injoignable. Attendez avant de fermer.',
  APPROVAL_REQUIRED: 'Une approbation est nécessaire.',
  POSIX_REQUIRED: 'Les commandes de test nécessitent un shell POSIX. Windows n’est pas pris en charge.',
  CORRUPT_STATE: 'Un état corrompu peut verrouiller un dépôt. Réparez les fichiers isolés avant de créer un workflow.',
  NOT_GIT_REPOSITORY: 'Ce chemin n’est pas un dépôt Git accessible. Vérifiez les dépôts sélectionnés pour le workflow.',
};
export function errorMessage(error: unknown, t: Translate = french) {
  const text = String(error);
  for (const [code, message] of Object.entries(errorTexts)) {
    if (text.includes(code + ':')) return t(message);
  }
  return text;
}
