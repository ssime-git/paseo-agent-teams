import { useCallback } from 'react';
import * as host from '@getpaseo/plugin/client';
import { teamSettings } from '../shared/team-composition';
import { interfaceLanguage, translate, type Language, type Params, type Translate } from '../shared/i18n';

// Hosts without the settings API keep the French interface instead of failing to render.
const useHostSettings = (host as Partial<typeof host>).useSettings;

const localeMessages = (host as Partial<typeof host>).defineTranslations?.({
  resources: { en: { team: 'Team' }, fr: { team: translate('fr', 'Équipe') } },
});
const useAppTranslation = (host as Partial<typeof host>).useTranslation;

/** App locale wins; the host setting is an explicit fallback for older/unsupported clients. */
export function useLanguage(): Language {
  const settings = useHostSettings?.(teamSettings);
  const app = localeMessages ? useAppTranslation?.(localeMessages) : undefined;
  return interfaceLanguage(app?.locale, settings?.status === 'ready' ? settings.values.language : 'fr');
}
export function useT(): Translate {
  const language = useLanguage();
  return useCallback((source: string, params?: Params) => translate(language, source, params), [language]);
}
export { announceLanguage, onLanguage } from './language-signal';
