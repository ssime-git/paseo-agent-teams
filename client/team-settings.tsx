import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useRpc, useSettings, type PluginSurfaceProps } from '@getpaseo/plugin/client';
import { SettingsAction, SettingsSection, SettingsSelect } from '@getpaseo/plugin/client/ui';
import { roles, teamChoicesRpc, type Role } from '../shared/contracts';
import {
  defaultTeam,
  roleMode,
  roleTitle,
  teamModelLabel,
  teamSettings,
  type TeamProviderChoice,
  type TeamSettings as Values,
} from '../shared/team-composition';
import { errorMessage } from './errors';

const AUTO = 'auto';
const hint: Record<Role, string> = {
  planner: 'Analyse le dépôt et propose le plan, en lecture seule.',
  builder: 'Modifie les fichiers et lance les commandes.',
  reviewer: 'Relit les changements et les tests, en lecture seule.',
};
const validation = [
  { value: 'plan', label: 'Valider le plan' },
  { value: 'final', label: 'Valider le résultat' },
  { value: 'autonomous', label: 'Validation autonome' },
] as const;

export const modelOption = (providers: TeamProviderChoice[], selection: string) => {
  const [harness, ...rest] = selection.split('/');
  const provider = providers.find((p) => p.id === harness);
  const model = provider?.models.find((m) => m.id === rest.join('/'));
  return model ? `${provider!.label ?? provider!.id} · ${teamModelLabel(model.id, model.label)}` : '';
};

/** Default team for every new Team Auto conversation, in Paseo's own settings. */
export function TeamSettings({ theme: { colors: c } }: PluginSurfaceProps) {
  const settings = useSettings(teamSettings);
  const choicesCall = useRpc(teamChoicesRpc);
  const [choices, setChoices] = useState<TeamProviderChoice[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    choicesCall({})
      .then((value) => live && setChoices(value))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, []);
  if (settings.status === 'error' || error)
    return <Text style={{ color: c.statusDanger }}>{settings.status === 'error' ? settings.error : error}</Text>;
  if (settings.status === 'loading' || !choices)
    return <Text style={{ color: c.foregroundMuted }}>Recherche des modèles disponibles…</Text>;
  const values: Values = settings.status === 'ready' ? settings.values : teamSettings.schema.parse({});
  const revision = settings.revision;
  const resolved = defaultTeam(choices, values);
  const save = (next: Values) => void settings.save(next, revision);
  return (
    <View style={{ gap: 24 }}>
      {settings.status === 'invalid' ? (
        <SettingsSection title="Réglages illisibles">
          <SettingsAction
            label="Les réglages enregistrés ne sont plus valides."
            hint={settings.error}
            actionLabel="Réinitialiser"
            onPress={() => void settings.reset()}
          />
        </SettingsSection>
      ) : null}
      <SettingsSection
        title="Équipe par défaut"
        info="Chaque nouvelle conversation Team Auto part de cette équipe. Pour une mission précise, ajustez les rôles avec les réglages du composer avant le premier message."
      >
        {roles.map((role) => {
          const options = choices.flatMap((p) =>
            roleMode(p, role)
              ? p.models.map((m) => ({ value: `${p.id}/${m.id}`, label: modelOption(choices, `${p.id}/${m.id}`) }))
              : [],
          );
          const saved = values.roles[role]?.provider;
          const unavailable = saved && !options.some((o) => o.value === saved);
          return (
            <SettingsSelect
              key={role}
              label={roleTitle[role]}
              hint={hint[role]}
              error={unavailable ? `${saved} n’est plus disponible : sélection automatique utilisée.` : null}
              value={saved && !unavailable ? saved : AUTO}
              options={[
                {
                  value: AUTO,
                  label: `Automatique${resolved[role].provider ? ` (${modelOption(choices, resolved[role].provider)})` : ''}`,
                },
                ...options,
              ]}
              disabled={settings.saving}
              onValueChange={(value) => {
                const next = Object.fromEntries(Object.entries(values.roles).filter(([key]) => key !== role));
                save({ ...values, roles: value === AUTO ? next : { ...next, [role]: { provider: value } } });
              }}
            />
          );
        })}
      </SettingsSection>
      <SettingsSection title="Validation">
        <SettingsSelect
          label="Mode par défaut"
          hint="Ce qui attend votre accord avant de continuer."
          value={values.validation}
          options={validation}
          disabled={settings.saving}
          onValueChange={(value) => save({ ...values, validation: value })}
        />
        <SettingsSelect
          label="Corrections automatiques"
          hint="Nombre de retours au Code après une revue ou des tests en échec."
          value={String(values.maxCorrections)}
          options={[0, 1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: n ? String(n) : 'Aucune' }))}
          disabled={settings.saving}
          onValueChange={(value) => save({ ...values, maxCorrections: Number(value) })}
        />
      </SettingsSection>
      {settings.saveError ? <Text style={{ color: c.statusDanger }}>{settings.saveError}</Text> : null}
    </View>
  );
}
