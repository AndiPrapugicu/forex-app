import { describe, expect, it } from 'vitest';
import { bankOf, classifyStance, conflictLevel, readConflicts, readFiscal, readOpec, readStance, type Headline } from '@/lib/analysis/headlines';

const h = (title: string, publishedUtc = '2026-10-02T10:00:00Z', domain = 'reuters.com'): Headline => ({ title, url: `https://${domain}/x`, domain, publishedUtc });
const at = new Date('2026-10-03T12:00:00Z');

describe('classifyStance', () => {
  it.each([
    ["Fed's Waller says no further rate hikes needed", 'dovish'],
    ["Fed's Daly doesn't see more hikes this year", 'dovish'],
    ['Fed officials signal they are done raising rates', 'dovish'],
    ["Fed's Logan: not ready to cut rates yet", 'hawkish'],
    ["ECB's Schnabel: rate cuts unlikely, inflation risks to the upside", 'hawkish'],
    ["Fed's Bowman sees more hikes if inflation stays sticky", 'hawkish'],
    ['BoE holds rates steady', 'hold'],
    // Live 2026-09-29: a hold with a hawkish minority is hawkish, not a hold.
    ['BoE Holds Rates but Three Policymakers Wanted a Hike', 'hawkish'],
    ["Fed's Musalem: more hikes possible, but cuts likely next year", 'ambiguous'],
  ])('%s → %s', (title, stance) => {
    expect(classifyStance(title)).toBe(stance);
  });

  it('never counts the negated phrase on the other side too', () => {
    // "further rate hikes" sits inside "no further rate hikes"; it must not also read hawkish.
    expect(classifyStance('No further rate hikes, says Fed official')).toBe('dovish');
  });

  it('ignores headlines with no stance', () => {
    expect(classifyStance('Fed releases beige book')).toBeNull();
  });
});

describe('bankOf', () => {
  it('takes the bank named first', () => {
    expect(bankOf("Fed's Waller says ECB moves matter less")).toBe('USD');
    expect(bankOf('Lagarde: ECB will not pre-commit')).toBe('EUR');
    expect(bankOf('Gold rises')).toBeNull();
  });
});

describe('readStance', () => {
  const list = [
    h("Fed's Waller says no further rate hikes needed"),
    h("Fed's Daly doesn't see more hikes this year", '2026-10-01T15:00:00Z', 'bloomberg.com'),
    h('Fed holds rates steady as officials weigh data', '2026-09-30T18:00:00Z', 'cnbc.com'),
    h('ECB policymakers back more tightening', '2026-10-01T08:00:00Z'),
  ];

  it('reads a hold as dovish while hikes are priced', () => {
    const r = readStance(list, 'USD', at, 7, 1);
    expect(r).toMatchObject({ dovish: 2, hold: 1, hawkish: 0, net: 'dovish' });
    expect(r.evidence.some((e) => e.text.includes('hold while hikes are priced → dovish'))).toBe(true);
  });

  it('keeps each bank to its own headlines', () => {
    expect(readStance(list, 'EUR', at, 7, 0)).toMatchObject({ hawkish: 1, dovish: 0, net: 'hawkish' });
  });
});

describe('conflicts, fiscal, OPEC', () => {
  it('calls three outlets on one escalation corroborated, and a ceasefire de-escalation', () => {
    const list = [
      h('Iran fires missiles at tanker near Strait of Hormuz', '2026-10-02T09:00:00Z', 'reuters.com'),
      h('Missiles hit tanker in Hormuz as Iran escalates', '2026-10-02T10:00:00Z', 'bloomberg.com'),
      h('Iran strikes shipping in the Gulf', '2026-10-02T11:00:00Z', 'ft.com'),
      h('Russia and Ukraine agree ceasefire talks', '2026-10-02T11:00:00Z', 'ft.com'),
    ];
    const [me, ru] = readConflicts(list, at, 7);
    expect(me).toMatchObject({ escalation: 3, corroborated: true });
    expect(conflictLevel(me)).toBe(2);
    expect(ru).toMatchObject({ escalation: 0, deescalation: 1 });
    expect(conflictLevel(ru)).toBe(-1);
  });

  it('needs the region AND a stress word for fiscal', () => {
    const list = [h('French government collapses after no-confidence vote'), h('France GDP beats forecast'), h('US CPI rises')];
    expect(readFiscal(list, 'EUR', at, 7).count).toBe(1);
    expect(readFiscal(list, 'USD', at, 7).count).toBe(0);
  });

  it('tells an OPEC+ cut from an output increase', () => {
    const r = readOpec([h('OPEC+ agrees to extend output cuts'), h('OPEC+ to boost output in November')], at, 7);
    expect(r).toMatchObject({ cut: 1, raise: 1 });
  });

  it('drops headlines outside the window', () => {
    expect(readFiscal([h('French government collapses', '2026-09-01T00:00:00Z')], 'EUR', at, 7).count).toBe(0);
  });
});
