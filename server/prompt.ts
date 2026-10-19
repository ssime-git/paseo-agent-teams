import { planSchema, buildSchema, reviewSchema, type Workflow, type Role } from '../shared/contracts';
const schemaFor = (role: Role) => (role === 'planner' ? planSchema : role === 'builder' ? buildSchema : reviewSchema);
export function boundedText(text: string, limit = 32 * 1024) {
  if (Buffer.byteLength(text) <= limit) return text;
  return Buffer.from(text).subarray(0, limit).toString('utf8') + '\n[Truncated]';
}
const serialize = (value: unknown) => boundedText(JSON.stringify(value) ?? 'undefined');
export function buildPrompt(w: Workflow, role: Role, context: string) {
  const instructions = {
    planner:
      'Analyze the repository. Propose architecture, tasks, acceptance criteria and test commands. Do not edit files.',
    builder: 'Implement the approved plan. Address the review and failed tests. Preserve pre-existing user changes.',
    reviewer:
      'Review the actual changes against the plan and initial repository state. Inspect test output. ' +
      'Do not edit files. Fail if tests fail or criteria are unmet.',
  };
  return [
    instructions[role],
    `Trusted launch test commands: ${serialize(w.config.testCommands)}`,
    `Task: ${boundedText(w.task)}`,
    'Logical conversation (including decisions and remaining work):',
    serialize(w.events.filter((e) => ['user', 'assistant', 'approved'].includes(e.kind)).slice(-20)),
    `Plan: ${serialize(w.plan)}`,
    `Build: ${serialize(w.build)}`,
    `Review: ${serialize(w.review)}`,
    `Tests: ${serialize(w.tests)}`,
    'Repository context:',
    boundedText(context, 256 * 1024),
    w.config.mode === 'auto'
      ? `Return ONLY a JSON object matching this schema: ${JSON.stringify(schemaFor(role).toJSONSchema())}`
      : 'Return a useful handoff briefing covering progress, decisions, relevant files and remaining work.',
  ].join('\n');
}
