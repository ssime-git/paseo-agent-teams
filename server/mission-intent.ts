/** Conservative launch hint. The read-only Planner also records intent in its plan. */
export function reviewOnlyTask(task: string): boolean {
  const first = task
    .split(/[.!?\n]/, 1)[0]
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  if (!/\b(?:review|revue|audit)\b/.test(first)) return false;
  const scope = first.replace(
    /\b(?:ne |do not |never |don't )(?:pas )?(?:corrig\w*|modifi\w*|implement\w*|fix\w*|edit\w*)/g,
    '',
  );
  return !/\b(?:implement\w*|corrig\w*|modifi\w*|fix\w*|edit\w*|ajout\w*|cre[ea]\w*|build|add)\b/.test(scope);
}
