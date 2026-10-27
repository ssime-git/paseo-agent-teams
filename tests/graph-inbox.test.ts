import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { loadResponseUi } from './response-ui-harness';

test('inline graph form keeps silence pending and sends explicit partial answers without an overlay', async (t) => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { GraphInbox } = await loadResponseUi(t, 'client/graph-inbox.tsx', '__graphInboxTest');
  const requests: { name: string; input: Record<string, unknown> }[] = [];
  const options = [
    { id: 'one', label: 'Option one', tradeoff: 'Simple' },
    { id: 'two', label: 'Option two', tradeoff: 'Flexible' },
  ];
  let state = {
    id: 'graph',
    revision: 7,
    task: 'Choose a design',
    status: 'running',
    nextStepId: 'plan',
    source: { definition: { name: 'My workflow', steps: [{ id: 'plan', instruction: 'Plan' }] } },
    activations: [
      {
        operationId: 'operation',
        stepId: 'plan',
        clarificationAnswers: [] as unknown[],
        assessment: {
          status: 'clarification',
          request: {
            questions: [
              { id: 'first', title: 'First question', options, recommendedOptionId: 'one' },
              { id: 'second', title: 'Second question', options, recommendedOptionId: 'two' },
            ],
          },
        },
      },
    ],
  };
  let reject = true;
  (globalThis as Record<string, unknown>).__graphInboxTest = {
    rpc: (name: string) => async (input: Record<string, unknown>) => {
      requests.push({ name, input });
      if (name === 'teams.graph_list') return [structuredClone(state)];
      if (reject) throw new Error('Stale revision');
      state = structuredClone(state);
      state.revision++;
      state.activations[0].clarificationAnswers.push((input.submission as { answer: unknown }).answer);
      return structuredClone(state);
    },
  };
  t.after(() => {
    delete (globalThis as Record<string, unknown>).__graphInboxTest;
  });
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      React.createElement(GraphInbox, {
        agentId: 'owner',
        item: { data: { workspaceId: 'workspace', text: 'Saved report' } },
        theme: { colors: {} },
      }),
    );
  });
  t.after(() => act(() => tree.unmount()));
  const text = () => JSON.stringify(tree.toJSON());
  const button = (label: string) =>
    tree.root
      .findAllByType('Pressable' as never)
      .find((node) => node.findAllByType('Text' as never).some((n) => n.props.children === label))!;
  await act(async () => button('My workflow · Révision 7').props.onPress());
  assert.match(text(), /First question/);
  assert.match(text(), /Recommandé/);
  const radios = tree.root
    .findAllByType('Pressable' as never)
    .filter((node) => node.props.accessibilityRole === 'radio');
  assert.ok(radios.length >= 2);
  assert.ok(
    radios
      .filter((node) => node.props.accessibilityLabel.includes('Option'))
      .every((node) => node.props.accessibilityState.checked === false),
  );
  assert.equal(button('Envoyer la réponse').props.disabled, true);
  assert.equal(tree.root.findAllByType('Modal' as never).length, 0);
  assert.equal(requests.length, 1); // Loading and choosing a workflow never submit.
  await act(async () => tree.root.findByType('TextInput' as never).props.onChangeText('My free answer'));
  await act(async () => button('Envoyer la réponse').props.onPress());
  assert.match(text(), /Stale revision/);
  assert.equal(tree.root.findByType('TextInput' as never).props.value, 'My free answer');
  reject = false;
  await act(async () => button('Envoyer la réponse').props.onPress());
  assert.deepEqual(requests.at(-1), {
    name: 'teams.graph_response',
    input: {
      workspaceId: 'workspace',
      ownerAgentId: 'owner',
      id: 'graph',
      expectedRevision: 7,
      operationId: 'operation',
      submission: { action: 'answer', answer: { questionId: 'first', text: 'My free answer' } },
    },
  });
  assert.match(text(), /Second question/);
  assert.equal(tree.root.findByType('TextInput' as never).props.value, '');
  assert.equal(button('Continuer cette étape').props.disabled, true);
  assert.ok(requests.every((r) => r.name !== 'teams.graph_advance'));
  // Automatically emitted cards show their own form without another selection.
  await act(async () => tree.unmount());
  state.id = '00000000-0000-4000-8000-000000000002';
  await act(async () => {
    tree = create(
      React.createElement(GraphInbox, {
        agentId: 'owner',
        item: { data: { workspaceId: 'workspace', graphId: state.id, text: 'Pending graph' } },
        theme: { colors: {} },
      }),
    );
  });
  assert.match(text(), /Second question/);
  assert.equal(button('Envoyer la réponse').props.disabled, true);
  assert.ok(requests.every((r) => r.name !== 'teams.graph_advance'));
  // An older activation's inline card must not show the current activation's controls.
  await act(async () => tree.unmount());
  const beforeOldCard = requests.filter((r) => r.name === 'teams.graph_response').length;
  await act(async () => {
    tree = create(
      React.createElement(GraphInbox, {
        agentId: 'owner',
        item: {
          data: {
            workspaceId: 'workspace',
            graphId: state.id,
            operationId: '00000000-0000-4000-8000-000000000003',
            text: 'Old request',
          },
        },
        theme: { colors: {} },
      }),
    );
  });
  assert.equal(tree.root.findAllByType('TextInput' as never).length, 0);
  assert.match(text(), /Cette demande a été traitée/);
  assert.equal(requests.filter((r) => r.name === 'teams.graph_response').length, beforeOldCard);
});
