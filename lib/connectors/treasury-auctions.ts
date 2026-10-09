/**
 * US Treasury coupon auctions from TreasuryDirect's public JSON API, free and
 * keyless (verified 2026-10-09: the 2026-10-08 30-year reopening returned with
 * its bid-to-cover, dealer take-up and 1:00 PM close).
 *
 * An auction is a scheduled bond-market event that moves yields at a known
 * minute: 13:00 New York for notes and bonds, 11:30 for most bills. A strong
 * one (high bid-to-cover, little left to the primary dealers) pulls yields
 * down; a weak one pushes them up. The reaction reader needs both the minute
 * and that verdict, and the calendar we score from carries neither.
 *
 * Context for the analyst only; nothing here feeds a score.
 */

import { fetchJson, fixturesEnabled } from '@/lib/connectors/base';
import { zonedToUtc } from '@/lib/analysis/tz';

const BASE = 'https://www.treasurydirect.gov/TA_WS/securities';
/** Six hours: results do not change once published, and the schedule moves weekly. */
const CACHE_TTL_SECONDS = 6 * 3600;
/** Enough history for six prior auctions of every coupon tenor (they are monthly). */
const HISTORY_DAYS = 220;
/** Prior auctions of the same tenor to compare against. */
const COMPARE_WITH = 6;

export interface TreasuryAuction {
  /** "30-Year Bond", "10-Year Note". */
  label: string;
  /** The original tenor, so reopenings group with their series ("30-Year"). */
  tenor: string;
  type: string;
  /** When competitive bidding closed, epoch milliseconds. */
  closeMs: number;
  offeringBn: number | null;
  /** Null until the results are out. */
  bidToCover: number | null;
  /** Share of the accepted amount left to the primary dealers, percent. */
  dealerPct: number | null;
  /** Share taken by indirect bidders (foreign and other investors through dealers), percent. */
  indirectPct: number | null;
  highYield: number | null;
}

interface RawAuction {
  securityType?: string;
  securityTerm?: string;
  originalSecurityTerm?: string;
  type?: string;
  auctionDate?: string;
  closingTimeCompetitive?: string;
  offeringAmount?: string;
  bidToCoverRatio?: string;
  primaryDealerAccepted?: string;
  indirectBidderAccepted?: string;
  totalAccepted?: string;
  highYield?: string;
  tips?: string;
  floatingRate?: string;
}

const n = (v: string | undefined) => {
  const x = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(x) ? x : null;
};

/** "01:00 PM" on the auction date, New York time, as UTC. */
export function closeTimeUtc(auctionDate: string, closing: string | undefined): number | null {
  const d = auctionDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!d) return null;
  const t = (closing ?? '01:00 PM').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  let hh = t ? +t[1] % 12 : 13;
  if (t && /pm/i.test(t[3])) hh += 12;
  return zonedToUtc(+d[1], +d[2], +d[3], hh, t ? +t[2] : 0, 'America/New_York');
}

export function parseAuctions(raw: unknown): TreasuryAuction[] {
  if (!Array.isArray(raw)) return [];
  const out: TreasuryAuction[] = [];
  for (const r of raw as RawAuction[]) {
    if (!r.auctionDate || !r.securityType || r.securityType === 'Bill' || r.floatingRate === 'Yes') continue;
    const closeMs = closeTimeUtc(r.auctionDate, r.closingTimeCompetitive);
    if (closeMs === null) continue;
    const tenor = r.originalSecurityTerm || r.securityTerm || '';
    const total = n(r.totalAccepted);
    const share = (v: string | undefined) => {
      const x = n(v);
      return x !== null && total ? (x / total) * 100 : null;
    };
    const offering = n(r.offeringAmount);
    out.push({
      label: `${tenor} ${r.tips === 'Yes' ? 'TIPS' : r.securityType}`,
      tenor: `${tenor}${r.tips === 'Yes' ? ' TIPS' : ''}`,
      type: r.securityType,
      closeMs,
      offeringBn: offering === null ? null : offering / 1e9,
      bidToCover: n(r.bidToCoverRatio),
      dealerPct: share(r.primaryDealerAccepted),
      indirectPct: share(r.indirectBidderAccepted),
      highYield: n(r.highYield),
    });
  }
  return out.sort((a, b) => a.closeMs - b.closeMs);
}

/**
 * "STRONG demand: bid-to-cover 2.54 vs 2.51 average of the last 6; dealers took
 * 6.6% vs 10.9%". Strong when both read better than the series' own recent
 * average, weak when both read worse, otherwise mixed.
 */
export function auctionVerdict(a: TreasuryAuction, history: TreasuryAuction[]): string | null {
  if (a.bidToCover === null) return null;
  const prior = history.filter((h) => h.tenor === a.tenor && h.closeMs < a.closeMs && h.bidToCover !== null).slice(-COMPARE_WITH);
  const parts = [`yield ${a.highYield ?? 'n/a'}%`, `bid-to-cover ${a.bidToCover.toFixed(2)}`];
  if (a.dealerPct !== null) parts.push(`dealers took ${a.dealerPct.toFixed(1)}%`);
  if (prior.length < 3) return `${parts.join(', ')} (too few prior auctions to compare)`;
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  const btc = avg(prior.map((p) => p.bidToCover))!;
  const dealers = avg(prior.map((p) => p.dealerPct));
  const better = [a.bidToCover > btc, dealers !== null && a.dealerPct !== null ? a.dealerPct < dealers : null].filter((x) => x !== null);
  const verdict = better.every(Boolean) ? 'STRONG demand' : better.every((x) => !x) ? 'WEAK demand' : 'MIXED demand';
  return (
    `${verdict}: bid-to-cover ${a.bidToCover.toFixed(2)} vs ${btc.toFixed(2)} average of the last ${prior.length}` +
    `${dealers !== null && a.dealerPct !== null ? `; dealers took ${a.dealerPct.toFixed(1)}% vs ${dealers.toFixed(1)}%` : ''}` +
    `${a.highYield !== null ? `; high yield ${a.highYield}%` : ''}`
  );
}

export interface AuctionCalendar {
  /** Results of recent auctions, oldest first. */
  past: TreasuryAuction[];
  upcoming: TreasuryAuction[];
}

/** Recent results and the coming schedule. Empty on any failure: a missing feed is a gap. */
export async function fetchTreasuryAuctions(): Promise<AuctionCalendar> {
  if (fixturesEnabled()) return { past: [], upcoming: [] };
  const opts = { cacheTtlSeconds: CACHE_TTL_SECONDS, timeoutMs: 12_000, retries: 1 };
  // Notes and bonds only: bills are most of the feed and rarely move the market.
  const [notes, bonds, upcoming] = await Promise.all([
    fetchJson<unknown>('TreasuryDirect', `${BASE}/auctioned?format=json&type=Note&days=${HISTORY_DAYS}`, opts),
    fetchJson<unknown>('TreasuryDirect', `${BASE}/auctioned?format=json&type=Bond&days=${HISTORY_DAYS}`, opts),
    fetchJson<unknown>('TreasuryDirect', `${BASE}/upcoming?format=json`, opts),
  ]);
  const past = [...(notes.ok ? parseAuctions(notes.data) : []), ...(bonds.ok ? parseAuctions(bonds.data) : [])].sort((a, b) => a.closeMs - b.closeMs);
  return { past, upcoming: upcoming.ok ? parseAuctions(upcoming.data) : [] };
}
