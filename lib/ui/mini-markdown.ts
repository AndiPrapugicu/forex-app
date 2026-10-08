/**
 * Just enough Markdown for the analyst's answers, parsed to a tree.
 *
 * The model writes headings, bullet lists, numbered lists, bold and the odd
 * `code` span. Rendering that through `dangerouslySetInnerHTML` would make the
 * model's output — which quotes headlines from the open web — able to inject
 * markup into the page. Parsing to a tree and rendering it with React means
 * every character arrives as text, whatever it says.
 *
 * Tolerant of half-written input, because it re-parses on every streamed chunk.
 */

export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  /** Each cell is a list of LINES, because the model writes `<br>` inside cells. */
  | { type: 'table'; header: Inline[][][]; rows: Inline[][][][] }
  | { type: 'rule' };

/** `| a | b |` → ['a', 'b']. Leading and trailing pipes are optional. */
function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

const isTableLine = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** A cell's text, split on `<br>` into lines, each parsed for inline marks. */
function cellLines(text: string): Inline[][] {
  return text.split(/<br\s*\/?>/i).map((part) => parseInline(part.trim())).filter((l) => l.length > 0);
}

/** `**bold**`, `*italic*` / `_italic_`, `` `code` ``. Unclosed markers stay literal. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_)/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    if (m[2] !== undefined) out.push({ text: m[2], bold: true });
    else if (m[3] !== undefined) out.push({ text: m[3], code: true });
    else out.push({ text: m[4] ?? m[5], italic: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', inlines: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map(parseInline) });
    list = null;
  };

  const lines = source.replace(/\r\n/g, '\n').split('\n');
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trimEnd();
    const trimmed = line.trim();

    // A table: a pipe row followed by a separator row. Anything else with pipes
    // stays a paragraph — a single "|" in prose is not a table.
    if (isTableLine(line) && n + 1 < lines.length && isSeparator(lines[n + 1])) {
      flushParagraph();
      flushList();
      const header = splitRow(line).map(cellLines);
      const rows: Inline[][][][] = [];
      n += 2;
      while (n < lines.length && isTableLine(lines[n])) {
        rows.push(splitRow(lines[n]).map(cellLines));
        n++;
      }
      n--;
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    if (trimmed === '') {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, inlines: parseInline(heading[2].replace(/\s*#+$/, '')) });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'rule' });
      continue;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const currentList = list as { ordered: boolean; items: string[] } | null;
      if (!currentList || currentList.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list!.items.push((bullet ?? numbered)![1]);
      continue;
    }

    // An indented line under a list item continues that item.
    const openList = list as { ordered: boolean; items: string[] } | null;
    if (openList && /^\s{2,}/.test(line)) {
      openList.items[openList.items.length - 1] += ` ${trimmed}`;
      continue;
    }

    flushList();
    paragraph.push(trimmed.replace(/<br\s*\/?>/gi, ' '));
  }
  flushParagraph();
  flushList();
  return blocks;
}
