import type { Language } from '../shared/i18n';

// Command Center and screen titles are registered once; they follow language changes through this signal.
const listeners = new Set<(language: Language) => void>();
export function announceLanguage(language: Language) {
  for (const listener of listeners) listener(language);
}
export function onLanguage(listener: (language: Language) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
