import { describe, expect, it } from 'vitest';
import { auctionVerdict, closeTimeUtc, parseAuctions } from './treasury-auctions';

/** TreasuryDirect's own records of the last four 30-year auctions (fields trimmed), fetched 2026-10-09. */
const RAW = [
  { securityType: 'Bond', securityTerm: '29-Year 10-Month', originalSecurityTerm: '30-Year', auctionDate: '2026-10-08T00:00:00', closingTimeCompetitive: '01:00 PM', offeringAmount: '22000000000', bidToCoverRatio: '2.540000', primaryDealerAccepted: '1490500000', indirectBidderAccepted: '15866059500', totalAccepted: '22522535300', highYield: '5.6180', tips: 'No', floatingRate: 'No' },
  { securityType: 'Bond', securityTerm: '29-Year 11-Month', originalSecurityTerm: '30-Year', auctionDate: '2026-09-10T00:00:00', closingTimeCompetitive: '01:00 PM', offeringAmount: '22000000000', bidToCoverRatio: '2.610000', primaryDealerAccepted: '484800000', totalAccepted: '22000024000', highYield: '5.3080', tips: 'No' },
  { securityType: 'Bond', securityTerm: '30-Year', originalSecurityTerm: '30-Year', auctionDate: '2026-08-13T00:00:00', closingTimeCompetitive: '01:00 PM', offeringAmount: '25000000000', bidToCoverRatio: '2.390000', primaryDealerAccepted: '2866735000', totalAccepted: '31323533800', highYield: '5.2160', tips: 'No' },
  { securityType: 'Bond', securityTerm: '29-Year 10-Month', originalSecurityTerm: '30-Year', auctionDate: '2026-07-09T00:00:00', closingTimeCompetitive: '01:00 PM', offeringAmount: '22000000000', bidToCoverRatio: '2.440000', primaryDealerAccepted: '2206260000', totalAccepted: '24287893700', highYield: '5.0580', tips: 'No' },
  { securityType: 'Bill', securityTerm: '13-Week', auctionDate: '2026-10-13T00:00:00', closingTimeCompetitive: '11:30 AM' },
];

describe('Treasury auctions', () => {
  const list = parseAuctions(RAW);

  it('closes at 13:00 New York — 17:00 UTC in summer, 18:00 in winter', () => {
    expect(new Date(closeTimeUtc('2026-10-08T00:00:00', '01:00 PM')!).toISOString()).toBe('2026-10-08T17:00:00.000Z');
    expect(new Date(closeTimeUtc('2026-12-10T00:00:00', '01:00 PM')!).toISOString()).toBe('2026-12-10T18:00:00.000Z');
    expect(new Date(closeTimeUtc('2026-10-13T00:00:00', '11:30 AM')!).toISOString()).toBe('2026-10-13T15:30:00.000Z');
  });

  it('keeps coupons, drops bills, and groups reopenings with their tenor', () => {
    expect(list.map((a) => a.tenor)).toEqual(['30-Year', '30-Year', '30-Year', '30-Year']);
    expect(list[3]).toMatchObject({ label: '30-Year Bond', offeringBn: 22, bidToCover: 2.54, highYield: 5.618 });
    expect(list[3].dealerPct).toBeCloseTo(6.62, 2);
  });

  it("reads Thursday's 30-year as strong against its own recent history", () => {
    expect(auctionVerdict(list[3], list)).toBe('STRONG demand: bid-to-cover 2.54 vs 2.48 average of the last 3; dealers took 6.6% vs 6.8%; high yield 5.618%');
  });

  it('will not call it without three earlier auctions', () => {
    expect(auctionVerdict(list[1], list)).toBe('yield 5.216%, bid-to-cover 2.39, dealers took 9.2% (too few prior auctions to compare)');
  });
});
