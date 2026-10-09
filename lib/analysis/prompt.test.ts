import { describe, expect, it } from 'vitest';
import { answerMode, buildMessages, formatSearchResults, modeInstruction, parseSearchArgs, trimThread, WORD_CAP } from '@/lib/analysis/prompt';

const knowledge = { system: 'INSTRUCTIONS', background: 'BACKGROUND', files: [], missing: [] };

describe('buildMessages', () => {
  it('puts instructions, background and dossier in that order, then the thread', () => {
    const msgs = buildMessages(knowledge, 'DOSSIER', [{ role: 'user', content: 'q' }]);
    expect(msgs[0].role).toBe('system');
    const sys = String(msgs[0].content);
    expect(sys.indexOf('INSTRUCTIONS')).toBeLessThan(sys.indexOf('BACKGROUND'));
    expect(sys.indexOf('BACKGROUND')).toBeLessThan(sys.indexOf('DOSSIER'));
    expect(msgs.slice(1)).toEqual([{ role: 'user', content: 'q' }]);
  });
});

describe('trimThread', () => {
  it('keeps the last turns, starts on a user turn and drops junk', () => {
    const thread = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` })) as {
      role: 'user' | 'assistant';
      content: string;
    }[];
    const out = trimThread([...thread, { role: 'system' as 'user', content: 'x' }, { role: 'user', content: '  ' }]);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out[0].role).toBe('user');
    expect(out.at(-1)!.content).toBe('m19');
  });

  it('caps a long user message', () => {
    expect(trimThread([{ role: 'user', content: 'a'.repeat(5000) }])[0].content).toHaveLength(2000);
  });
});

describe('search tool plumbing', () => {
  it('reads queries defensively and caps them at three', () => {
    expect(parseSearchArgs('{"queries":["a","b","c","d"]}')).toEqual(['a', 'b', 'c']);
    expect(parseSearchArgs('{"query":"gas"}')).toEqual(['gas']);
    expect(parseSearchArgs('not json')).toEqual([]);
  });

  it('formats hits with age and publisher', () => {
    const text = formatSearchResults(
      [{ query: 'gas', hits: [{ title: 'Gas up', source: 'Reuters', domain: 'reuters.com', url: 'u', publishedUtc: '2026-10-03T08:00:00Z' }] }],
      new Date('2026-10-03T09:00:00Z'),
    );
    expect(text).toBe('Search "gas":\n- [60 min ago · Reuters] Gas up');
  });
});

describe('answerMode', () => {
  it('lets a quick prompt say which', () => {
    expect(answerMode('anything', 'brief')).toBe('brief');
    expect(answerMode('what changed today', 'decision')).toBe('decision');
  });

  it.each([
    ['Ce s-a întâmplat în ultimele 24h pe EURUSD?', 'brief'],
    ['quick recap of the news', 'brief'],
    ['tell me what would be the best area to get in the trade for EURUSD taking in consideration its bullish', 'decision'],
    ['what changed today, and should I still hold my long?', 'decision'],
    ['Unde ar fi o zonă bună de intrare?', 'decision'],
    ['How does the Fed see inflation?', 'decision'],
  ])('%s → %s', (q, mode) => {
    expect(answerMode(q)).toBe(mode);
  });

  it('tells the model which mode it is in', () => {
    expect(buildMessages(knowledge, 'D', [{ role: 'user', content: 'q' }], 'brief')[0].content).toContain('ANSWER MODE: BRIEF');
    expect(buildMessages(knowledge, 'D', [{ role: 'user', content: 'q' }])[0].content).toContain('ANSWER MODE: DECISION');
  });
});

describe('short answers', () => {
  it('ends the system prompt with the mode, its word cap and the bottom-line rule', () => {
    const sys = String(buildMessages(knowledge, 'DOSSIER', [{ role: 'user', content: 'q' }], 'reaction')[0].content);
    expect(sys.indexOf('DOSSIER')).toBeLessThan(sys.indexOf('ANSWER MODE: REACTION'));
    expect(sys.trimEnd().endsWith('End with the one-line not-advice note.')).toBe(true);
    expect(sys).toContain('LENGTH: at most 220 words. Open with "**Bottom line:**"');
  });

  it('keeps every mode short except the full read', () => {
    expect(WORD_CAP).toEqual({ brief: 120, explain: 150, event: 200, compare: 200, reaction: 220, decision: 250, full: 600 });
    expect(modeInstruction('full')).toContain('FULL READ');
    expect(modeInstruction('reaction')).toContain('NO MATCH');
  });
});
