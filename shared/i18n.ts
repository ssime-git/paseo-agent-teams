import { en } from './i18n-en';

export const languages = ['fr', 'en'] as const;
export type Language = (typeof languages)[number];
export type Params = Record<string, string | number>;
export type Translate = (source: string, params?: Params) => string;

/**
 * French source text is the message key, gettext style: untranslated text stays readable and
 * `tests/i18n.test.ts` checks that every marked text has an English entry.
 */
export function translate(language: Language, source: string, params?: Params) {
  const text = language === 'en' ? (en[source] ?? source) : source;
  return params
    ? text.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match))
    : text;
}
export const translator =
  (language: Language): Translate =>
  (source, params) =>
    translate(language, source, params);
