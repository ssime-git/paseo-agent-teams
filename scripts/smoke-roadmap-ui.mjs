import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createPaseoClient } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const [file, mode = 'capture'] = process.argv.slice(2);
assert.ok(['capture', 'answer-first', 'answer-last', 'reject-tests', 'final'].includes(mode));
const proof = JSON.parse(await readFile(file, 'utf8'));
const url = new URL(proof.url);
assert.ok(url.port && url.port !== '6767' && url.hostname === '127.0.0.1');
url.protocol = 'http:';
const { serverId } = JSON.parse(await readFile(process.env.TEAMS_SMOKE_STATUS, 'utf8'));
const output = process.env.TEAMS_SMOKE_OUTPUT;
assert.match(output ?? '', /^\/tmp\/teams-/);
const api = createPaseoClient({ url: proof.url, reconnect: { enabled: false } }),
  raw = new DaemonClient({ url: proof.url, clientId: randomUUID(), clientType: 'cli', appVersion: '0.16.2' });
const rpc = (n, i) => raw.invokePluginRpc('paseo-agent-teams', 'teams.' + n, i);
const scope = { id: proof.id, workspaceId: proof.workspaceId };
const before = async () => rpc('graph_record', scope);
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const timer = setTimeout(() => {
  console.error('150 s browser budget exceeded');
  process.exit(1);
}, 150000);
let page;
try {
  await api.connect();
  await raw.connect();
  const original = await before();
  const layouts =
    mode === 'capture' || mode === 'final'
      ? [
          [1440, 1000, 'fr'],
          [390, 844, 'fr'],
          [1440, 1000, 'en'],
          [390, 844, 'en'],
        ]
      : [
          [
            mode === 'answer-first' ? 390 : 1440,
            mode === 'answer-first' ? 844 : 1000,
            mode === 'answer-first' ? 'fr' : 'en',
          ],
        ];
  const results = [];
  for (const [width, height, language] of layouts) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(
      (lang) => localStorage.setItem('@paseo:app-settings', JSON.stringify({ language: lang })),
      language,
    );
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.setDefaultTimeout(15000);
    await page.goto(new URL('/settings/hosts/' + serverId + '/plugins/paseo-agent-teams/agent-teams', url).href);
    await page.getByText(/Langue de repli et des nouvelles missions|Fallback and new mission language/).waitFor();
    await page.goto(new URL('/h/' + serverId + '/workspace/' + proof.workspaceId, url).href);
    await page.getByTestId('workspace-tab-agent_' + proof.ownerId).click();
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(1200);
    if (mode === 'reject-tests' || mode === 'final') {
      await page
        .getByText(language === 'fr' ? 'Équipe' : 'Team', { exact: true })
        .filter({ visible: true })
        .last()
        .click();
      await page
        .getByRole('button', {
          name:
            language === 'fr' ? 'Afficher les workflows de cette conversation' : 'Show workflows in this conversation',
          exact: true,
        })
        .filter({ visible: true })
        .click();
      await page
        .getByRole('radio')
        .filter({ hasText: proof.source.definition.name })
        .filter({ visible: true })
        .last()
        .click();
    }
    const buttons = page
      .getByRole('button', {
        name: language === 'fr' ? 'Actualiser les attentes' : 'Refresh pending requests',
        exact: true,
      })
      .filter({ visible: true });
    await buttons.last().waitFor();
    await buttons.last().click();
    if (mode === 'capture' || mode === 'answer-first') {
      const radio = page
        .getByRole('radio', { name: /Bonjour/ })
        .filter({ visible: true })
        .last();
      await radio.waitFor();
      assert.notEqual(await radio.getAttribute('aria-checked'), 'true');
      const send = page
        .getByRole('button', { name: language === 'fr' ? 'Envoyer la réponse' : 'Send response', exact: true })
        .filter({ visible: true })
        .last();
      assert.equal(await send.isDisabled(), true);
      await radio.scrollIntoViewIfNeeded();
      if (mode === 'answer-first') {
        await radio.click();
        await send.click();
        await page
          .getByText(/Réponse enregistrée|Response recorded/)
          .filter({ visible: true })
          .last()
          .waitFor();
        const now = await before();
        assert.equal(now.status, 'waiting_human');
        assert.deepEqual(now.activations.at(-1).clarificationAnswers, [
          { questionId: 'greeting', optionId: 'bonjour' },
        ]);
        await writeFile(output + '/partial-answer.json', JSON.stringify(now, null, 2));
      }
    } else if (mode === 'answer-last') {
      const input = page
        .getByRole('textbox', { name: 'Your free response', exact: true })
        .filter({ visible: true })
        .last();
      await input.fill('Seulement RESULT.txt, préserve README.md et user-note.txt.');
      await page.getByRole('button', { name: 'Send response', exact: true }).filter({ visible: true }).last().click();
      await page
        .getByText('Response saved. Continuing remains a separate action.', { exact: true })
        .filter({ visible: true })
        .last()
        .waitFor();
      const now = await before();
      assert.equal(now.status, 'ready');
      assert.equal(now.activations.length, 1);
      assert.equal(now.activations[0].clarificationAnswers.length, 2);
      assert.equal(now.activations[0].clarificationAnswers[1].optionId, undefined);
    } else if (mode === 'reject-tests') {
      const reject = page
        .getByRole('button', { name: 'Follow the failed-test branch', exact: true })
        .filter({ visible: true })
        .last();
      await reject.click();
      await page
        .getByText('Response saved. Continuing remains a separate action.', { exact: true })
        .filter({ visible: true })
        .last()
        .waitFor();
      const now = await before();
      assert.equal(now.nextStepId, 'inspect');
      assert.ok(now.activations.at(-1).testRejection);
      assert.equal(now.activations.at(-1).result.outcome, 'failure');
    } else {
      await page
        .getByText(language === 'fr' ? 'Terminé avec succès' : 'Completed successfully', { exact: true })
        .filter({ visible: true })
        .last()
        .waitFor();
      const history = page
        .getByRole('button', { name: language === 'fr' ? 'Historique des étapes' : 'Step history', exact: true })
        .filter({ visible: true })
        .last();
      await history.click();
      await history.scrollIntoViewIfNeeded();
      assert.ok((await page.locator('body').innerText()).includes('review_plan'));
      assert.ok((await page.locator('body').innerText()).includes('Bonjour'));
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: output + '/' + mode + '-' + width + '-' + language + '.png' });
    results.push({ width, height, language, errors, overflow: false });
    await context.close();
  }
  if (mode === 'capture' || mode === 'final')
    assert.deepEqual(await before(), original, 'UI inspection and locale changes cannot mutate graph');
  await writeFile(output + '/' + mode + '-browser.json', JSON.stringify(results, null, 2));
  console.log('PASS ' + mode + ' browser');
} catch (error) {
  await writeFile(output + '/' + mode + '-failure-error.txt', String(error));
  if (page && !page.isClosed()) {
    await writeFile(
      output + '/' + mode + '-failure.txt',
      await page
        .locator('body')
        .innerText()
        .catch(() => ''),
    );
    await page.screenshot({ path: output + '/' + mode + '-failure.png' }).catch(() => {});
  }
  throw error;
} finally {
  clearTimeout(timer);
  await browser.close();
  await raw.close();
  await api.close();
}
