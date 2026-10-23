import { useCallback } from 'react';
import * as host from '@getpaseo/plugin/client';
import { teamSettings } from '../shared/team-composition';
import { translate, type Language, type Params, type Translate } from '../shared/i18n';

// Hosts without the settings API keep the French interface instead of failing to render.
const useHostSettings = (host as Partial<typeof host>).useSettings;

/** The interface language chosen in the Agent Teams settings; French until they are read. */
export function useLanguage(): Language {
  const settings = useHostSettings?.(teamSettings);
  return settings?.status === 'ready' ? settings.values.language : 'fr';
}
export function useT(): Translate {
  const language = useLanguage();
  return useCallback((source: string, params?: Params) => translate(language, source, params), [language]);
}
export { announceLanguage, onLanguage } from './language-signal';
