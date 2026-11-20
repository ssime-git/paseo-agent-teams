export class TeamError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = code;
  }
}

/** The checkpoint that owns a repository reservation. */
export class RepositoryBusy extends TeamError {
  constructor(readonly blocker: { id: string; workspaceId: string; task: string }) {
    super(
      'REPOSITORY_LOCKED',
      `Another workflow holds this repository: ${blocker.id} (workspace ${blocker.workspaceId}). Open Agent Teams there to resume or close it.`,
    );
  }
}
