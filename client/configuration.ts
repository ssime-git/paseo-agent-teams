import { configSchema, roles, type Config } from '../shared/contracts';
export function initialConfig(): Config {
  return { version: 1, mode: 'auto', roles: { planner: { provider: '', modeId: '' }, builder: { provider: '', modeId: '' }, reviewer: { provider: '', modeId: '' } }, validation: 'plan', autoFix: true, maxCorrections: 2, recovery: 'explicit', testCommands: [], allowNoTests: false };
}
export function exportConfig(config: Config) { return JSON.stringify(configSchema.parse(config), null, 2); }
export function importConfig(text: string) { return configSchema.parse(JSON.parse(text)); }
export function commandsFromText(text: string) {
  return text.split('\n').map(command => command.trim()).filter(Boolean).map(command => ({ command, timeoutMs: 600_000 }));
}
export const isReadOnly = (provider: string, mode: string) => (provider === 'claude' && mode === 'plan') || (provider === 'codex' && mode === 'read-only');
export function configReady(config: Config, providers?: { id: string; family?: string }[]) {
  if (!configSchema.safeParse(config).success) return false;
  return roles.every(role => {
    const id = config.roles[role].provider.split('/')[0], family = providers?.find(p => p.id === id)?.family ?? id;
    return role === 'builder' || isReadOnly(family, config.roles[role].modeId);
  });
}
