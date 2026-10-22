import { configSchema, roles, type Config } from '../shared/contracts';
import { readOnlyMode, parseProvider } from '../shared/provider-selection';
export function initialConfig(): Config {
  return {
    version: 1,
    mode: 'auto',
    roles: {
      planner: { provider: '', modeId: '' },
      builder: { provider: '', modeId: '' },
      reviewer: { provider: '', modeId: '' },
    },
    validation: 'plan',
    autoFix: true,
    builderAutoAccept: true,
    freshSessionPerCycle: false,
    maxCorrections: 2,
    recovery: 'explicit',
    testCommands: [],
    allowNoTests: false,
  };
}
export function exportConfig(config: Config) {
  return JSON.stringify(configSchema.parse(config), null, 2);
}
export function importConfig(text: string) {
  return configSchema.parse(JSON.parse(text));
}
export function commandsFromText(text: string) {
  return text
    .split('\n')
    .map((command) => command.trim())
    .filter(Boolean)
    .map((command) => ({ command, timeoutMs: 600_000 }));
}
export const isReadOnly = readOnlyMode;
export function configurationIssue(config: Config, providers?: { id: string; family?: string }[]) {
  for (const role of roles) {
    const selection = config.roles[role];
    let id: string;
    try {
      id = parseProvider(selection.provider).harness;
    } catch {
      return `Choisissez un harnais et un modèle pour ${role}.`;
    }
    const family = providers?.find((p) => p.id === id)?.family ?? id;
    if (!id || !selection.provider.includes('/')) return `Choisissez un harnais et un modèle pour ${role}.`;
    if (role !== 'builder' && !isReadOnly(family, selection.modeId))
      return `${role} exige une permission de lecture seule. Sélectionnez-la dans les permissions du rôle.`;
    if (!selection.modeId) return `Choisissez les permissions pour ${role}.`;
  }
  if (!configSchema.safeParse(config).success) return 'La configuration est incomplète ou invalide.';
  return undefined;
}
export function configReady(config: Config, providers?: { id: string; family?: string }[]) {
  return !configurationIssue(config, providers);
}
export { automaticTeam as defaultRoles } from '../shared/team-composition';

/** Freeze the repositories shown to the user rather than discovering new targets at dispatch time. */
export function scopedLaunchConfig(
  config: Config,
  catalog?: { selectedRepositories?: string[]; gitRoot?: string | null; repositories?: string[] },
): Config {
  const paths =
    config.repositoryPaths ??
    catalog?.selectedRepositories ??
    (catalog?.gitRoot ? [catalog.gitRoot] : catalog?.repositories);
  return paths?.length ? { ...config, repositoryPaths: paths } : config;
}
