export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'list'; items: string[]; ordered: boolean }
  | { kind: 'quote'; text: string }
  | { kind: 'paragraph'; text: string };

/** Splits markdown into the small set of blocks the panel renders (no HTML, no images, no tables). */
export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
    } else if (line.startsWith('```')) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      i++;
      blocks.push({ kind: 'code', text: code.join('\n') });
    } else if (/^#{1,6}\s/.test(line)) {
      const [, hashes, text] = line.match(/^(#+)\s+(.*)$/)!;
      blocks.push({ kind: 'heading', level: hashes.length, text });
      i++;
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]); i++)
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      blocks.push({ kind: 'list', items, ordered });
    } else if (line.startsWith('>')) {
      const quote: string[] = [];
      for (; i < lines.length && lines[i].startsWith('>'); i++) quote.push(lines[i].replace(/^>\s?/, ''));
      blocks.push({ kind: 'quote', text: quote.join(' ') });
    } else {
      const paragraph: string[] = [];
      for (; i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|>|\s*([-*]|\d+\.)\s)/.test(lines[i]); i++)
        paragraph.push(lines[i]);
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    }
  }
  return blocks;
}
