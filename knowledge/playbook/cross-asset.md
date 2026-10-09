---
title: Cross-asset playbook (how stocks, yields, the dollar, gold and oil move together)
asOf: 2026-10-09
sources:
  - https://www.federalreserve.gov/monetarypolicy/monetary-policy-what-are-its-goals-how-does-it-work.htm
  - https://www.newyorkfed.org/research/capital_markets/ycfaq
  - https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html
  - https://fred.stlouisfed.org/series/DFII10
  - https://fred.stlouisfed.org/series/T5YIE
  - https://www.treasurydirect.gov/auctions/
  - https://www.mof.go.jp/english/policy/international_policy/reference/feio/index.html
  - internal: lib/analysis/reaction.ts (the patterns the reaction reader prints)
---

# Cross-asset playbook

Background for reading a move. Every pattern here is a **tendency**, not a law. Each one names what would contradict it, so a reading can be tested against the dossier rather than asserted.

## Stocks against yields: the four quadrants
| Stocks | Yields | Usual reading | What would contradict it |
|---|---|---|---|
| down | down | **Risk-off / growth scare**: money goes to safety, and the market prices more Fed cuts. | Havens not bid (gold, yen and franc flat); breadth narrow (one sector only). |
| down | up | **Rates or inflation shock**: a hawkish Fed, hot inflation, heavy supply or fiscal worry. | Oil and breakevens flat while the 2-year leads: then it is the Fed path, not inflation. |
| up | down | **Dovish relief**: cooler inflation or easier policy priced. | The dollar up strongly: then haven demand, not relief. |
| up | up | **Growth / reflation**: stronger activity priced. | The long end up much more than the front: term premium or supply, not growth. |

Stocks and bonds can also move on **different stories at the same time**. A single-company or single-sector shock (one report that hits AI and chip stocks) can coincide with a bond move driven by an auction or a data print. When the two break at different times, explain each separately.

## The curve: which end led
- **Bull steepener**: the front end falls more. The market pulls Fed cuts forward, typically after soft data or dovish Fed speakers.
- **Bull flattener**: the long end falls more. Growth fear, haven demand for duration, or strong demand at a long-bond auction.
- **Bear steepener**: the long end rises more. Term premium, supply and fiscal worry, or inflation risk.
- **Bear flattener**: the front end rises more. A hawkish repricing of the Fed path.
- The front end (2-year) tracks the expected policy path, which fed funds futures price (CME FedWatch). The NY Fed treats the curve's slope as a growth signal (NY Fed yield-curve FAQ).

## Breadth: Nasdaq against S&P and Russell
- **Nasdaq far weaker than the S&P, Russell flat or up**: a mega-cap or tech-specific story (earnings, AI, chips, regulation) or a rotation, not a macro sell-off.
- **All three down together, small caps worst**: growth or credit worry. The Russell is more domestic and more rate-sensitive.
- **All three down, small caps best**: rotation out of crowded large-cap tech.

## Havens
- **Yen and franc** strengthen in stress; **USD/JPY falls**. **Gold** is bid on fear and on falling real yields. **VIX** rises.
- The **dollar** is a haven against most currencies, but falls against the yen and franc in a US-led scare.
- Only one haven out of four confirming is weak evidence of real fear.

## Gold
- Its main driver is the **real yield** (the 10-year TIPS yield, FRED DFII10): falling real yields are bullish for gold, rising ones bearish. A stronger dollar is usually a headwind.
- Geopolitical fear can override real yields for days. Central-bank buying is a slow, structural support, not a daily driver.

## Oil
- Supply shocks (conflict near production or shipping lanes, OPEC+ cuts, outages) lift oil. Demand scares (weak China or US data) lower it.
- Higher oil lifts **inflation breakevens** (FRED T5YIE) and can push yields up. That is a "stagflation" mix: bad for importers (euro area, Japan, the UK) and good for CAD and NOK.
- De-escalation or diplomacy headlines usually pull oil down and lift stocks. They do not explain a risk-off move by themselves.

## Treasury auctions
- Coupon auctions close at **13:00 New York** (17:00 UTC in US summer time, 18:00 in winter). Results move yields within minutes (TreasuryDirect auctions).
- **Strong**: a high bid-to-cover against recent auctions of the same tenor, a small share left to primary dealers, a large indirect share. Yields fall, the long end most after a long-bond auction.
- **Weak** (a "tail", dealers taking a lot): yields rise.

## Yen intervention
- Japan's Ministry of Finance intervenes to support the yen after fast moves, usually at round levels and often in thin hours. A sudden 2–3% USD/JPY drop with no US data is the classic signature. MoF publishes the amounts after the fact (MoF intervention data).

## Carry
- High-yield currencies against low-yield ones (AUD/JPY, MXN/JPY) rise in calm markets and fall hard in risk-off, when carry trades are unwound.
