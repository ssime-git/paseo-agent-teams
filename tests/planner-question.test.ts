import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PaseoApi } from '@getpaseo/client';
import { ownedPlannerWorkflow } from '../server/planner-question';
import { plannerQuestionReadRpc, plannerQuestionAnswerRpc } from '../shared/planner-question';
import { Store } from '../server/store';
import { workflowFixture } from './fixtures';
import { git, repository } from '../server/git';

test('Planner card reads require the native owner, workspace and canonical repository without changing V1 state', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'teams-planner-card-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cwd = join(directory, 'repo');
  await mkdir(cwd);
  await git(cwd, ['init', '-q']);
  const store = new Store(join(directory, 'state'));
  const w = workflowFixture();
  w.cwd = cwd;
  w.repo = (await repository(cwd)).lock;
  w.requests = { 'create:team:owner-agent:mission': 'saved' };
  await store.put(w);
  let owner: { provider: string; workspaceId: string; cwd: string } | null = {
    provider: 'agent-teams',
    workspaceId: w.workspaceId,
    cwd,
  };
  let workspace = { workspaceDirectory: cwd };
  const api = {
    agents: { ref: (id: string) => ({ refresh: async () => ({ agent: id === 'owner-agent' ? owner : null }) }) },
    workspaces: { ref: (id: string) => ({ refresh: async () => (id === w.workspaceId ? workspace : null) }) },
  } as unknown as PaseoApi;
  const input = { id: w.id, workspaceId: w.workspaceId, ownerAgentId: 'owner-agent' };
  assert.deepEqual(await ownedPlannerWorkflow(api, store, input), w);
  await assert.rejects(ownedPlannerWorkflow(api, store, { ...input, ownerAgentId: 'other' }), /does not belong/);
  await assert.rejects(ownedPlannerWorkflow(api, store, { ...input, workspaceId: 'foreign' }));
  for (const value of [null, { ...owner!, provider: 'codex' }, { ...owner!, cwd: '/elsewhere' }]) {
    owner = value;
    await assert.rejects(ownedPlannerWorkflow(api, store, input), /owner unavailable/);
  }
  owner = { provider: 'agent-teams', workspaceId: w.workspaceId, cwd };
  workspace = { workspaceDirectory: '/elsewhere' };
  await assert.rejects(ownedPlannerWorkflow(api, store, input), /owner unavailable/);
  assert.deepEqual(await new Store(store.directory).get(w.id), w);
  assert.equal(plannerQuestionReadRpc.input.safeParse({ ...input, extra: true }).success, false);
  const answer = {
    ...input,
    expectedRevision: 0,
    clarificationId: 'pending',
    answer: { questionId: 'scope', text: 'Only docs' },
  };
  assert.equal(plannerQuestionAnswerRpc.input.safeParse(answer).success, true);
  assert.equal(plannerQuestionAnswerRpc.input.safeParse({ ...answer, answer: { questionId: 'scope' } }).success, false);
  assert.equal(plannerQuestionAnswerRpc.input.safeParse({ ...answer, expectedRevision: -1 }).success, false);
});

test('Planner shows inline radio choices and free response, blocks double submission and preserves pending context', async (t) => {
  const React = (await import('react')).default;
  const { create, act } = await import('react-test-renderer');
  const { loadResponseUi } = await import('./response-ui-harness');
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { PlannerQuestionCard } = await loadResponseUi(t, 'client/planner-question.tsx', '__plannerInlineTest');
  const options = [
    { id: 'small', label: 'Small', tradeoff: 'Quick' },
    { id: 'large', label: 'Large', tradeoff: 'Thorough' },
  ];
  const request = {
    kind: 'clarification',
    summary: 'Choose scope',
    questions: [
      { id: 'scope', title: 'Scope?', options, recommendedOptionId: 'small' },
      { id: 'format', title: 'Format?', options, recommendedOptionId: 'large' },
    ],
  };
  let w = {
    revision: 4,
    clarifications: [
      { id: 'pending', request, answers: [] as { questionId: string; optionId?: string; text?: string }[] },
    ],
  };
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  let fail = true,
    release!: () => void;
  (globalThis as Record<string, unknown>).__plannerInlineTest = {
    language: 'en',
    rpc: (name: string) => async (input: Record<string, unknown>) => {
      calls.push({ name, input });
      if (name === 'teams.planner_question') return structuredClone(w);
      if (fail) throw new Error('Revision conflict');
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      w = structuredClone(w);
      w.revision++;
      w.clarifications[0].answers.push(input.answer as (typeof w.clarifications)[0]['answers'][number]);
      return structuredClone(w);
    },
  };
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__plannerInlineTest;
  });
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      React.createElement(PlannerQuestionCard, {
        agentId: 'owner',
        item: {
          data: { id: 'workflow', workspaceId: 'workspace', clarificationId: 'pending', text: 'Historical request' },
        },
        theme: { colors: {} },
      }),
    );
  });
  t.after(() => act(() => tree.unmount()));
  const nodes = () => tree.root.findAllByType('Pressable' as never);
  const button = (label: string) => nodes().find((n) => n.props.accessibilityLabel === label)!;
  const text = () => JSON.stringify(tree.toJSON());
  assert.match(text(), /Scope\?/);
  assert.equal(calls.length, 1);
  assert.equal(tree.root.findAllByType('Modal' as never).length, 0);
  assert.ok(
    nodes()
      .filter((n) => n.props.accessibilityRole === 'radio')
      .every((n) => n.props.accessibilityState.checked === false),
  );
  assert.equal(button('Send response').props.disabled, true);
  await act(async () => button('Small · Recommended').props.onPress());
  assert.equal(button('Small · Recommended').props.accessibilityState.checked, true);
  await act(async () => tree.root.findByType('TextInput' as never).props.onChangeText('Only documentation'));
  await act(async () => button('Send response').props.onPress());
  assert.match(text(), /Revision conflict/);
  assert.equal(tree.root.findByType('TextInput' as never).props.value, 'Only documentation');
  fail = false;
  await act(async () => {
    const send = button('Send response').props.onPress;
    send();
    send();
  });
  assert.equal(calls.filter((c) => c.name === 'teams.planner_answer').length, 2); // One failed attempt, one in flight.
  await act(async () => release());
  assert.deepEqual(calls.at(-1)?.input, {
    id: 'workflow',
    workspaceId: 'workspace',
    ownerAgentId: 'owner',
    expectedRevision: 4,
    clarificationId: 'pending',
    answer: { questionId: 'scope', optionId: 'small', text: 'Only documentation' },
  });
  assert.match(text(), /Format\?/);
  assert.equal(tree.root.findByType('TextInput' as never).props.value, '');
  assert.equal(button('Send response').props.disabled, true);
  assert.equal(calls.filter((c) => c.name === 'teams.planner_question').length, 1); // No read loop or model loop.
  // Reusing a timeline row for a different clarification must not copy an unsent draft.
  await act(async () => tree.root.findByType('TextInput' as never).props.onChangeText('Draft for the old request'));
  w = {
    revision: 6,
    clarifications: [{ id: 'next', request: { ...request, questions: [request.questions[1]] }, answers: [] }],
  };
  await act(async () =>
    tree.update(
      React.createElement(PlannerQuestionCard, {
        agentId: 'owner',
        item: { data: { id: 'workflow', workspaceId: 'workspace', clarificationId: 'next', text: 'Next request' } },
        theme: { colors: {} },
      }),
    ),
  );
  assert.equal(tree.root.findByType('TextInput' as never).props.value, '');
  assert.equal(button('Send response').props.disabled, true);
  assert.equal(calls.filter((c) => c.name === 'teams.planner_question').length, 2);
});
