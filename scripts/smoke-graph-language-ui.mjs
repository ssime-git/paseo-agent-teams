// Opt-in real browser preview only: no graph confirmation or model execution.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPaseoClient } from '@getpaseo/client';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const url = new URL(process.env.TEAMS_SMOKE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.port && url.port !== '6767');
const proof = JSON.parse(await readFile(process.argv[2], 'utf8'));
const output = process.env.TEAMS_SMOKE_OUTPUT;
assert.ok(proof.verified && proof.workspaceId && proof.serverId && output);
assert.equal(new URL(proof.url).host, url.host);
await mkdir(output, { recursive: true });
const api = createPaseoClient({ url: proof.url, reconnect: { enabled: false } });
const raw = new DaemonClient({
  url: proof.url,
  clientId: 'graph-language-ui',
  clientType: 'cli',
  appVersion: '0.15.0',
  reconnect: { enabled: false },
});
const deadline = setTimeout(() => {
  console.error('Graph language UI exceeded 90 seconds');
  process.exit(1);
}, 90000);
let browser, currentPage;
const results = [];
try {
  await api.connect();
  await raw.connect();
  assert.equal((await raw.getDaemonStatus()).serverId, proof.serverId);
  const owner = api.agents.ref(proof.owners[0].id);
  await owner.commands();
  await owner.refresh();
  assert.equal(owner.status, 'idle');
  assert.ok(!owner.activeTurn && !owner.pendingPermissions?.length);
  const discovery = await api.providers.waitForReady({ cwd: proof.root, timeoutMs: 10000 });
  const provider = discovery.entries.find((p) => p.provider === 'codex' && p.status === 'ready');
  const model = provider?.models?.[0];
  assert.ok(model, 'Detected Codex model required for the saved contract');
  const source = await raw.invokePluginRpc('paseo-agent-teams', 'teams.save_definition', {
    workspaceId: proof.workspaceId,
    expectedRevision: 0,
    definition: {
      version: 1,
      name: `Language UI ${Date.now()}`,
      entry: 'human',
      maxTransitions: 1,
      steps: [
        {
          id: 'human',
          contract: 'human',
          instruction: 'Wait for explicit approval. Preserve code and identifiers.',
          selection: { provider: 'codex/' + model.id, modeId: 'read-only' },
          access: 'read-only',
          transitions: [
            { outcome: 'approve', target: null },
            { outcome: 'reject', target: null },
          ],
        },
      ],
    },
  });
  const graphScope = { workspaceId: proof.workspaceId, ownerAgentId: owner.id };
  const graphsBefore = await raw.invokePluginRpc('paseo-agent-teams', 'teams.graph_list', graphScope);
  await owner.send('/team-graphs', { activeTurnBehavior: 'steer' });
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  for (const [width, height, layout] of [
    [1440, 1050, 'desktop'],
    [390, 844, 'mobile'],
  ]) {
    const clients = [];
    for (const language of ['fr', 'en']) {
      const context = await browser.newContext({ viewport: { width, height } });
      await context.addInitScript(
        (language) => localStorage.setItem('@paseo:app-settings', JSON.stringify({ language })),
        language,
      );
      const page = await context.newPage();
      currentPage = page;
      const errors = [];
      page.setDefaultTimeout(10000);
      page.on('pageerror', (e) => errors.push(e.message));
      clients.push({ context, page, language, errors });
      try {
        await page.goto(new URL(`/settings/hosts/${proof.serverId}/plugins/paseo-agent-teams/agent-teams`, url).href);
        await page.getByText(/Langue de repli et des nouvelles missions|Fallback and new mission language/).waitFor();
        await page.goto(new URL(`/h/${proof.serverId}/workspace/${proof.workspaceId}`, url).href);
        if (layout === 'mobile') {
          await page.getByTestId('workspace-tab-switcher-trigger').click();
          await page.getByText('Native language fr', { exact: true }).last().locator('xpath=../..').click();
          await page.getByText('Workspace tabs', { exact: true }).waitFor({ state: 'hidden' });
        } else await page.getByTestId(`workspace-tab-agent_${owner.id}`).click();
        // Each /team-graphs command preserves older reports; target the newest launcher.
        await page
          .getByRole('button', {
            name: language === 'fr' ? 'Lancer un workflow sauvegardé' : 'Launch a saved workflow',
            exact: true,
          })
          .last()
          .click();
        await page
          .getByRole('button', { name: new RegExp(source.definition.name) })
          .last()
          .click();
        await page
          .getByRole('textbox', {
            name: language === 'fr' ? 'Objectif du workflow' : 'Workflow objective',
            exact: true,
          })
          .last()
          .fill('Preview only; preserve code and identifiers.');
        // Each /team-graphs command preserves older reports; target the newest launcher.
        await page
          .getByRole('button', {
            name: language === 'fr' ? 'Prévisualiser ce workflow' : 'Preview this workflow',
            exact: true,
          })
          .last()
          .click();
        const label = language === 'fr' ? 'Langue des réponses : FR' : 'Response language: EN';
        await page.getByText(label, { exact: true }).waitFor();
        await page.getByText(label, { exact: true }).scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.deepEqual(errors, []);
        await page.screenshot({ path: join(output, `${layout}-${language}.png`) });
        results.push({
          layout,
          language,
          width,
          height,
          previewLanguage: language,
          overflow: false,
          errors: [...errors],
        });
        await writeFile(join(output, 'partial-proof.json'), JSON.stringify(results, null, 2));
      } catch (error) {
        await page.screenshot({ path: join(output, `${layout}-${language}-failure.png`) });
        await writeFile(join(output, `${layout}-${language}-failure.txt`), await page.locator('body').innerText());
        throw error;
      }
    }
    // Independent clients keep their own locale while previewing the same saved definition.
    for (const { page, language, errors } of clients) {
      await page
        .getByText(language === 'fr' ? 'Langue des réponses : FR' : 'Response language: EN', { exact: true })
        .waitFor();
      assert.deepEqual(errors, []);
    }
    const changed = clients[0].page;
    currentPage = changed;
    await changed.evaluate(() => {
      window.__teamsLanguageNavigation = 'same-document';
    });
    if (layout === 'mobile') {
      await changed.getByTestId('menu-button').click();
      await changed.getByTestId('sidebar-settings').click();
      await changed.getByText('Général', { exact: true }).click();
    } else await changed.keyboard.press('Control+,');
    await changed.getByRole('button', { name: /^Français/ }).click();
    await changed.getByText('English - anglais', { exact: true }).last().click();
    await changed.getByText('App language', { exact: true }).waitFor();
    await changed.goBack();
    if (layout === 'mobile') await changed.goBack();
    assert.equal(
      await changed.evaluate(() => window.__teamsLanguageNavigation),
      'same-document',
      'Locale change uses native SPA navigation without reload',
    );
    await changed.getByRole('button', { name: 'Launch a saved workflow', exact: true }).last().click();
    await changed
      .getByRole('button', { name: new RegExp(source.definition.name) })
      .last()
      .click();
    await changed
      .getByRole('textbox', { name: 'Workflow objective', exact: true })
      .fill('Preview only; preserve code and identifiers.');
    await changed.getByRole('button', { name: 'Preview this workflow', exact: true }).last().click();
    await changed.getByText('Response language: EN', { exact: true }).waitFor();
    await changed.getByText('Response language: EN', { exact: true }).scrollIntoViewIfNeeded();
    await clients[1].page.getByText('Response language: EN', { exact: true }).waitFor();
    assert.deepEqual(clients[0].errors, []);
    assert.equal(await changed.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await changed.screenshot({ path: join(output, `${layout}-fr-to-en.png`) });
    results.push({
      layout,
      transition: 'fr-to-en',
      nativeSettings: true,
      sameDocument: true,
      otherClientLanguage: 'en',
      previewLanguage: 'en',
      overflow: false,
    });
    await writeFile(join(output, 'partial-proof.json'), JSON.stringify(results, null, 2));
    for (const { context } of clients) await context.close();
  }
  assert.deepEqual(
    await raw.invokePluginRpc('paseo-agent-teams', 'teams.graph_list', graphScope),
    graphsBefore,
    'Preview never admits or mutates a graph',
  );
  await writeFile(join(output, 'proof.json'), JSON.stringify({ serverId: proof.serverId, source, results }, null, 2));
  console.log('PASS graph previews FR/EN desktop/mobile, two clients, no confirmation');
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: join(output, 'failure.png') });
    await writeFile(join(output, 'failure.txt'), await currentPage.locator('body').innerText());
  }
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), results }, null, 2));
  throw error;
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await raw.close();
  await api.close();
}
