---
title: Stock indices (SPX500, NAS100, US30, RUT2000, JP225, GER40, UK100)
asOf: 2026-10-03
sources:
  - internal: config/symbols.config.ts (RISK_ASSET_POLARITY)
  - https://www.federalreserve.gov/monetarypolicy/monetary-policy-what-are-its-goals-how-does-it-work.htm
---

# Stock indices

## How the board reads them
US indices read the **US economy**; GER40 reads the **euro area** and UK100 the **UK**. **Growth is bullish** and **hot inflation is bearish**, because hot inflation prices in tighter policy. (internal: symbols config, risk-asset polarity)

## Channels (background)
1. **Policy rates and yields.** Higher discount rates weigh on valuations, most of all for long-duration growth stocks (Nasdaq). The Fed names asset prices as a channel of policy. (Fed, goals of monetary policy)
2. **Earnings.** Reporting seasons can override macro signals for weeks. Earnings are not in our feeds, so say so if they are likely to matter.
3. **Risk appetite.** The VIX and credit conditions.
4. **Currency effects.** A weaker local currency tends to help exporters. This matters for the DAX, FTSE 100 and Nikkei, whose large constituents earn heavily abroad.
5. **Index composition.** The Russell 2000 is more domestic and more rate-sensitive (floating-rate debt). The Nasdaq is concentrated in mega-cap technology.
