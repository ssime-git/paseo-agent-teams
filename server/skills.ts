/** Native metadata only: skill contents and installation remain owned by the selected harness. */
export function relevantSkills(task: string, commands: { name: string; description: string; kind?: string }[]) {
  const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const request = normalize(task);
  const terms = new Set(request.match(/[\p{L}\p{N}]{4,}/gu) ?? []);
  return commands
    .filter((c) => c.kind === 'skill')
    .map((c) => {
      const name = normalize(c.name);
      const words = new Set(normalize(`${c.name} ${c.description}`).match(/[\p{L}\p{N}]{4,}/gu) ?? []);
      const score = (request.includes(name) ? 100 : 0) + [...terms].filter((t) => words.has(t)).length;
      return { name: c.name.slice(0, 120), description: c.description.slice(0, 240), score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map(({ name, description }) => ({ name, description }));
}
