import { TeamError } from '../shared/errors';
import type { PaseoApi } from '@getpaseo/client';
import { DEFAULT_MODE, INSTRUCTION_READ_ONLY, readOnlyMode } from '../shared/provider-selection';
export type ProviderFamily = string;

export function workflowModes(family: ProviderFamily, modes: { id: string; label: string }[]) {
  if (family === 'codex' && modes.some((m) => m.id === 'auto') && !modes.some((m) => m.id === 'read-only')) {
    return [...modes, { id: 'read-only', label: 'Lecture seule (sandbox Codex)' }];
  }
  if (!['claude', 'codex'].includes(family) && !modes.some((m) => readOnlyMode(family, m.id))) {
    const available = modes.length ? modes : [{ id: DEFAULT_MODE, label: 'Permissions par défaut du harnais' }];
    return [...available, { id: INSTRUCTION_READ_ONLY, label: 'Lecture seule par consigne (sans sandbox)' }];
  }
  return modes;
}

export function nativeMode(family: ProviderFamily, selected: string, modes: { id: string }[]) {
  if (
    !['claude', 'codex'].includes(family) &&
    selected === INSTRUCTION_READ_ONLY &&
    !modes.some((m) => readOnlyMode(family, m.id))
  )
    return modes[0]?.id;
  if (!modes.length && selected === DEFAULT_MODE) return undefined;
  if (modes.some((m) => m.id === selected)) return selected;
  if (family === 'codex' && selected === 'read-only' && modes.some((m) => m.id === 'auto')) return 'auto';
  throw new TeamError('MODE_UNAVAILABLE', `Unavailable mode: ${selected}`);
}

// Only inheritance metadata leaves this helper; credentials and launch environments stay server-side.
export function resolveProviderProfiles(entries: Record<string, Record<string, unknown>>) {
  const families: Record<string, ProviderFamily> = { claude: 'claude', codex: 'codex' };
  const labels: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' };
  for (const [id, entry] of Object.entries(entries)) {
    families[id] = typeof entry.extends === 'string' ? entry.extends : id;
    if (families[id] && typeof entry.label === 'string') labels[id] = entry.label;
  }
  return { families, labels };
}
export async function providerProfiles(api: PaseoApi) {
  const { config } = await api.config.get();
  return resolveProviderProfiles(config.providers);
}
