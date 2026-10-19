import type { PaseoApi } from '@getpaseo/client';
export type ProviderFamily = 'claude' | 'codex';

// Only inheritance metadata leaves this helper; credentials and launch environments stay server-side.
export function resolveProviderProfiles(entries: Record<string, Record<string, unknown>>) {
  const families: Record<string, ProviderFamily> = { claude: 'claude', codex: 'codex' };
  const labels: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' };
  for (const [id, entry] of Object.entries(entries)) {
    if (entry.extends === 'claude' || entry.extends === 'codex') families[id] = entry.extends;
    if (families[id] && typeof entry.label === 'string') labels[id] = entry.label;
  }
  return { families, labels };
}
export async function providerProfiles(api: PaseoApi) {
  const { config } = await api.config.get();
  return resolveProviderProfiles(config.providers);
}
