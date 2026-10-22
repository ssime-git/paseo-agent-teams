import { roles, type Config } from './contracts';
import { readOnlyMode } from './provider-selection';

export type TeamProviderChoice = {
  id: string;
  family: string;
  label?: string;
  models: { id: string; label?: string; isDefault: boolean }[];
  modes: { id: string; label?: string }[];
};
export const TEAM_PROVIDER_ID = 'agent-teams';

/** Prefer complementary harnesses, using only the catalogue returned by this host. */
export function automaticTeam(providers: TeamProviderChoice[], current?: Config['roles']): Config['roles'] {
  const available = providers.filter((p) => p.id !== TEAM_PROVIDER_ID);
  const next = { ...current } as Config['roles'];
  for (const role of roles) {
    if (next[role]?.provider) continue;
    const preferred = role === 'builder' ? 'codex' : 'claude';
    const eligible = available.filter(
      (p) => p.models.length && p.modes.some((m) => role === 'builder' || readOnlyMode(p.family, m.id)),
    );
    const provider = eligible.find((p) => p.id === preferred) ?? eligible[0];
    const model = provider?.models.find((m) => m.isDefault) ?? provider?.models[0];
    const mode =
      provider?.modes.find((m) =>
        role === 'builder' ? !readOnlyMode(provider.family, m.id) : readOnlyMode(provider.family, m.id),
      ) ?? (role === 'builder' ? provider?.modes[0] : undefined);
    next[role] =
      provider && model && mode
        ? { provider: `${provider.id}/${model.id}`, modeId: mode.id }
        : { provider: '', modeId: '' };
  }
  return next;
}

/** Presentation only; model identifiers passed to the daemon remain untouched. */
export function teamModelLabel(id: string, label?: string) {
  if (label && label !== id) return label;
  const claude = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-\d+)?$/.exec(id);
  if (claude) return `${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}.${claude[3]}`;
  const gpt = /^gpt-(\d+(?:\.\d+)?)-([a-z]+)$/.exec(id);
  if (gpt) return `GPT-${gpt[1]} ${gpt[2][0].toUpperCase()}${gpt[2].slice(1)}`;
  return label || id;
}
