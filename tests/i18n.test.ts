import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { en } from '../shared/i18n-en';
import { translate } from '../shared/i18n';
import { roleTitle } from '../shared/team-composition';

const files = [
  ...readdirSync('client').map((f) => `client/${f}`),
  'index.client.tsx',
  'server/team-provider.ts',
  'server/graph-status.ts',
  'server/team-timeline.ts',
].filter((f) => /\.tsx?$/.test(f));
const literal = String.raw`'((?:[^'\\\n]|\\.)*)'`;
/** `t('…')`, `t(cond ? '…' : '…')` and `translate(language, '…')`. */
const callPattern =
  String.raw`\b(?:t\(|translate\(\s*[\w']+\s*,)\s*(?:[^'()]*\?\s*)?` +
  literal +
  String.raw`(?:\s*:\s*` +
  literal +
  ')?';
const unescape = (s: string) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');

/** Every literal passed to t(...), including both branches of `t(cond ? 'a' : 'b')`. */
function markedTexts() {
  const keys = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const call of source.matchAll(new RegExp(callPattern, 'g'))) {
      keys.add(unescape(call[1]));
      if (call[2] !== undefined) keys.add(unescape(call[2]));
    }
  }
  return keys;
}
/** Texts translated through a variable, e.g. `t(roleTitle[role])` or `t(errorTexts[code])`. */
async function dynamicTexts() {
  const { errorTexts } = await import('../client/errors');
  const { fieldLabels } = await import('../client/events');
  const { hint, validation } = await import('../client/texts');
  const { models, modes, commands } = await import('../server/team-provider');
  return [
    ...Object.values(roleTitle),
    ...Object.values(errorTexts),
    ...Object.values(fieldLabels),
    ...Object.values(hint),
    ...validation.map((v) => v.label),
    ...models.map((m) => m.description),
    ...modes.map((m) => m.label),
    ...commands.map((c) => c.description),
    'review refusée',
    'tests non validés',
  ];
}

test('every marked French text has an English translation with the same placeholders', async () => {
  const keys = new Set([...markedTexts(), ...(await dynamicTexts())]);
  if (process.env.I18N_DUMP)
    (await import('node:fs')).writeFileSync(process.env.I18N_DUMP, JSON.stringify([...keys], null, 1));
  const missing = [...keys].filter((k) => !(k in en) && !/^[\s\p{P}\p{S}\d]*$/u.test(k));
  assert.deepEqual(missing, []);
  const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [fr, english] of Object.entries(en)) assert.deepEqual(holes(english), holes(fr), fr);
  const unused = Object.keys(en).filter((k) => !keys.has(k));
  assert.deepEqual(unused, []);
});

test('no French interface text is left outside t()', async () => {
  const sources = new Set(await dynamicTexts());
  const french = /[éèêàùçôîâûœÉÈÀÇ’]|\b(le|la|les|des|une|du|pour|avec|sans|dans|votre)\b/i;
  const marked = new RegExp(callPattern, 'g');
  const leftovers: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/^import .*$/gm, '')
      // Search keywords are deliberately bilingual.
      .replace(/keywords: \[[^\]]*\]/g, '')
      .replace(marked, 't()');
    for (const m of source.matchAll(new RegExp(literal, 'g')))
      if (french.test(m[1]) && !sources.has(unescape(m[1])) && m[1] !== 'Français') leftovers.push(`${file}: ${m[1]}`);
    for (const m of source.matchAll(/>([^<>{}]*)</g)) {
      const text = m[1].trim();
      if (text && /[A-Za-zÀ-ÿ]{3,}/.test(text) && french.test(text) && !/=>|[=;]/.test(text))
        leftovers.push(`${file}: ${text}`);
    }
  }
  assert.deepEqual(leftovers, []);
});

test('translation keeps French as source and fills placeholders in both languages', () => {
  assert.equal(
    translate('fr', 'Plan validé. {builder} implémente.', { builder: 'Codex' }),
    'Plan validé. Codex implémente.',
  );
  assert.equal(
    translate('en', 'Plan validé. {builder} implémente.', { builder: 'Codex' }),
    en['Plan validé. {builder} implémente.'].replace('{builder}', 'Codex'),
  );
  assert.equal(translate('en', 'Texte inconnu'), 'Texte inconnu');
});
