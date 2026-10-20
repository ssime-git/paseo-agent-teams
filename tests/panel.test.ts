import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { DEFAULT_MODEL, DEFAULT_MODE, INSTRUCTION_READ_ONLY } from '../shared/provider-selection';

test('compact panel discovers models, launches a workflow, renders approvals and opens native sessions', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await mkdir('node_modules/.cache', { recursive: true });
  const dir = await mkdtemp(join(process.cwd(), 'node_modules/.cache/teams-ui-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let launched: unknown;
  const providers = [
    {
      id: 'claude',
      family: 'claude',
      label: 'Claude Code',
      models: [{ id: 'model-from-daemon', label: 'Discovered Claude', isDefault: true }],
      modes: [
        { id: 'plan', label: 'Plan' },
        { id: 'default', label: 'Default' },
      ],
    },
    {
      id: 'codex',
      family: 'codex',
      label: 'Codex',
      models: [{ id: 'org/codex-from-daemon', label: 'Discovered Codex', isDefault: true }],
      modes: [
        { id: 'read-only', label: 'Read only' },
        { id: 'auto', label: 'Default' },
      ],
    },
    {
      id: 'credit-account',
      family: 'claude',
      label: 'Claude — credits',
      models: [{ id: 'fable', label: 'Fable', isDefault: true }],
      modes: [
        { id: 'plan', label: 'Plan' },
        { id: 'default', label: 'Default' },
      ],
    },
    {
      id: 'pi',
      family: 'pi',
      label: 'Pi',
      models: [{ id: DEFAULT_MODEL, label: 'Harness default', isDefault: true }],
      modes: [
        { id: DEFAULT_MODE, label: 'Default' },
        { id: INSTRUCTION_READ_ONLY, label: 'Read only by instruction' },
      ],
    },
    {
      id: 'opencode',
      family: 'opencode',
      label: 'OpenCode',
      models: [{ id: 'zen/free-example', label: 'Detected Zen fixture', isDefault: true }],
      modes: [
        { id: 'build', label: 'Build' },
        { id: 'plan', label: 'Plan' },
      ],
    },
  ];
  const registry = {
    catalog: { cwd: '/repo', providers },
    workflows: [] as unknown[],
    permissions: [] as unknown[],
    actions: [] as unknown[],
    openedUrl: '',
    rpc: (name: string) => async (value: unknown) => {
      if (name === 'teams.create') {
        launched = value;
        return { id: 'workflow' };
      }
      if (name === 'teams.action') registry.actions.push(value);
      return undefined;
    },
  };
  (globalThis as Record<string, unknown>).__teamsTest = registry;
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__teamsTest;
  });
  const bundle = await build({
    entryPoints: ['client/panel.tsx'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    jsx: 'automatic',
    plugins: [
      {
        name: 'host-mocks',
        setup(b) {
          b.onResolve({ filter: /^\.\/controls$/ }, () => ({
            path: '@getpaseo/plugin/client/ui',
            namespace: 'host-mock',
          }));
          b.onResolve(
            { filter: /^(react-native|@getpaseo\/plugin\/client(?:\/ui)?|@tanstack\/react-query)$/ },
            (args) => ({ path: args.path, namespace: 'host-mock' }),
          );
          b.onLoad({ filter: /.*/, namespace: 'host-mock' }, (args) => ({
            contents:
              args.path === 'react-native'
                ? `export const Platform={OS:'ios'}; export const Linking={openURL:async(url)=>{globalThis.__teamsTest.openedUrl=url;}}; export const Pressable='Pressable',ScrollView='ScrollView',Text='Text',TextInput='TextInput',View='View';`
                : args.path.endsWith('/ui')
                  ? `export const CompactSelect='SettingsSelect', CompactSwitch='SettingsSwitch';`
                  : args.path === '@tanstack/react-query'
                    ? `export function useQuery({queryKey}) { const r=globalThis.__teamsTest; return {data:queryKey[0]==='team-permissions'?r.permissions:queryKey[0].includes('catalog')?r.catalog:r.workflows,refetch:async()=>{}}; }`
                    : `export function useRpc(contract){return globalThis.__teamsTest.rpc(contract.name);}`,
          }));
        },
      },
    ],
  });
  const path = join(dir, 'panel.mjs');
  await writeFile(path, bundle.outputFiles[0].text);
  const { TeamsPanel, ProgressCard } = await import(path);
  const colors = Object.fromEntries(
    [
      'foreground',
      'foregroundMuted',
      'surface0',
      'surface1',
      'surface2',
      'border',
      'accent',
      'accentForeground',
      'statusDanger',
    ].map((key) => [key, key]),
  );
  let opened = '';
  const props = {
    workspaceId: 'workspace',
    context: 'workspace',
    theme: { colors },
    layout: { compact: true, platform: 'ios' },
    host: { id: 'host', label: 'Local' },
    navigation: {
      openAgent: ({ agentId }: { agentId: string }) => {
        opened = agentId;
      },
    },
  };
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(React.createElement(TeamsPanel, props));
  });
  t.after(() => act(() => renderer.unmount()));
  assert.equal(
    renderer.root.find((node) => String(node.type) === 'ScrollView').props.contentContainerStyle.padding,
    12,
  );
  assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Démarrer le workflow' }).props.disabled, true);
  assert.match(JSON.stringify(renderer.toJSON()), /Décrivez la tâche pour démarrer/);
  const modelSelects = renderer.root
    .findAll((node) => String(node.type) === 'SettingsSelect')
    .filter((x) => x.props.label.includes('modèle'));
  assert.equal(modelSelects[0].props.options[0].value, 'model-from-daemon');
  assert.equal(modelSelects[1].props.value, 'org/codex-from-daemon');
  const reviewerMode = renderer.root
    .findAll((node) => String(node.type) === 'SettingsSelect')
    .find((x) => x.props.label === 'reviewer · permissions')!;
  assert.deepEqual(
    reviewerMode.props.options.map((o: { value: string }) => o.value),
    ['plan'],
  );
  const reviewerHarness = renderer.root
    .findAll((node) => String(node.type) === 'SettingsSelect')
    .find((x) => x.props.label === 'reviewer · harnais')!;
  assert.ok(
    reviewerHarness.props.options.some(
      (o: { label: string; value: string }) => o.label === 'Claude — credits' && o.value === 'credit-account',
    ),
  );
  await act(async () => {
    reviewerHarness.props.onValueChange('credit-account');
  });
  assert.deepEqual(
    reviewerMode.props.options.map((o: { value: string }) => o.value),
    ['plan'],
  );
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Tâche' }).props.onChangeText('OAuth2');
  });
  assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Démarrer le workflow' }).props.disabled, false);
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Démarrer le workflow' }).props.onPress();
  });
  assert.equal((launched as { task: string }).task, 'OAuth2');
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Chemins des dépôts' }).props.onChangeText('/repo/api\n/repo/web');
  });
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Appliquer les dépôts' }).props.onPress();
  });
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Démarrer le workflow' }).props.onPress();
  });
  assert.deepEqual((launched as { config: { repositoryPaths: string[] } }).config.repositoryPaths, [
    '/repo/api',
    '/repo/web',
  ]);

  assert.deepEqual((launched as { config: { roles: { reviewer: unknown } } }).config.roles.reviewer, {
    provider: 'credit-account/fable',
    modeId: 'plan',
  });
  await act(async () => {
    reviewerHarness.props.onValueChange('pi');
  });
  assert.match(JSON.stringify(renderer.toJSON()), /sans sandbox garantie/);
  assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Démarrer le workflow' }).props.disabled, false);
  const builderHarness = renderer.root
    .findAll((node) => String(node.type) === 'SettingsSelect')
    .find((x) => x.props.label === 'builder · harnais')!;
  await act(async () => {
    builderHarness.props.onValueChange('opencode');
  });
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Démarrer le workflow' }).props.onPress();
  });
  assert.deepEqual((launched as { config: { roles: { builder: unknown } } }).config.roles.builder, {
    provider: 'opencode/zen/free-example',
    modeId: 'build',
  });
  const validation = renderer.root
    .findAll((node) => String(node.type) === 'SettingsSelect')
    .find((x) => x.props.label === 'Validation humaine')!;
  await act(async () => {
    validation.props.onValueChange('autonomous');
  });
  assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Démarrer le workflow' }).props.disabled, false);
  assert.match(JSON.stringify(renderer.toJSON()), /Le Planner choisit les commandes de test/);
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Démarrer le workflow' }).props.onPress();
  });
  assert.deepEqual((launched as { config: { testCommands: unknown } }).config.testCommands, []);
  await act(async () => {
    renderer.root
      .findByProps({ accessibilityLabel: 'Commandes de test au lancement' })
      .props.onChangeText('npm run check');
  });
  assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Démarrer le workflow' }).props.disabled, false);
  let chosenRepository = '';
  Object.assign(registry.catalog, {
    launchIssue: 'Ce dossier n’est pas un dépôt Git accessible.',
    repositories: ['/repo/project'],
  });
  await act(async () => {
    renderer.update(
      React.createElement(TeamsPanel, {
        ...props,
        onChooseRepository: async (path: string) => {
          chosenRepository = path;
        },
      }),
    );
  });
  assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Démarrer le workflow' }).props.disabled, true);
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Ouvrir Agent Teams dans /repo/project' }).props.onPress();
  });
  assert.equal(chosenRepository, '/repo/project');
  registry.workflows = [
    {
      id: 'workflow',
      revision: 2,
      task: 'OAuth2',
      phase: 'building',
      status: 'awaiting_plan',
      cycle: 0,
      config: { maxCorrections: 2, mode: 'auto' },
      agents: { planner: 'native-planner' },
      plan: { summary: 'Plan', tests: [] },
      planVersions: [{ version: 1, source: 'planner' }],
      tests: [],
      events: [],
    },
  ];
  await act(async () => {
    renderer.update(React.createElement(TeamsPanel, props));
  });
  assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Approuver le plan et les tests' }));
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Commandes de test à approuver' }).props.onChangeText('draft test');
  });
  await act(async () => {
    renderer.update(React.createElement(TeamsPanel, props));
  });
  assert.equal(
    renderer.root.findByProps({ accessibilityLabel: 'Commandes de test à approuver' }).props.value,
    'draft test',
  );
  Object.assign(registry.workflows[0] as object, {
    plan: { summary: 'Plan', tests: [{ command: 'node smoke.js', timeoutMs: 1000 }] },
    planVersions: [{ version: 2, source: 'reviewer' }],
  });
  await act(async () => {
    renderer.update(React.createElement(TeamsPanel, props));
  });
  assert.equal(
    renderer.root.findByProps({ accessibilityLabel: 'Commandes de test à approuver' }).props.value,
    'node smoke.js',
  );
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Ouvrir planner' }).props.onPress();
  });
  assert.equal(opened, 'native-planner');
  (registry.workflows[0] as { agents: Record<string, string> }).agents.reviewer = 'allocated-but-not-started';
  await act(async () => {
    renderer.update(React.createElement(TeamsPanel, props));
  });
  assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Phase Review' }).props.disabled, true);
  Object.assign(registry.workflows[0] as object, { status: 'permission', workspaceId: 'workspace' });
  registry.permissions = [
    {
      id: 'native-request',
      role: 'builder',
      title: 'Run tests',
      description: 'npm test',
      kind: 'tool',
      details: '{}',
      actions: [],
      canAllow: true,
    },
  ];
  await act(async () => {
    renderer.update(React.createElement(TeamsPanel, props));
  });
  for (const [label, behavior] of [
    ['Autoriser', 'allow'],
    ['Refuser', 'deny'],
  ]) {
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: `${label} · Run tests` }).props.onPress();
    });
    assert.deepEqual(registry.actions.at(-1), {
      id: 'workflow',
      expectedRevision: 2,
      requestId: (registry.actions.at(-1) as { requestId: string }).requestId,
      action: 'permission',
      permissionId: 'native-request',
      behavior,
      workspaceId: 'workspace',
    });
  }
  registry.permissions = [];
  await act(async () => {
    renderer.update(React.createElement(TeamsPanel, props));
  });
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Reprendre après résolution des permissions' }).props.onPress();
  });
  assert.equal((registry.actions.at(-1) as { action: string }).action, 'resume');
  Object.assign(registry.workflows[0] as object, {
    status: 'attention',
    operation: undefined,
    config: {
      mode: 'auto',
      maxCorrections: 4,
      roles: {
        planner: { provider: 'claude/model-from-daemon', modeId: 'plan' },
        builder: { provider: 'codex/org/codex-from-daemon', modeId: 'auto' },
        reviewer: { provider: 'claude/model-from-daemon', modeId: 'plan' },
      },
    },
  });
  await act(async () => {
    renderer.update(React.createElement(TeamsPanel, props));
  });
  assert.match(JSON.stringify(renderer.toJSON()), /Continuer le workflow/);
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Repasser par le Planner' }).props.onPress();
  });
  assert.equal((registry.actions.at(-1) as { action: string }).action, 'continue');
  assert.equal((registry.actions.at(-1) as { role: string }).role, 'planner');
  const recoveryHarness = renderer.root
    .findAll((n) => String(n.type) === 'SettingsSelect')
    .find((n) => n.props.label === 'Reprise · harnais')!;
  await act(async () => {
    recoveryHarness.props.onValueChange('opencode');
  });
  assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Continuer depuis cette phase' }).props.disabled, true);
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Appliquer le harnais et le modèle' }).props.onPress();
  });
  assert.deepEqual((registry.actions.at(-1) as { selection: unknown }).selection, {
    provider: 'opencode/zen/free-example',
    modeId: 'build',
  });
  assert.equal((registry.actions.at(-1) as { action: string }).action, 'reconfigure');
  Object.assign(registry.workflows[0] as object, {
    status: 'completed',
    phase: 'done',
    testsApproved: true,
    allowNoTests: true,
    review: { verdict: 'pass', summary: 'Review OK', issues: [] },
    build: { summary: 'Implementation delivered', changes: ['callback.ts'], remaining: [] },
  });
  await act(async () => {
    renderer.update(React.createElement(TeamsPanel, props));
  });
  assert.match(JSON.stringify(renderer.toJSON()), /Bilan et prochaines étapes/);
  assert.ok(renderer.root.findByProps({ accessibilityLabel: 'Message à l’équipe' }));
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Créer une PR brouillon' }).props.onPress();
  });
  assert.equal((registry.actions.at(-1) as { purpose: string }).purpose, 'pull_request');
  const recipient = renderer.root
    .findAll((n) => String(n.type) === 'SettingsSelect')
    .find((n) => n.props.label === 'Destinataire du message')!;
  await act(async () => {
    recipient.props.onValueChange('reviewer');
    renderer.root
      .findByProps({ accessibilityLabel: 'Message à l’équipe' })
      .props.onChangeText('Que dois-je faire ensuite ?');
  });
  await act(async () => {
    renderer.root.findByProps({ accessibilityLabel: 'Envoyer le message' }).props.onPress();
  });
  assert.equal((registry.actions.at(-1) as { action: string }).action, 'followup');
  assert.equal((registry.actions.at(-1) as { role: string }).role, 'reviewer');
  assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Message à l’équipe' }).props.value, '');
  assert.match(JSON.stringify(renderer.toJSON()), /Message transmis à reviewer/);
  Object.assign(registry.workflows[0] as object, {
    followupResult: '[Ouvrir la PR](https://github.com/example/project/pull/1)',
  });
  await act(async () => {
    renderer.update(React.createElement(TeamsPanel, props));
  });
  await act(async () => {
    renderer.root.findAllByProps({ accessibilityRole: 'link' })[0].props.onPress();
  });
  assert.equal(registry.openedUrl, 'https://github.com/example/project/pull/1');
  Object.assign(registry.workflows[0] as object, {
    status: 'awaiting_plan',
    planProposal: {
      baseVersion: 1,
      summary: 'Une route séparée clarifie le contrat.',
      plan: { summary: 'Plan révisé', tasks: ['Route dédiée'], acceptance: ['Test vérifiable'], tests: [] },
    },
  });
  for (const compact of [true, false]) {
    await act(async () => {
      renderer.update(React.createElement(TeamsPanel, { ...props, layout: { ...props.layout, compact } }));
    });
    assert.match(JSON.stringify(renderer.toJSON()), /Route dédiée/);
    assert.match(JSON.stringify(renderer.toJSON()), /Le plan courant reste inchangé/);
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Adopter ce plan' }).props.disabled, false);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Adopter ce plan' }).props.onPress();
    });
    assert.equal((registry.actions.at(-1) as { action: string }).action, 'adopt_plan');
    await act(async () => {
      renderer.root
        .findByProps({ accessibilityLabel: 'Message à l’équipe' })
        .props.onChangeText('Propose une route dédiée');
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Réviser le plan avec le Reviewer' }).props.onPress();
    });
    assert.equal((registry.actions.at(-1) as { purpose: string }).purpose, 'plan_revision');
    assert.equal((registry.actions.at(-1) as { role: string }).role, 'reviewer');
    assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Message à l’équipe' }).props.value, '');
  }
  Object.assign(registry.workflows[0] as object, { phase: 'followup', operation: { role: 'reviewer' } });
  await act(async () => {
    renderer.update(React.createElement(TeamsPanel, props));
  });
  assert.equal(renderer.root.findByProps({ accessibilityLabel: 'Adopter ce plan' }).props.disabled, true);
  let card!: ReturnType<typeof create>;
  await act(async () => {
    card = create(
      React.createElement(ProgressCard, {
        ...props,
        agentId: 'planner',
        timestamp: new Date(),
        item: {
          data: {
            workflowId: 'workflow',
            status: 'completed',
            detail: 'Reviewed',
            cycle: 2,
            artifact: {
              role: 'planner',
              text: JSON.stringify({
                summary: 'Rendered plan',
                tasks: ['Implement callback'],
                acceptance: ['Tests pass'],
                tests: [],
              }),
            },
          },
        },
      }),
    );
  });
  assert.match(JSON.stringify(card.toJSON()), /Rendered plan/);
  assert.match(JSON.stringify(card.toJSON()), /Critères d’acceptation/);
  assert.doesNotMatch(JSON.stringify(card.toJSON()), /\\\"summary\\\"/);
  await act(async () => {
    card.unmount();
  });
});
