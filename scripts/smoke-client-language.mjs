// Opt-in browser smoke: explicit isolated URL, server ID, output directory and Playwright module.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const url = new URL(process.env.TEAMS_SMOKE_URL);
assert.ok(
  ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port && url.port !== '6767',
  'Explicit isolated loopback URL required',
);
const id = process.env.TEAMS_SMOKE_SERVER_ID;
const output = process.env.TEAMS_SMOKE_OUTPUT;
assert.ok(id && output, 'Explicit isolated server ID and output directory required');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const results = [];
const deadline = setTimeout(() => {
  console.error('Browser smoke exceeded 90 seconds');
  process.exit(1);
}, 90_000);
try {
  const contexts = [];
  for (const language of ['fr', 'en']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    contexts.push(context);
    await context.addInitScript((language) => {
      if (!localStorage.getItem('@paseo:app-settings'))
        localStorage.setItem('@paseo:app-settings', JSON.stringify({ language }));
    }, language);
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(
      new URL(`/settings/hosts/${encodeURIComponent(id)}/plugins/paseo-agent-teams/agent-teams`, url).href,
      { waitUntil: 'domcontentloaded' },
    );
    const label = language === 'fr' ? 'Langue de repli et des nouvelles missions' : 'Fallback and new mission language';
    await page.getByText(label, { exact: true }).waitFor({ timeout: 20000 });
    for (const [width, height, layout] of [
      [1440, 1050, 'desktop'],
      [390, 844, 'mobile'],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(700);
      assert.equal(await page.getByText(label, { exact: true }).count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: join(output, `${language}-${layout}.png`) });
      results.push({ language, layout, width, height, overflow: false, errors: [...errors] });
      assert.deepEqual(errors, []);
    }
  }
  // Both clients remain open with independent locales on the same host.
  for (let n = 0; n < contexts.length; n++) {
    const label = n === 0 ? 'Langue de repli et des nouvelles missions' : 'Fallback and new mission language';
    assert.equal(await contexts[n].pages()[0].getByText(label, { exact: true }).count(), 1);
  }
  await writeFile(join(output, 'proof.json'), JSON.stringify(results, null, 2));
  console.log('PASS', results);
} finally {
  clearTimeout(deadline);
  await browser.close();
}
