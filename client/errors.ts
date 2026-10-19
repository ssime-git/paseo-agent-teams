const messages: Record<string, string> = {
  VALIDATION_REQUIRED:
    'Le dépôt doit correspondre à une validation réussie avant de créer une PR. Repassez par le Planner pour valider les changements actuels.',
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
  NO_TESTS_APPROVAL_REQUIRED: 'Acceptez explicitement l’absence de tests.',
  APPROVAL_NOT_PENDING: 'Aucune approbation en attente.',
  HANDOFF_ROLE_REQUIRED: 'Choisissez un rôle pour le transfert manuel.',
  MESSAGE_EMPTY: 'Le message ne peut pas être vide.',
  ACTIVE_STEP: 'Mettez en pause et attendez la fin de l’étape active avant de fermer.',
  AGENT_UNAVAILABLE: 'Un agent est actif ou injoignable. Attendez avant de fermer.',
  APPROVAL_REQUIRED: 'Une approbation est nécessaire.',
  SNAPSHOT_TOO_LARGE: 'L’instantané dépasse 20 Mio. Réduisez les fichiers du dépôt à analyser.',
  POSIX_REQUIRED: 'Les commandes de test nécessitent un shell POSIX. Windows n’est pas pris en charge.',
  CORRUPT_STATE: 'Un état corrompu peut verrouiller un dépôt. Réparez les fichiers isolés avant de créer un workflow.',
  NOT_GIT_REPOSITORY: 'Ce dossier n’est pas un dépôt Git accessible. Ouvrez le workspace du dépôt à traiter.',
};
export function errorMessage(error: unknown) {
  const text = String(error);
  for (const [code, message] of Object.entries(messages)) {
    if (text.includes(code + ':')) return message;
  }
  return text;
}
