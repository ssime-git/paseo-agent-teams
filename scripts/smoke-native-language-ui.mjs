// Opt-in real browser proof. Run smoke-native-language-settings.mjs first on an isolated daemon.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const url = new URL(process.env.TEAMS_SMOKE_URL);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port && url.port !== '6767');
const host = process.env.TEAMS_SMOKE_SERVER_ID;
const output = process.env.TEAMS_SMOKE_OUTPUT;
assert.ok(host && output && process.argv[2], 'Explicit host, output and native settings proof required');
const proof = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.equal(new URL(proof.url).host, url.host);
assert.ok(proof.verified && proof.workspaceId && proof.owners.length === 2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const deadline = setTimeout(() => {
  console.error('Native language UI smoke exceeded 90 seconds');
  process.exit(1);
}, 90000);
const results = [];
const requestedLayout = process.env.TEAMS_SMOKE_LAYOUT ?? 'all';
assert.ok(['all', 'desktop', 'mobile'].includes(requestedLayout));
const layouts = [
  [1440, 1050, 'desktop'],
  [390, 844, 'mobile'],
].filter((entry) => requestedLayout === 'all' || entry[2] === requestedLayout);
try {
  for (const [width, height, layout] of layouts) {
    // A fresh context starts at the target viewport; no desktop resize or shared browser state.
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      // The native workspace route can redirect before initial daemon discovery finishes.
      await page.goto(new URL(`/settings/hosts/${host}/plugins/paseo-agent-teams/agent-teams`, url).href);
      await page.getByText(/Langue de repli et des nouvelles missions|Fallback and new mission language/).waitFor();
      await page.goto(new URL(`/h/${host}/workspace/${proof.workspaceId}`, url).href);
      for (const owner of proof.owners) {
        if (layout === 'mobile') await page.getByTestId('workspace-tab-switcher-trigger').click();
        if (layout === 'mobile') {
          await page
            .getByText(`Native language ${owner.language}`, { exact: true })
            .last()
            .locator('xpath=../..')
            .click();
          await page.getByText('Workspace tabs', { exact: true }).waitFor({ state: 'hidden' });
        } else {
          await page.getByTestId(`workspace-tab-agent_${owner.id}`).click();
        }
        // Compact native controls live in the combined model sheet on mobile.
        // Background workspace panels may also be mounted: select the visible trigger only.
        if (layout === 'mobile') await page.getByTestId('combined-model-selector').filter({ visible: true }).click();
        else await page.getByRole('button', { name: 'Open agent features', exact: true }).click();
        const language = page.getByRole('button', { name: 'Langue des réponses', exact: true });
        await language.waitFor();
        assert.match(await language.innerText(), owner.language === 'fr' ? /Français/ : /English/);
        await page.screenshot({ path: join(output, `${layout}-${owner.language}.png`) });
        await language.click();
        for (const label of ['Repli hôte (figé au lancement)', 'Français', 'English'])
          await page.getByText(label, { exact: true }).last().waitFor();
        // Wait for the native sheet's opening animation before claiming readable choices.
        await page.getByText('English', { exact: true }).last().scrollIntoViewIfNeeded();
        for (const label of ['Repli hôte (figé au lancement)', 'Français', 'English']) {
          const box = await page.getByText(label, { exact: true }).last().boundingBox();
          assert.ok(box && box.y >= 0 && box.y + box.height <= height, `${label} fits the viewport`);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: join(output, `${layout}-${owner.language}-choices.png`) });
        assert.deepEqual(errors, []);
        results.push({
          layout,
          width,
          height,
          language: owner.language,
          choices: ['host', 'fr', 'en'],
          overflow: false,
          errors: [...errors],
        });
        await writeFile(join(output, 'partial-proof.json'), JSON.stringify(results, null, 2));
        // Reload restores a clean native overlay state without changing any setting.
        await page.reload();
      }
    } catch (error) {
      await page.screenshot({ path: join(output, `${layout}-failure.png`) });
      await writeFile(join(output, `${layout}-failure.txt`), await page.locator('body').innerText());
      await writeFile(
        join(output, `${layout}-failure-controls.json`),
        JSON.stringify(
          await page.locator('button').evaluateAll((elements) =>
            elements.map((element) => ({
              label: element.getAttribute('aria-label'),
              testId: element.getAttribute('data-testid'),
              text: element.innerText,
            })),
          ),
          null,
          2,
        ),
      );
      throw error;
    } finally {
      await context.close();
    }
  }
  await writeFile(join(output, 'proof.json'), JSON.stringify(results, null, 2));
  console.log('PASS', results);
} finally {
  clearTimeout(deadline);
  await browser.close();
}
