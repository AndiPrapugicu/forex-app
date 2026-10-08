import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_SYMBOLS, findSymbol } from '@/config/symbols.config';
import { KNOWLEDGE_DIR, knowledgeIdsFor, parseKnowledge, selectKnowledge } from '@/lib/analysis/knowledge';
import { readFileSync } from 'node:fs';

/** Every Markdown file under knowledge/, as an id like "currencies/EUR". */
function allIds(dir = KNOWLEDGE_DIR, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? allIds(path.join(dir, e.name), `${prefix}${e.name}/`)
      : e.name.endsWith('.md')
        ? [`${prefix}${e.name.slice(0, -3)}`]
        : [],
  );
}

/** A pair's whole background, in characters. About four characters to a token. */
const PAIR_BUDGET_CHARS = 40_000;

describe('knowledge files', () => {
  it('every file is dated and cites at least one source', () => {
    const ids = allIds();
    expect(ids).toEqual(expect.arrayContaining(['ANALYST', 'METHODOLOGY', 'currencies/EUR', 'currencies/USD', 'assets/gold']));
    for (const id of ids) {
      const file = parseKnowledge(id, readFileSync(path.join(KNOWLEDGE_DIR, `${id}.md`), 'utf8'));
      expect(file.asOf, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(file.sources.length, id).toBeGreaterThan(0);
      expect(file.body.length, id).toBeGreaterThan(200);
    }
  });

  it('every major currency has a profile', () => {
    for (const c of ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD']) {
      expect(allIds()).toContain(`currencies/${c}`);
    }
  });
});

describe('selectKnowledge', () => {
  it('gives a pair both economies and the method, with ANALYST as the system prompt', () => {
    const sel = selectKnowledge(findSymbol('EURUSD')!);
    expect(sel.system).toMatch(/Numbers come only from the dossier/);
    expect(sel.files.map((f) => f.id)).toEqual(['ANALYST', 'METHODOLOGY', 'currencies/EUR', 'currencies/USD']);
    expect(sel.background).toContain('Euro (EUR)');
    expect(sel.background).toContain('US dollar (USD)');
    expect(sel.missing).toEqual([]);
  });

  it('gives gold its asset file and the US economy', () => {
    expect(knowledgeIdsFor(findSymbol('XAUUSD')!)).toEqual(['METHODOLOGY', 'assets/gold', 'currencies/USD']);
    expect(knowledgeIdsFor(findSymbol('GER40')!)).toEqual(['METHODOLOGY', 'assets/indices', 'currencies/EUR']);
  });

  it('works for every symbol on the board, and stays inside the budget', () => {
    for (const def of ALL_SYMBOLS) {
      const sel = selectKnowledge(def);
      expect(sel.system.length + sel.background.length, def.symbol).toBeLessThan(PAIR_BUDGET_CHARS);
    }
  });

  it('names a profile that does not exist yet instead of failing', () => {
    expect(selectKnowledge(findSymbol('USDZAR')!).missing).toEqual(['currencies/ZAR']);
  });
});
