import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '@/lib/ui/mini-markdown';

describe('parseMarkdown', () => {
  it('reads the shapes the analyst writes', () => {
    const blocks = parseMarkdown(
      ['## Verdict', 'Board says **Neutral** (-2).', '', '- one', '- two', '  continued', '1. first', '2) second', '---', 'tail'].join('\n'),
    );
    expect(blocks).toEqual([
      { type: 'heading', level: 2, inlines: [{ text: 'Verdict' }] },
      { type: 'paragraph', inlines: [{ text: 'Board says ' }, { text: 'Neutral', bold: true }, { text: ' (-2).' }] },
      { type: 'list', ordered: false, items: [[{ text: 'one' }], [{ text: 'two continued' }]] },
      { type: 'list', ordered: true, items: [[{ text: 'first' }], [{ text: 'second' }]] },
      { type: 'rule' },
      { type: 'paragraph', inlines: [{ text: 'tail' }] },
    ]);
  });

  it('keeps markup as text, so a headline cannot inject HTML', () => {
    const blocks = parseMarkdown('<img src=x onerror=alert(1)> **ok**');
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      inlines: [{ text: '<img src=x onerror=alert(1)> ' }, { text: 'ok', bold: true }],
    });
  });

  it('reads a table, with <br> as a line break inside a cell', () => {
    const blocks = parseMarkdown(
      ['| Zone | Condition |', '|------|:---------:|', '| **1.12196** | CPI miss<br>Fed pause |', '| 1.12880 | ISM beat |', 'after'].join('\n'),
    );
    expect(blocks[0]).toEqual({
      type: 'table',
      header: [[[{ text: 'Zone' }]], [[{ text: 'Condition' }]]],
      rows: [
        [[[{ text: '1.12196', bold: true }]], [[{ text: 'CPI miss' }], [{ text: 'Fed pause' }]]],
        [[[{ text: '1.12880' }]], [[{ text: 'ISM beat' }]]],
      ],
    });
    expect(blocks[1]).toEqual({ type: 'paragraph', inlines: [{ text: 'after' }] });
  });

  it('leaves a lone pipe in prose alone', () => {
    expect(parseMarkdown('| not a table |')[0].type).toBe('paragraph');
  });

  it('survives a half-streamed chunk', () => {
    expect(parseInline('a **bol')).toEqual([{ text: 'a **bol' }]);
    expect(parseMarkdown('## ')).toEqual([{ type: 'paragraph', inlines: [{ text: '##' }] }]);
  });

  it('reads code and italics, and leaves a lone asterisk alone', () => {
    expect(parseInline('`TTF=F` is *gas*, 3 * 4')).toEqual([
      { text: 'TTF=F', code: true },
      { text: ' is ' },
      { text: 'gas', italic: true },
      { text: ', 3 * 4' },
    ]);
  });
});
