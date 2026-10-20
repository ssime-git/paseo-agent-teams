import { parseResult } from '../shared/artifacts';
import type { z } from 'zod';
import type { nativeArtifactSchema } from '../shared/contracts';
type Artifact = z.infer<typeof nativeArtifactSchema>;
export const nativeText = (text: string) => text.trim().replace(/^(?:---[ \t]*\r?\n\s*)+/, '');
export function nativeMessageIndex(records: Artifact[]) {
  const index = new Map<string, Artifact | null>();
  for (const record of records) {
    const key = nativeText(record.text);
    if (!key) continue;
    const previous = index.get(key);
    index.set(
      key,
      previous && (previous.workflowId !== record.workflowId || previous.role !== record.role)
        ? null
        : previous === null
          ? null
          : record,
    );
  }
  return index;
}

/** Some native providers split one final report across several assistant items. */
export function projectNativeReport(text: string, index: ReturnType<typeof nativeMessageIndex>) {
  const part = nativeText(text);
  const exact = index.get(part);
  if (exact) return { kind: 'report' as const, record: exact };
  if (part.length < 256 || index.has(part)) return undefined;
  const candidates: { first: boolean; record: Artifact }[] = [];
  for (const [whole, record] of index) {
    if (!record || whole.length <= part.length || !whole.includes(part)) continue;
    try {
      parseResult(record.role, record.text);
    } catch {
      continue;
    }
    candidates.push({ first: whole.startsWith(part), record });
  }
  if (candidates.length !== 1) return undefined;
  return candidates[0].first
    ? { kind: 'report' as const, record: candidates[0].record }
    : { kind: 'continuation' as const };
}
