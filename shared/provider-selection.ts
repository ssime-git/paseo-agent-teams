// These are workflow choices, never provider/model IDs sent to the daemon.
export const DEFAULT_MODEL = '__paseo_default_model__';
export const DEFAULT_MODE = '__paseo_default_mode__';
export const INSTRUCTION_READ_ONLY = '__agent_teams_readonly__';
export const readOnlyMode = (family: string, mode: string) =>
  mode === INSTRUCTION_READ_ONLY || mode === 'read-only' ||
  ((family === 'claude' || family === 'opencode') && mode === 'plan');
