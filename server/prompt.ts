import {
  planSchema,
  planRevisionSchema,
  buildSchema,
  reviewSchema,
  type Workflow,
  type Role,
} from '../shared/contracts';
import { HANDOFF_BUDGET } from '../shared/context';
export { HANDOFF_BUDGET } from '../shared/context';
const schemaFor = (role: Role) => (role === 'planner' ? planSchema : role === 'builder' ? buildSchema : reviewSchema);
export function boundedText(text: string, limit = 32 * 1024) {
  if (Buffer.byteLength(text) <= limit) return text;
  return Buffer.from(text).subarray(0, limit).toString('utf8') + '\n[Truncated]';
}
const serialize = (value: unknown, limit?: number) => boundedText(JSON.stringify(value) ?? 'undefined', limit);
/** Rough token estimate (~4 bytes per token). */
export const estimateTokens = (text: string) => Math.ceil(Buffer.byteLength(text) / 4);
/** Hand-off budget per role, in tokens. */
const MIN_CONTEXT_BYTES = 2 * 1024;
const tail = (text: string, lines = 30) => text.trimEnd().split('\n').slice(-lines).join('\n');
// Test logs stay in the workflow record; hand-offs carry only a result line and the failing tail.
const testSummary = (w: Workflow) =>
  w.tests.map((t) => ({
    command: t.command,
    exitCode: t.exitCode,
    timedOut: t.timedOut,
    ...(t.exitCode === 0 && !t.timedOut ? {} : { tail: boundedText(tail(`${t.stdout}\n${t.stderr}`), 4 * 1024) }),
  }));
// Manual hand-offs also carry the latest assistant replies; auto roles exchange structured artifacts instead.
const conversation = (w: Workflow) =>
  w.events
    .filter((e) => ['user', 'approved', ...(w.config.mode === 'auto' ? [] : ['assistant'])].includes(e.kind))
    .slice(-10)
    .map((e) => ({ kind: e.kind, text: boundedText(e.text, 2 * 1024) }));

/** The artifacts a role needs, never the full transcript. */
function artifacts(w: Workflow, role: Role): string[] {
  const plan = `Plan: ${serialize(w.plan, 8 * 1024)}`;
  const review = `Previous review: ${serialize(w.review, 4 * 1024)}`;
  const tests = `Tests: ${serialize(testSummary(w), 8 * 1024)}`;
  if (w.config.mode !== 'auto') return [plan, `Build: ${serialize(w.build, 4 * 1024)}`, review, tests];
  if (role === 'planner') return w.review ? [`Current plan: ${serialize(w.plan, 8 * 1024)}`, review, tests] : [];
  if (role === 'builder')
    return [plan, review, tests, `Remaining from last build: ${serialize(w.build?.remaining ?? [])}`];
  return [plan, `Build: ${serialize(w.build, 4 * 1024)}`, tests];
}

export function buildPrompt(w: Workflow, role: Role, context: string) {
  if (w.phase === 'followup')
    return [
      w.followup?.purpose === 'plan_revision'
        ? 'Discuss and revise the saved plan with the user as Reviewer. Do not edit files, commit, push or create external resources. A discussion must not approve or replace the current plan. Use kind=discussion for questions or explanations; use kind=proposal only for a complete revised plan ready for explicit adoption. Include concrete tasks, acceptance criteria and test commands. Preserve the user’s decisions.'
        : w.followup?.purpose === 'pull_request'
          ? 'The user explicitly requests a draft pull request for the validated work. Inspect the actual Git branch, remote, diff and GitHub authentication. Reuse an existing matching PR instead of creating a duplicate. Create a draft PR only if a meaningful diff and appropriate repository exist. You may create a branch, commit only provably workflow-owned changes, and push that branch. Preserve unrelated user changes; never force-push, merge, reset or clean files. Do not change implementation code. If ownership, permissions, authentication or the target branch are uncertain, report the precise blocker and next action. Never invent a PR URL.'
          : 'Answer this follow-up directly using the saved workflow context. This is a conversation, not a new implementation or planning stage. Do not edit files, commit, push or create external resources. Explain the next steps clearly when asked.',
      'The coordination directory may not be a Git repository. Use git -C <repository> for each selected target. A multi-repository delivery may need separate PRs: report the real result or blocker for each repository and never assume a shared branch or remote.',
      `Allowed repositories: ${serialize(w.repositoryTargets?.map((r) => r.root) ?? [w.cwd], 8 * 1024)}`,
      `Original task: ${boundedText(w.task, 16 * 1024)}`,
      `Plan: ${serialize(w.plan, 8 * 1024)}`,
      `Pending plan proposal: ${serialize(w.planProposal, 8 * 1024)}`,
      `Build: ${serialize(w.build, 4 * 1024)}`,
      `Review: ${serialize(w.review, 4 * 1024)}`,
      `Tests: ${serialize(testSummary(w), 8 * 1024)}`,
      `Previous follow-up response: ${boundedText(w.followupResult ?? '', 4 * 1024)}`,
      `Recent user messages: ${serialize(conversation(w), 8 * 1024)}`,
      `Repository context: ${boundedText(context, 16 * 1024)}`,
      w.followup?.purpose === 'plan_revision'
        ? `Respond in the user’s language. Return ONLY a JSON object matching this schema: ${JSON.stringify(planRevisionSchema.toJSONSchema())}`
        : 'Respond in the user’s language, in concise Markdown. Give the result, any real PR link or blocker, and concrete next steps. Do not return the pipeline JSON schema.',
    ].join('\n');
  const scopeInstructions = w.repositoryTargets?.length
    ? [
        `Workspace coordination directory: ${w.cwd}`,
        `Allowed Git repositories: ${serialize(
          w.repositoryTargets.map((r) => r.root),
          8 * 1024,
        )}`,
        'Analyze the request across these repositories. Identify the repository for each task, file change and verification. Test commands run from the coordination directory: use explicit cd <repository> && <command> or tool-specific directory options. The parent is a coordination and reading location only: do not initialize Git there or edit files outside the selected repository roots. If another repository is needed, ask the user to start a workflow with an expanded scope. Preserve each repository’s existing staged, unstaged and untracked changes.',
      ]
    : [];
  const instructions = {
    planner:
      'Analyze the repository. Propose architecture, tasks, acceptance criteria and test commands. Do not edit files.',
    builder: 'Implement the approved plan. Address the review and failed tests. Preserve pre-existing user changes.',
    reviewer:
      'Review the actual changes against the plan and initial repository state. Inspect test output. ' +
      'Do not edit files. Fail if tests fail or criteria are unmet.',
  };
  const head = [
    instructions[role],
    ...scopeInstructions,
    `Trusted launch test commands: ${serialize(w.config.testCommands, 8 * 1024)}`,
    `Task: ${boundedText(w.task, 16 * 1024)}`,
    'Recent decisions and messages:',
    serialize(conversation(w), 8 * 1024),
    ...artifacts(w, role),
  ];
  const tailPart =
    w.config.mode === 'auto'
      ? `Return ONLY a JSON object matching this schema: ${JSON.stringify(schemaFor(role).toJSONSchema())}`
      : 'Return a useful handoff briefing covering progress, decisions, relevant files and remaining work.';
  const fixed = Buffer.byteLength(head.join('\n') + tailPart);
  const contextLimit = Math.max(MIN_CONTEXT_BYTES, HANDOFF_BUDGET[role] * 4 - fixed);
  return [
    ...head,
    'Repository context (compact; inspect files yourself for more):',
    boundedText(context, contextLimit),
    tailPart,
  ].join('\n');
}
