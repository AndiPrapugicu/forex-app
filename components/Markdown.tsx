/**
 * Renders `parseMarkdown`'s tree with React, so every character is text.
 * See lib/ui/mini-markdown.ts for why there is no HTML path.
 */

import type { ReactNode } from 'react';
import { parseMarkdown, type Inline } from '@/lib/ui/mini-markdown';

function renderInlines(inlines: Inline[]): ReactNode[] {
  return inlines.map((i, k) => {
    if (i.code) {
      return (
        <code key={k} className="rounded bg-[var(--color-surface-2)] px-1 font-mono text-[0.85em]">
          {i.text}
        </code>
      );
    }
    if (i.bold) return <strong key={k} className="font-semibold text-[var(--color-text)]">{i.text}</strong>;
    if (i.italic) return <em key={k}>{i.text}</em>;
    return <span key={k}>{i.text}</span>;
  });
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-[var(--color-text)]">
      {blocks.map((b, k) => {
        if (b.type === 'heading') {
          const size = b.level === 1 ? 'text-base' : 'text-sm';
          return (
            <h3 key={k} className={`${size} pt-1 font-semibold tracking-wide text-[var(--color-text)]`}>
              {renderInlines(b.inlines)}
            </h3>
          );
        }
        if (b.type === 'rule') return <hr key={k} className="border-[var(--color-border)]" />;
        if (b.type === 'table') {
          const cell = (lines: Inline[][]) =>
            lines.map((line, j) => (
              <span key={j} className="block">
                {renderInlines(line)}
              </span>
            ));
          return (
            <div key={k} className="overflow-x-auto rounded border border-[var(--color-border)]">
              <table className="w-full min-w-[560px] border-collapse text-xs">
                <thead className="bg-[var(--color-surface-2)]">
                  <tr>
                    {b.header.map((h, j) => (
                      <th key={j} scope="col" className="px-2 py-1.5 text-left align-bottom font-semibold text-[var(--color-muted)]">
                        {cell(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, r) => (
                    <tr key={r} className="border-t border-[var(--color-border)]">
                      {row.map((c, j) => (
                        <td key={j} className="px-2 py-1.5 align-top">
                          {cell(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (b.type === 'list') {
          const List = b.ordered ? 'ol' : 'ul';
          return (
            <List key={k} className={`space-y-1 pl-5 ${b.ordered ? 'list-decimal' : 'list-disc'} marker:text-[var(--color-faint)]`}>
              {b.items.map((item, j) => (
                <li key={j}>{renderInlines(item)}</li>
              ))}
            </List>
          );
        }
        return <p key={k}>{renderInlines(b.inlines)}</p>;
      })}
    </div>
  );
}
