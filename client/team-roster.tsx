import { Pressable, Text, View } from 'react-native';
import type { PluginHostProps } from '@getpaseo/plugin/client';
import { roles, type Config, type Role, type Workflow } from '../shared/contracts';
import { parseProvider } from '../shared/provider-selection';
import { roleTitle, teamModelLabel, type TeamProviderChoice } from '../shared/team-composition';
import type { Translate } from '../shared/i18n';
import { translator } from '../shared/i18n';
const french = translator('fr');

const identity = {
  planner: { label: roleTitle.planner, name: roleTitle.planner, color: '#9b8afb', initial: 'P' },
  builder: { label: roleTitle.builder, name: roleTitle.builder, color: '#62a8ff', initial: 'C' },
  reviewer: { label: roleTitle.reviewer, name: roleTitle.reviewer, color: '#e9b65f', initial: 'R' },
};
export function teamControl(w: Workflow, t: Translate = french): { title: string; detail: string; role?: Role } {
  if (w.status === 'completed')
    return { title: t('Mission terminée'), detail: t('Le résultat est conservé dans l’historique.') };
  if (w.status === 'paused')
    return { title: t('Équipe en pause'), detail: t('Le contexte est conservé pour la reprise.') };
  if (w.clarifications?.some((q) => !q.resolvedAt))
    return { title: t('À vous de répondre'), detail: t('Le Plan attend votre précision.') };
  if (w.status === 'awaiting_plan' || w.status === 'awaiting_final')
    return {
      title: t('À vous de valider'),
      detail:
        w.status === 'awaiting_plan'
          ? t('Le plan est prêt. Rien ne démarre sans votre accord.')
          : t('Les vérifications sont terminées. Consultez le bilan.'),
    };
  if (w.status === 'permission')
    return { title: t('Autorisation attendue'), detail: t('Une demande nécessite votre décision.') };
  if (w.status === 'attention')
    return {
      title: t('Votre attention est nécessaire'),
      detail: w.error ?? t('Répondez dans le thread ou envoyez `/team-resume` pour reprendre.'),
    };
  if (w.phase === 'testing')
    return { title: t('Les tests ont la main'), detail: t('Exécution des commandes de validation.') };
  const role =
    w.operation?.role ??
    (w.phase === 'planning'
      ? 'planner'
      : w.phase === 'building'
        ? 'builder'
        : w.phase === 'reviewing'
          ? 'reviewer'
          : w.activeRole);
  return {
    title:
      w.status === 'ready'
        ? t('{role} prend la main', { role: t(identity[role].name) })
        : t('{role} a la main', { role: t(identity[role].name) }),
    detail:
      w.config.mode === 'auto'
        ? t('Le relais vers le prochain rôle est automatique.')
        : t('Vous choisissez le prochain rôle depuis Team.'),
    role,
  };
}

export function TeamRoster({
  config,
  providers = [],
  workflow,
  colors: c,
  compact = false,
  onRole,
  t = french,
}: {
  config: Pick<Config, 'roles'>;
  providers?: TeamProviderChoice[];
  workflow?: Workflow;
  colors: PluginHostProps['theme']['colors'];
  compact?: boolean;
  onRole?: (role: Role) => void;
  t?: Translate;
}) {
  const control = workflow ? teamControl(workflow, t) : undefined;
  return (
    <View style={{ gap: 14, minWidth: 0 }}>
      {control ? (
        <View accessibilityLiveRegion="polite" style={{ gap: 5 }}>
          <Text style={{ color: c.foreground, fontSize: 18, fontWeight: '600' }}>{control.title}</Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{control.detail}</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: compact ? 'column' : 'row', gap: 8 }}>
        {roles.map((role, index) => {
          const selected = config.roles[role];
          let harness = '',
            model = '';
          try {
            ({ harness, model } = parseProvider(selected.provider));
          } catch {
            /* Catalogue still loading. */
          }
          const provider = providers.find((p) => p.id === harness);
          const name = teamModelLabel(model, provider?.models.find((m) => m.id === model)?.label);
          const active = control?.role === role;
          const item = identity[role];
          return (
            <Pressable
              key={role}
              accessibilityRole="button"
              accessibilityLabel={`${t(item.name)} : ${name || t('Sélection automatique')}${active ? t(', a la main') : ''}`}
              disabled={!onRole}
              onPress={() => onRole?.(role)}
              style={{
                flex: compact ? undefined : 1,
                minWidth: 0,
                borderWidth: 1,
                borderColor: active ? item.color : c.border,
                borderRadius: 14,
                backgroundColor: active ? c.surface2 : c.surface0,
                padding: 12,
                gap: 10,
                flexDirection: compact ? 'row' : 'column',
                alignItems: compact ? 'center' : undefined,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  backgroundColor: c.surface2,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: item.color, fontWeight: '700' }}>{item.initial}</Text>
              </View>
              <View style={{ flex: compact ? 1 : undefined, minWidth: 0, gap: 3 }}>
                <Text style={{ color: c.foregroundMuted, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
                  {index + 1} · {t(item.label)}
                </Text>
                <Text
                  numberOfLines={2}
                  style={{ color: c.foreground, fontSize: 13, lineHeight: 18, fontWeight: '600' }}
                >
                  {name || t('Sélection automatique')}
                </Text>
                <Text numberOfLines={1} style={{ color: active ? item.color : c.foregroundMuted, fontSize: 11 }}>
                  {active ? t('● A la main') : (provider?.label ?? harness ?? t(item.name))}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
