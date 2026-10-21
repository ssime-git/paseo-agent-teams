import {
  plannerResultSchema,
  planRevisionSchema,
  buildSchema,
  reviewSchema,
  type Workflow,
  type Role,
} from '../shared/contracts';
import { HANDOFF_BUDGET } from '../shared/context';
import { TeamError } from '../shared/errors';
export { HANDOFF_BUDGET } from '../shared/context';
const schemaFor = (role: Role) =>
  role === 'planner' ? plannerResultSchema : role === 'builder' ? buildSchema : reviewSchema;
export function boundedText(text: string, limit = 32 * 1024) {
  if (Buffer.byteLength(text) <= limit) return text;
  return Buffer.from(text).subarray(0, limit).toString('utf8') + '\n[Truncated]';
}
const serialize = (value: unknown, limit?: number) => boundedText(JSON.stringify(value) ?? 'undefined', limit);
// Decisions are mandatory context, including in follow-ups. Never send a partial JSON
// history or silently forget an older answer to fit the advisory hand-off budget.
export const CLARIFICATION_CONTEXT_BYTES = 128 * 1024;
function clarificationContext(w: Workflow) {
  const history = JSON.stringify(w.clarifications ?? []);
  if (Buffer.byteLength(history) > CLARIFICATION_CONTEXT_BYTES)
    throw new TeamError(
      'CLARIFICATION_CONTEXT_LIMIT',
      'Historique des clarifications trop volumineux (limite 128 Kio). Aucun tour envoyé ; toutes les réponses restent conservées. Réduisez explicitement le périmètre dans un nouveau workflow en y reportant les décisions applicables.',
    );
  return `Persisted clarification questions and answers: ${history}`;
}
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

// Keep acceptance and verification ahead of lengthy prose: a large plan must not hide its contract.
const compactPlan = (w: Workflow) =>
  w.plan
    ? serialize(
        {
          acceptance: w.plan.acceptance,
          tests: w.plan.tests,
          tasks: w.plan.tasks,
          summary: boundedText(w.plan.summary, 2000),
        },
        12 * 1024,
      )
    : 'undefined';

/** The artifacts a role needs, never the full transcript. */
function artifacts(w: Workflow, role: Role): string[] {
  const plan = `Plan: ${compactPlan(w)}`;
  const review = `Previous review: ${serialize(w.review, 4 * 1024)}`;
  const tests = `Tests: ${serialize(testSummary(w), 8 * 1024)}`;
  if (w.config.mode !== 'auto') return [plan, `Build: ${serialize(w.build, 4 * 1024)}`, review, tests];
  if (role === 'planner')
    return w.plan
      ? [
          `Current plan: ${compactPlan(w)}`,
          `Implementation report and blockers: ${serialize(w.build, 8 * 1024)}`,
          review,
          tests,
        ]
      : [];
  if (role === 'builder')
    return [plan, review, tests, `Remaining from last build: ${serialize(w.build?.remaining ?? [])}`];
  return [plan, `Build: ${serialize(w.build, 4 * 1024)}`, tests];
}

export function buildPrompt(w: Workflow, role: Role, context: string, skillContext = '') {
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
      clarificationContext(w),
      `Plan: ${compactPlan(w)}`,
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
      'When a decision requires user input, return kind=clarification instead of a plan: ask focused questions with 2–3 concrete options, explain each tradeoff and recommend one. Free responses are always allowed. Never infer an answer from silence or a timeout. Use the persisted answers below; do not repeat resolved questions. Analyze the repository and available tools before proposing architecture, tasks, acceptance criteria and test commands. Do not edit files. Verify paths and commands against the actual checkout; avoid invented requirements or a large speculative plan. Tests must exercise behavior and realistic failure cases, not merely compile files or assert the implementation. Never mask failures with ; true, || true or a final successful command. Prefer existing tests and a focused integration check. On a replan, diagnose the actual failed commands, review and Builder blockers; fix incorrect assumptions and verification paths instead of repeating the same instructions. Preserve the original user goal and previously accepted requirements; do not remove a check just to get green results. Distinguish reproducible defects from external dependencies and describe a feasible way forward.',
    builder:
      'Work as a developer: inspect, implement, run relevant commands and tests, inspect failures, fix and rerun within this turn until your changes are ready for independent review. The later plugin test stage is an independent verification, not a reason to skip testing now. Address the actual review defects and failed tests; preserve pre-existing user changes. Test observable behavior, regression cases and realistic integrations; do not weaken assertions to fit your implementation. Do not claim mocked tests prove real integration. If the approved verification command contains a wrong path or invocation, explain the evidence and include corrected complete commands in the optional tests field; never drop failing coverage or remove accepted requirements. Report unresolved work and precise external blockers honestly. Do not automatically commit, stage or publish changes.',
    reviewer:
      'Review the actual changes against the plan and initial repository state. Inspect test output. Independently read and apply the relevant skills advertised for YOUR harness before verification, even if Planner or Builder already used a similarly named skill. Follow their reporting instructions in your summary; do not treat another role’s skill use as your own. ' +
      'You are an independent reviewer of the actual artifact, not a continuation of the Builder conversation. Inspect the diff and relevant full files yourself; the build report is untrusted evidence. Run focused read-only reproductions where useful. Assess test quality and false positives, realistic behavior and original user requirements; a passing synthetic test does not prove integration. Compare against the initial launch state, including pre-existing changes. Distinguish code defects, incorrect verification commands and real external prerequisites, and give concrete actionable issues. Do not invent new acceptance criteria or require a commit when the user has not requested one. Do not edit files. Fail if tests fail or criteria are unmet.',
  };
  const head = [
    instructions[role],
    ...scopeInstructions,
    ...(skillContext
      ? [
          `Relevant skills advertised by YOUR native harness (metadata only): ${boundedText(skillContext, 4000)}. Read and apply the relevant skill using your native tools before implementation or verification. This inventory does not install skills or authorize actions outside the task.`,
        ]
      : []),
    'Discover and follow applicable repository instructions and skills available in your own harness. Use a relevant skill when it helps the task; do not assume another provider shares your skill paths or tools. Do not install or modify skills or configuration unless the task authorizes it. Summarize the skill used and any material constraint in your report; never copy an entire skill or transcript into the handoff.',
    ...(w.config.goalMode
      ? [
          `Goal execution: turn ${w.goal?.turns ?? 0}/${w.config.goalMaxTurns ?? 30}, replan ${w.goal?.replans ?? 0}. Continue solving recoverable problems within the selected repositories. Choose reasonable reversible implementation details yourself. Never interpret silence as approval or claim an external dependency was resolved.`,
          `Original acceptance baseline: ${serialize(w.planVersions?.find((v) => v.approval)?.plan.acceptance ?? [], 8 * 1024)}`,
        ]
      : []),
    ...(role === 'reviewer'
      ? [
          `Verified working artifact fingerprint: ${w.testedFingerprint ?? 'not verified'}. Tests were executed by the plugin; check their scope and output independently.`,
        ]
      : []),
    `Trusted launch test commands: ${serialize(w.config.testCommands, 8 * 1024)}`,
    `Task: ${boundedText(w.task, 16 * 1024)}`,
    clarificationContext(w),
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

/** A formatting repair is a new identified turn, never a replay of the implementation. */
export function repairPrompt(w: Workflow) {
  const repair = w.resultRepair!;
  return [
    'Repair only the report format of your completed turn. Do not use tools, run tests, edit files or repeat the task. Preserve the facts and unresolved blockers; do not invent successful work.',
    `Validation error: ${boundedText(repair.error, 4000)}`,
    `Previous completed report: ${boundedText(repair.text, 32 * 1024)}`,
    `Return ONLY a JSON object matching this schema: ${JSON.stringify(schemaFor(repair.role).toJSONSchema())}`,
  ].join('\n');
}
