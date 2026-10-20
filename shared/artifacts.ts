import { planSchema, buildSchema, reviewSchema, type Role } from './contracts';

/** Normalize harmless key whitespace; collisions must never silently overwrite values. */
function normalized(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    const name = key.trim();
    if (name in result) throw new Error(`Ambiguous result key: ${name}`);
    result[name] = item;
  }
  return result;
}
export function parseJson(text: string): unknown {
  return normalized(
    JSON.parse(
      text
        .trim()
        .replace(/^(?:---[ \t]*\r?\n\s*)+/, '')
        .replace(/^```(?:json)?\s*\n?/, '')
        .replace(/\n?```$/, ''),
    ),
  );
}
export function parseResult(role: Role, text: string) {
  const schema = role === 'planner' ? planSchema : role === 'builder' ? buildSchema : reviewSchema;
  try {
    return schema.parse(parseJson(text));
  } catch {
    /* Look for one complete fenced artifact. */
  }
  const candidates = [...text.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```/g)].flatMap((match) => {
    try {
      const result = schema.safeParse(parseJson(match[1]));
      return result.success ? [result.data] : [];
    } catch {
      return [];
    }
  });
  const unique = [...new Map(candidates.map((value) => [JSON.stringify(value), value])).values()];
  if (unique.length > 1) throw new Error('Multiple conflicting result artifacts');
  if (unique.length === 1) return unique[0];
  return schema.parse(parseJson(text));
}
