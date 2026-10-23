import { defineSettings } from '@getpaseo/plugin';
import { z } from 'zod';
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

/** One vocabulary for the three roles across the thread, the team card and the settings. */
export const roleTitle: Record<(typeof roles)[number], string> = {
  planner: 'Plan',
  builder: 'Code',
  reviewer: 'Revue',
};

const roleChoice = z.object({ provider: z.string().regex(/^[^/]+\/.+$/) }).strict();
/** The default team every new Team Auto conversation starts from. Stored by the host. */
export const teamSettings = defineSettings({
  id: 'default-team',
  scope: 'host',
  version: 1,
  schema: z
    .object({
      roles: z
        .object({ planner: roleChoice.optional(), builder: roleChoice.optional(), reviewer: roleChoice.optional() })
        .strict()
        .default({}),
      validation: z.enum(['plan', 'final', 'autonomous']).default('plan'),
      maxCorrections: z.number().int().min(0).max(5).default(2),
    })
    .strict(),
});
export type TeamSettings = z.output<typeof teamSettings.schema>;

/** Roles eligible for a role on this host: the Builder needs write access, the others a read-only mode. */
export function roleMode(provider: TeamProviderChoice, role: (typeof roles)[number]) {
  return provider.modes.find((m) =>
    role === 'builder' ? !readOnlyMode(provider.family, m.id) : readOnlyMode(provider.family, m.id),
  );
}

/** Saved choices that are still available on this host; anything else falls back to the automatic pick. */
export function defaultTeam(providers: TeamProviderChoice[], saved?: TeamSettings): Config['roles'] {
  const chosen = {} as Partial<Config['roles']>;
  for (const role of roles) {
    const selection = saved?.roles[role]?.provider;
    if (!selection) continue;
    const [harness, ...rest] = selection.split('/');
    const provider = providers.find((p) => p.id === harness && p.id !== TEAM_PROVIDER_ID);
    const mode = provider && roleMode(provider, role);
    if (provider?.models.some((m) => m.id === rest.join('/')) && mode)
      chosen[role] = { provider: selection, modeId: mode.id };
  }
  return automaticTeam(providers, chosen as Config['roles']);
}
