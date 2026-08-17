# FX Intel

A personal trading scorecard. It ingests economic releases, COT positioning, price
technicals and news flow, then turns them into an **explainable** bullish/bearish
score across 51 symbols — 28 major FX pairs plus USDZAR, the 7 currencies as
standalone indices, gold, silver, platinum, copper, WTI, seven stock indices, the
dollar index and two cryptocurrencies.

Views: **Top Setups** (every symbol against every indicator, in Full / Simple /
Macro column presets), **Asset Scorecard** (an index of every asset, and each one
in full with trade levels), **Seasonality** (month, week and day-of-week
tendencies with a cross-symbol scanner), **Sentiment** (crowd positioning, read
contrarian), **Macro** (risk gauge, economic strength, surprise index, policy and
real rates, the yield curve, carry), **Score History**, **COT**, **Heatmap** and
**Indicators**, plus the original news and alerts dashboard.

**Prices are live.** Anywhere a price is shown it polls every 15 seconds through
one batched Yahoo call, pausing while the tab is hidden. Nothing else moves with
it: every score, average, level and trade idea comes from closed bars, and the UI
says so wherever the two sit side by side.

The design goal is a screen that answers, in under five seconds: *what's coming,
what just printed, who does it help, how much, and how sure are we?*

**Every score is reproducible from a config file.** The event detail page shows the
full arithmetic — `NFP −23K vs 80K forecast → −1.04σ × bullish polarity × HIGH
impact × 3.3 = −3.4` — before any AI text. The AI layer writes prose about numbers
that were already computed; delete it entirely and every score is unchanged.

---

## Quick start

```bash
npm install
cp .env.local.example .env.local   # optional — see below
npm run dev                        # http://localhost:3000
```

**It works with an empty `.env.local`.** Every data source needed for scoring is
free and keyless. Keys only add AI commentary, Telegram alerts, and durable storage.

```bash
npm test               # 440 scoring/alert/connector tests
npm run ingest:dry     # hit every live source, print a health table
npm run drill:fxstreet # verify the app degrades when the primary source dies
npm run check:supabase # verify Supabase credentials, schema and write access
npm run fixtures       # refresh offline fixtures from live data
USE_FIXTURES=true npm run dev   # run fully offline on captured data
```

---

## Data sources

Every source below was probed live before being wired in.

| Source | Key | Role |
|---|---|---|
| **FXStreet calendar** | none¹ | Primary: calendar, actuals, forecast, `ratioDeviation` |
| ForexFactory (FairEconomy) | none | Schedule fallback if FXStreet dies |
| Yahoo Finance | none | Prices for FX, metals, WTI, DXY, indices and crypto; long-run daily bars for the seasonality scanners; the batched live quote |
| **FRED** `T10Y2Y` / `DGS10` | none | The US yield curve, same keyless CSV export as `DGS2` |
| RSS ×8 (BBC, CNBC, WSJ, Al Jazeera, Reuters, Fed, ECB, BoE) | none | News, geopolitics, corroboration |
| **CFTC Commitments of Traders** | none | COT positioning **and retail sentiment** |
| **TradingView calendar** | none | Conference Board consumer confidence — the one series no other free feed populates |
| **FRED** (graph CSV export) | none² | US 2-year Treasury yield, daily |
| **ECB Data Portal** | none | Euro-area AAA 2-year spot rate, daily |
| DBnomics | none | Policy rates |
| OpenAI *or* Ollama | optional | Plain-English commentary only |

¹ FXStreet requires a `Referer: https://www.fxstreet.com/` header — that header *is*
the auth mechanism, and the API returns 401 without it.

² The `fredgraph.csv` export, not `api.stlouisfed.org` — the JSON API needs a free key,
the CSV does not.

**Sources deliberately not used**, each ruled out by testing:

- **GDELT** — hard IP-throttled, returned 429 on every attempt across several minutes.
- **TradingEconomics guest API** — returns `410 Gone`; guest accounts were discontinued.
- **Stooq** — 404 on every symbol tried.
- **DBnomics for actuals** — its statistics mirrors lag badly (US CPI last observation
  was ~18 months old, euro HICP ~8 months). It would have produced confident-looking
  cross-checks against year-old data, so it is scoped to policy rates, which are current.

### The Top Setups scorecard

51 symbols scored across **18 indicators**, grouped into Technical / Sentiment / Growth /
Inflation / Jobs — exactly A1's column set, no more and no less. Cells are discrete
integers, summed into a total and a bias label.

Cells render as **words, not bare integers** — `+2 Very Bullish`, `-1 Bearish` —
against each column's own maximum, because the maxima are not uniform: trend and
COT span ±2 while seasonality and crowd span ±1, so "+2" means different things in
different columns. `maxCellFor(slotKey, kind)` in `config/setups.config.ts` is the
single definition, and `maxScoreForKind` is the sum of it, so a pill can never
claim a scale the total does not agree exists.

**Copper and USDZAR** close the last gaps against EdgeFinder's list. Copper is
industrial (`INDUSTRIAL_POLARITY`), and its CFTC contract is `COPPER- #1` — the
plain `COPPER` name also exists in the file and is a dead series whose last report
is from 1989, so picking it would have produced a silently 37-year-stale cell
rather than an error. ZAR lives in `MINOR_CURRENCIES` rather than `MAJORS`: the
pair table is a full cross product of that list, so adding it there would have
manufactured eight ZAR crosses nobody asked for.

The model follows A1 Trading's EdgeFinder. They publish per-metric rules one page at a
time under `a1trading.com/edgefinder/*`, but **the rules and the running product disagree
in three places**, and where they do, the product wins. The column set and the composition
rule are pinned against seven rows transcribed from a live Top Setups screenshot — every
one of them reconciles to the total they display, which is stronger evidence than any of
their prose:

| Column | Rule | Range (pair) |
|---|---|---|
| Trend | 3-day vs 14-day SMA. The **crossover is the score** (±2); the 14-day slope only docks a point when it disagrees | ±2 |
| Seasonality | Sign of the 10-year average for this calendar month | ±1 |
| COT | FX: weekly change in speculator **long share** (percentage points), per leg. Non-FX: that change **plus** net positioning | ±2 |
| Crowd | Retail long %, contrarian: ≥60% → −1, ≤40% → +1 | ±1 |
| GDP · **mPMI** · **sPMI** · Retail Sales · **Cnsmr Conf** · CPI · PPI · PCE · Employment · Unemployment · **Claims** · **ADP** · **JOLTS** | Ternary per leg vs forecast, base minus quote | ±2 each |
| Interest Rates | Market-implied policy direction | ±2 |

**Three places their docs are wrong about their own product**, each caught by reconciling
against the live table rather than by re-reading the prose:

- **Trend** is ±2, not ±3. Their page lists the slope as "+1 / −1" alongside the crossover
  "+2 / −2", which reads like an addition. It is not — the crossover is the score and the
  slope only subtracts when it disagrees. No row in their table exceeds ±2.
- **PMI scores against forecast**, despite the page saying "change from previous data to
  latest data". On one day's figures, forecast reproduces all four of their published PMI
  cells; previous reproduces two. ISM Services at 54.1 beat the 54.0 previous but missed
  the 54.5 forecast, and they score it as a miss.
- **Seasonality is ±1 everywhere**, despite the page promising ±2 for indices and
  commodities. GOLD and SILVER both show 1, and GOLD's stated total of 8 only reconciles
  at 1.
- **The 2-year yield uses a 21-day average**, not the 7 their interest-rates page implies.
  Their Asset Scorecard labels the row verbatim "2 Yr Yield (21 day SMA)".
- **Inflation has no level component.** Their page describes a second, level-based term
  for non-FX assets. Their GOLD card lists four inflation rows summing to +1; with a level
  term on CPI it would be +2. Documented, not shipped — so we do not ship it either.
- **The interest-rate column reads the central bank's OWN projection**, not a market
  proxy. The Fed's dot plot is in the feed as "Interest Rate Projections - Current" vs
  "- 1st year"; on 2026-06-17 it read 3.8% → 3.6%, i.e. cuts. No other major central bank
  publishes numbers, so every other currency scores 0 there — a 0 that means "no published
  forecast" rather than a guess.
- **Silver and platinum are havens, not industrial metals.** Their inflation page groups
  silver with oil and copper, but their SILVER row is identical to GOLD in every macro
  column, differing only on COT. Scoring silver as industrial flipped the sign on eight of
  its cells. Only oil stays demand-driven.

Their jobs column is headed **NFP** and is US-only: it contributes ±1 to a pair, never
±2, because there is only ever a US leg. The same is true of PCE, claims, ADP and JOLTS.

Series resolution picks the most recent **scoreable** print, not simply the most recent.
A release with an actual but no forecast cannot produce a beat or a miss, and taking it
anyway discarded an older print that could — measured on the live feed, that silently
halved GBPUSD's PPI cell and Australia's consumer-confidence leg.

**Consumer confidence needs a source of its own.** A1 uses the Conference Board index,
and neither calendar carries it: FXStreet schedules the release monthly but publishes
actual, forecast and previous as `null` every time, and ForexFactory has no actual field
at all (0 of 73 entries). `lib/connectors/conference-board.ts` fills the gap from
TradingView's calendar API — free, keyless, JSON, and range-queryable. It publishes under
the name the slot already prefers, so if FXStreet ever populates its own rows this
connector simply stops being needed.

**Which consensus you use decides the sign, so the source choice is the whole cell.** Every
source agrees the July 2026 print was 90.8; the forecast is where they part:

| source | forecast | reads as |
|---|---|---|
| ForexFactory | 92.4 | miss — what A1's card shows |
| TradingView | 92.3 | miss — what we use |
| MQL5 | 89.5 | **beat** — the opposite |

A first attempt used MQL5's CSV export and scored it a beat, costing two points on every
USD pair. TradingView carries the same consensus ForexFactory publishes, to a rounding
difference that cannot change a ternary.

Their COT "Latest Buys/Sells" reads the week-on-week change in the **long share**, not the
change in net contracts — two different measures that diverge whenever longs and shorts
grow together. Their JPY row reconciles it exactly: 43.31% this week against 27.67% last
week is the 15.64% "Net % Change" they display. Our CFTC source is confirmed identical to
theirs (legacy futures-only), matching that row digit for digit.

mPMI and sPMI are **two independent columns**, not one. On their EURUSD they point
opposite ways the same day (−2 and +2), which a merged column collapses to a single −1.

**No data or code of theirs is used** — nothing fetches from a1trading.com. Everything is
computed from free public sources with rules you can read and change in
`config/setups.config.ts`.

**Their bias bands are absolute, not a fraction of a maximum.** Bullish is ≥ +4 and Very
Bullish is ≥ +7, and those cuts never moved as they added columns. So there is no cap: a
EURUSD printing 14 is simply twice the Very Bullish floor.

Our maximum is **±34 for a currency pair and ±20 for a single-economy asset**, and that
gap is structural rather than an oversight: a pair DIFFERENCES two economies, so each
macro cell spans ±2, while gold or an index reads ONE and spans ±1. Each dial is drawn
against its own asset class — showing gold on an FX-sized scale is what once made a
perfectly strong +9 look like a rounding error. The column set is pinned by a test,
because with absolute bands, adding a scoring column silently redefines "Bullish".

**Fundamentals are ternary**: any beat is +1, any miss −1, exactly on forecast 0 —
regardless of magnitude. That is their model, and it is a deliberate trade-off: a 0.15σ
miss and a 3σ miss score identically. Sigma is still computed and shown in the detail
column, so the distinction is one hover away.

```
cell(pair, indicator) = clamp(score(base) − score(quote), −2, +2)
```

A missing leg counts as 0, which is why NZDUSD shows a value under Employment Change —
New Zealand publishes no payrolls, so the cell is the inverted US reading.

**Each currency is also a symbol in its own right** — EURX, GBPX and so on, priced
off the CME currency futures. They answer a different question from any pair: "is
this currency strong", not "is it stronger than that one". They read one economy
straight through, but take the FX COT rule of weekly change only, because a
currency index is still a currency. A1's EURO row settles that: EUR speculators
are 43.7% long (net positioning −1) against a +1.22% weekly change, and their cell
reads +1 — the change alone.

Symbols with no currency legs read one economy instead of differencing two, with a sign
that depends on the asset class: strong US growth lifts the S&P and weighs on gold, and
those are the same print. Silver, platinum and WTI are industrial rather than haven
assets, so unlike gold their growth reading is **not** inverted.

**Where we knowingly diverge.** PPI and PCE appear on their card with no published rule,
so they are scored as ordinary actual-vs-forecast reads — flagged as inferred in
`config/setups.config.ts`. And A1's gold *Core CPI* lines say both "HIGHER → −1" and
"LOWER → −1", which cannot both be true, so that sub-component is skipped rather than
guessed at. Everything else follows their published wording.

**Two subtleties that took measuring to get right:**

- **EUR must scope to the euro-area aggregate.** "Consumer Price Index (YoY)" tagged
  EUR is a *member state* print (DE, IT, ES…); the aggregate is "Harmonized Index of
  Consumer Prices (YoY)" under country `EMU`. Without the country filter the column
  shows whichever member state printed last.
- **Stale is not neutral.** A five-month-old GDP print and a print that landed exactly
  on forecast are both "0" if you only look at the number. Slots carry a `maxAgeDays`
  and render greyed when they exceed it.

### The economic heatmap reads every release twice

One release, two columns: **Currency Impact** and **Stocks Impact**. A cooler-than-forecast
CPI is bearish for the currency (less room to hike) and bullish for equities (cheaper
money) — a single impact column has to pick one and be wrong about the other half of the
market. Each column gets a bullish-share dial beneath it.

The **Surprise cell is coloured by the risk reading, not the arithmetic sign.** A US
unemployment beat prints as a negative number and is unambiguously good news; colouring
that red beside a Bullish badge was a real bug. A1's own convention is the same: "Blue =
positive surprise → risk-on sentiment".

Two smaller things the heatmap now gets right. The surprise is measured against whatever
the score actually used — **the previous print for PMI**, not the consensus, so the number
and the badge answer the same question. And indicators an economy never publishes are
dropped rather than listed blank: the euro area has no payrolls, JOLTS or PCE, and nine
empty rows read as broken data instead of a series that does not exist. Stale rows stay,
because "we had this and it aged out" is information.

### Seasonality scanners

Three granularities over one daily series — **month of year, week of year, day of
week** — at **1 / 5 / 10 year** lookbacks, which is the set and the windows A1
offers. Plus a cross-symbol scanner ranking every symbol by whichever bucket the
calendar is currently in.

Yahoo serves far more history than the ten years the score needs, but only via
explicit epoch bounds: `range=max&interval=1d` silently downgrades the interval
and returns 274 *monthly* bars for EURUSD while still claiming to be daily. The
`period1/period2` form returns the real thing, and the fetch is windowed to
eleven years — the deepest lookback plus one, because the first return in a window
needs the close before it. Seven-day cache, since closed history does not change.

**Only daily bars are fetched**; month, week and weekday buckets are all derived
from them. That is cheaper than three requests and more correct: Yahoo's own
monthly series has holes — it returned March twice and omitted October for
EURUSD — and a bucket built from dailies cannot inherit them.

**A gap is skipped, never bridged.** Two consecutive observations of a bucket type
form a return; a missing period does not silently become a two-month "monthly"
return. Adjacency is measured in DAYS for weeks and weekdays rather than by
bucket index, and that is load-bearing: the obvious `isoWeekYear * 53 + week`
arithmetic makes adjacent weeks differ by one only in a 53-week year, so an
index-based check dropped the December-to-January return in five years out of six
— always the same observation, always at the turn of the year when seasonality
claims are loudest.

**The score is unchanged by all of it.** The `seasonality` cell still reads the
sign of the 10-year monthly average, and the lookback buttons are a reading aid.
Bias bands here are absolute, so a cell that moved with a dropdown would quietly
redefine "Bullish" on every symbol. Buckets below `SEASONALITY_MIN_YEARS` are
drawn faded with an amber sample count rather than hidden — a large average on a
small `n` is one year of history wearing a decade's clothes.

This is the one source with **no captured fixture**: a decade of daily bars for 51
symbols is tens of megabytes. Offline mode returns nothing and the page says why,
so `USE_FIXTURES=true` still makes no outbound request.

### Crowd sentiment

EdgeFinder's Crowd Sentiment is retail broker positioning refreshed every 30
minutes, from a vendor they do not name. **There is no free, documented,
unblocked equivalent** — probed: Myfxbook's API needs an account and its terms ask
that anything built on it be free, IG and DailyFX return 403, FX Blue publishes no
JSON, and Dukascopy's SWFX endpoint is undocumented enough that wiring it means
shipping a scrape that breaks silently.

So the **Sentiment** page reads the CFTC's non-reportable positions, which is what
the `crowd` cell already scored. Genuinely small-trader money and genuinely
contrarian, but futures rather than spot, weekly rather than half-hourly, and
never less than three days old — all of which the page states rather than papers
over. Contracts where small traders hold fewer than 500 positions are omitted
entirely; a percentage off a handful of contracts is arithmetic, not a crowd.

The ±40/60 scoring bands are **drawn on each bar**, so a cell value is visibly a
consequence of where the bar sits rather than an assertion beside it. Alongside:
52 weeks of retail long share per contract, because "the crowd is at an extreme"
is a claim about history and cannot be made from one number; the 3-year
percentile, which does not vote; and crowd-versus-institutions, moved here from
Markets.

**Out of scope, recorded so it is not rediscovered:** A1 scores indices, metals
and crypto from an options **put/call ratio** (+2 / −1) rather than retail
positioning. No put/call source is wired, so those symbols keep the CFTC reading.

### Cross-market reads

The **Macro** page answers questions no single symbol can, all derived from data
the scorecard already fetched — none of it costs an extra request. It was
`/markets`, which still resolves as a redirect.

- **Risk on / risk off**, −6..+6 from VIX, S&P, gold, the 10-year, the dollar and
  the yen, each ±1 against its own 14-day average. VIX, gold and DXY are inverted,
  since they rise when capital runs for cover. **This is our rule set, not a
  reproduction** — A1 ships something similar but their page for it 404s, so
  encoding a second-hand description as their spec would have been dishonest.
- **Economic strength**, ranking the 8 majors on their own macro cells plus the
  **real yield** (policy rate − CPI). That last column is the one that explains
  flows the others cannot: 5% against 6% inflation is a negative real return.
- **Economic surprise index**, 0–100% of recent releases that beat forecast, read
  off the same `scoreSlot` results as the matrix so the two cannot disagree. An
  on-forecast print counts as half a beat rather than being dropped.
- **Policy and rates**, per currency: what the bank is doing, what it charges,
  what inflation does to that, and the market's own 2-year where one exists. Only
  USD and EUR have a real market reading; the other six read **assumed** and take
  their rate cell from the hand-maintained stance column, which is shown rather
  than smoothed over.
- **US yield curve**, the 10y−2y inversion signal. The spread is FRED's own
  `T10Y2Y` series, **not the two levels subtracted** — FRED publishes each on its
  own schedule, and measured today the levels were three days behind the spread,
  so deriving it from the legs reports a stale curve as current. Keyless, via the
  same graph CSV export the 2-year already uses.
- **Carry scanner**, base policy rate − quote rate. A pair with a missing rate is
  omitted rather than assumed zero — treating an unknown rate as 0% would
  manufacture the biggest carry in the table out of missing data.

Smart money moved to **Sentiment**, next to the crowd bars it is read against.

### Score history

`/api/ingest` writes one snapshot per symbol per run to `score_snapshots`. This is
**the only thing the app stores that it cannot recompute**: the free feeds publish
current technicals and the latest COT report with no history, so a snapshot missed
is gone.

Two deliberate guards. Rows where nothing scored are skipped, so a total outage does
not draw a flat neutral line that looks like the market having no view. And the
timestamp is truncated to the minute, so an overlapping cron run overwrites rather
than drawing a spike.

Needs Supabase. Without it the writes go to memory and vanish between requests —
the history page says which of those is the problem rather than showing an empty
chart.

### Live prices, and the line they do not cross

`v7/finance/quote` now returns `Unauthorized` and `v6` is a 404, so a batched
quote looked impossible and fifty single-symbol chart calls is how you get thrown
off an undocumented endpoint. **`v7/finance/spark` still answers** — a
comma-separated symbol list returning the same `meta` + close-series shape the
chart endpoint does, which means the existing `pickPreviousClose` works on it
unchanged. **Hard limit of 20 symbols per call**: 21 is an HTTP 400, not a
truncated list, so the chunking is load-bearing rather than tidiness.

`range=5d`, not `1d`, for the same reason the single-symbol path uses it: a
one-day range has nothing to compare against over a weekend, and
`meta.chartPreviousClose` is a trap — on GC=F it was four sessions old, which
renders a +1.4% day as +9%.

One poll loop per **symbol set**, not per component. The scorecard has two
consumers of the same price — the header and the price-statistics panel — so a
per-component loop issued two requests every tick, four on mount under
StrictMode, and could render two different prices for a frame. The loop lives in
a module-level store keyed by the sorted symbol list; N consumers cost one
request and see one number. It pauses while the tab is hidden and stops after
three consecutive failures rather than retrying into a 429.

**The line:** a live tick moves the displayed price and its day change, and
nothing else. Every score, moving average, structure level and trade idea comes
from bars that have closed. The one thing that does update is which *side* of an
average the price is on, because that is the reason to look at the panel
intraday — and the panel says so.

Prices are formatted by magnitude (`formatPrice`), not by `toLocaleString`, which
caps at three fraction digits and was rendering EURUSD's `1.15550` as `1.156`.

### Trade ideas

Entry band, stop and target on the scorecard, sized from the 90-day average daily
move: entry ±0.5×, stop 1.5×, target at 2:1. Absent entirely below ±4 rather than
greyed out, because a disabled box still puts the idea of a trade on screen for a
symbol with no directional signal. These are volatility arithmetic with no
awareness of support, liquidity or the calendar, and the UI says so.

### Reading the COT page

Contracts are shown by ticker — CAD, CHF, BTC, USOil — rather than by their CFTC
names. That is not only cosmetic: on the positioning chart the label sets each bar's
minimum width, so "NIKKEI STOCK AVERAGE YEN DENOM" grew its own column five times
wider than GOLD's and the chart read as though it mattered five times more. Bars are
now a fixed width and the full contract name lives in the hover.

The weekly filing table shows **Δ Long and Δ Short separately**, not just the net.
Net rising because longs piled in is a different market from net rising because
shorts covered, and a single net column hides which it was.

### COT and crowd sentiment — both free

EdgeFinder's "Crowd Sentiment" normally needs a paid broker feed. It doesn't have to:
the CFTC's **non-reportable** positions are small-trader money, published in the same
free weekly file as the institutional data.

- **COT** — for a currency leg, only the week-on-week change in speculator long share.
  For gold, indices and crypto, that change **plus** net positioning from the long share
  (>55% → +1, <45% → −1). The asymmetry is A1's: scoring positioning on both legs of a
  pair double-counts a signal they read once.
- **Crowd** — retail long %, **inverted**, because crowd positioning is contrarian.
  ≥60% long → −1, ≤40% → +1, and a deliberately wide neutral band between.

The 3-year **percentile is still computed and displayed** even though it does not drive
the score. It is the more revealing measure: gold's 197,634 net long looks overwhelming
until you see it is only the 39th percentile of its own history — below its 3-year median.
Both matter; only one votes.

**DAX and FTSE have no COT columns at all.** They trade on Eurex and ICE Europe, outside
the CFTC's remit, so no Commitments of Traders report exists for them at any price. Those
two cells are blank by construction, not by oversight.

COT is surveyed Tuesday and published Friday, so it **always lags by at least 3 days**.
The report date is displayed next to every panel that uses it.

### Where `actual` values come from

No free feed publishes a number the instant it hits the wire, so there is a chain:

| Order | Source | Latency | Confidence |
|---|---|---|---|
| 1 | **Manual entry** — inline field on any event | instant | 95 |
| 2 | **FXStreet** | release-time | 90 |
| 3 | DBnomics cross-check | hours | 80 |

A manual value outranks every feed and rescores immediately. If a feed later
disagrees, the conflict is **surfaced in the UI, never silently overwritten**.

---

## How the news engine scores

Distinct from the scorecard above, and no longer displayed as a competing score on a
symbol. This continuous engine ranks **news severity and alerts** — it decides what is
worth a Telegram message. The scorecard is the single number for "is this bullish".

All of it lives in `config/scoring.config.ts`. Change it there, not in the engine.

```
score = surprise × polarity × impact × regime × weight × 3.3   → clamped to ±10
```

1. **Surprise** — FXStreet's `ratioDeviation` when available, since it is calibrated
   against that series' own history. Live example of why that matters: NFP missing by
   103K is −1.04σ, while average hourly earnings missing by 0.2pp is −2.67σ. A fixed
   divisor per event type would rank those backwards.
2. **Polarity** — `+1` where higher is bullish (CPI, GDP, PMI, payrolls), `−1` where
   higher is bearish (unemployment, jobless claims). This is *bullish for the currency*,
   not *good for the economy* — hot inflation is both bad news and a bullish signal.
3. **Impact** — HIGH 1.0 / MEDIUM 0.6 / LOW 0.3.
4. **Regime** — `CURRENCY_REGIME` marks each central bank as hiking/cutting/neutral.
   Under `cutting`, an inflation beat only delays cuts rather than pulling a hike
   forward, so it scores at 0.6×. **This is a hand-maintained assumption — review it
   when a central bank pivots.**
5. **Confidence (0–100)** — starts from the source, then penalties: no forecast (−30),
   source disagrees with our polarity (−25), unclassified event (−20), −1/hour staleness.
   **Below 40 the UI shows "uncertain" instead of a direction.**

**Currency strength** is a recency- and confidence-weighted *mean* (not a sum, so many
small prints cannot outrank one decisive release). **Pair score** = base − quote, with
confidence taken from the *weaker* leg.

**Metals and oil** are scored from named factors in `config/assets.config.ts`, e.g.
`XAU = 0.6×(−USD) + 0.8×riskOff + 0.7×geopolitics + 0.35×inflation`. Each term renders
as a labelled row, so a gold move is always attributable.

### News and corroboration

Headlines are clustered by similarity, and corroboration counts **distinct domains,
not articles** — one outlet republishing itself five times is still one source. A story
needs 3 independent domains to be marked corroborated. Uncorroborated stories are
capped at `medium` severity however alarming the wording, and are labelled
`SINGLE UNVERIFIED SOURCE` in both the UI and Telegram.

---

## Alerts

Fire on: high-impact releases within 30 minutes, surprises beyond 1.5σ, geopolitical
and central-bank news, and clusters of aligned releases on one currency.

Deduped by content hash in `alert_log`, which is what stops the 10-minute cron
re-sending the same alert forever. Hashes are stable across runs but change when a
value is revised, so a genuine revision does re-alert.

A surprise alert requires a forecast. Without one there is nothing to be surprised
*against*, and `"54.1 vs n/a forecast, −1.5σ"` is not worth a phone buzz.

**Telegram setup** (optional): message `@BotFather` → `/newbot` → copy the token into
`TELEGRAM_BOT_TOKEN`. Message your bot once, then open
`https://api.telegram.org/bot<TOKEN>/getUpdates` and copy the numeric `chat.id`.

---

## Deploying free

### 1. Supabase (required in production)

Create a free project, run `lib/db/schema.sql` in the SQL editor, then:

> **Re-run the schema after pulling.** `score_snapshots` was added for score
> history; an existing project without it silently records nothing.
> `npm run check:supabase` lists exactly which tables are missing.


- `SUPABASE_URL` — **Settings → Data API → Project URL** (`https://<ref>.supabase.co`).
  This is *not* the dashboard URL you see in the browser bar.
- `SUPABASE_SERVICE_KEY` — **Settings → API Keys → Secret keys**, reveal `default`
  and copy the `sb_secret_…` value. The `sb_publishable_…` key above it cannot write.
  (Older projects instead show a `service_role` JWT under the *Legacy* tab; either works.)

Verify with `npm run check:supabase`, which tests credentials, schema and write access
separately so a failure tells you which one is wrong.

Without it the app falls back to in-memory storage. That is fine locally, but on
Vercel each serverless invocation has its own memory, so **alert dedupe cannot work
and alerts will repeat**. `/api/ingest` reports this as `alertDedupeReliable: false`.

### 2. Vercel

```bash
npx vercel
```

Add every var from `.env.local.example` in Project Settings → Environment Variables.
Generate `CRON_SECRET` with `openssl rand -hex 32` — without it `/api/ingest` is
publicly triggerable against your quotas.

### 3. GitHub Actions cron

Vercel Hobby only allows cron **once per day**, which is useless for news alerts.
`.github/workflows/ingest.yml` runs every 10 minutes instead, for free. Add two repo
secrets:

- `INGEST_URL` → `https://<your-app>.vercel.app/api/ingest`
- `CRON_SECRET` → same value as in Vercel

Then trigger it manually once from the Actions tab to confirm the wiring.

---

## Resilience

A dashboard that 500s because one RSS feed is down is worse than useless.

- Connectors return `Result<T>` and **never throw**. One dead source degrades a panel.
- **Stale-while-error**: the last good payload is served for up to 6 hours when an
  upstream fails, labelled with its age rather than shown as fresh.
- **Rate limits are respected, not retried.** 429 is excluded from retry and triggers a
  cooldown honouring `Retry-After`. FairEconomy was observed returning
  `429 retry-after: 130` during development; retrying through that is what turns a
  brief throttle into a sustained block.
- Source health is always visible in the header.
- `npm run drill:fxstreet` simulates the primary source dying and asserts the app
  degrades to the fallback schedule instead of going blank.

---

## Project layout

```
app/            / (Top Setups) · /scorecard · /scorecard/[symbol]
                /seasonality · /sentiment · /macro (/markets redirects here)
                /history/[symbol] · /chart · /heatmap · /cot · /charts · /news
                /event/[id] · /api/{setups,quotes,ingest,dashboard,actual,ai}
components/     SetupsMatrix, Sidebar, CotPanel, EconomicHeatmap, IndicatorChart,
                SeasonalityScanner, SeasonalityStrip, SentimentPanel,
                ScorecardIndex, ScorecardHeader, PriceStatistics,
                PriceChart, ChartWorkspace, ScoreHistoryChart,
                Gauge, CurrencyHeatmap, EventCard, AssetPanel, AlertPanel
                ui.tsx — Panel, BiasPill/cellBias, formatPrice, colour tokens
config/         setups.config.ts · symbols.config.ts   <- scorecard tuning
                scoring.config.ts · assets.config.ts · sources.config.ts
lib/
  connectors/   base.ts (retry, cooldown, stale cache) + one file per source
                cftc.ts (COT) · technicals.ts (SMA, seasonality, vol,
                  long-run bars for the scanners)
                prices.ts (fetchSparkQuotes — the batched live quote)
                yields.ts (2y sovereign yields + the US curve: FRED + ECB, keyless)
  hooks/        useLiveQuotes — one shared poll loop per symbol set
  scoring/      surprise · currency · news · assets · discrete · setups · cot ·
                technical · seasonality · sentiment · asset-class · rates ·
                inflation · market · history · trade-ideas · heatmap ·
                indicator-history — pure, clock injected, no I/O
  alerts/       rules · telegram
  ai/           provider (OpenAI + Ollama) · prompts
  db/           schema.sql · client (Supabase + in-memory fallback)
  pipeline.ts   ingest → score → alert, used by both cron and dashboard
fixtures/       real captured payloads, powering USE_FIXTURES=true
scripts/        ingest-dry · drill-fxstreet-down · capture-fixtures
```

---

## Known limitations

- **FXStreet and Yahoo are undocumented endpoints.** Both have fallbacks and neither
  can corrupt a score — prices are context only and never a scoring input — but either
  could change without notice. `npm run ingest:dry` is the fastest way to check.
- **The FairEconomy fallback only serves the current week**, so late in the week it
  returns few upcoming events. It is a safety net, not a replacement.
- **`CURRENCY_REGIME` is a manual assumption** and will drift as central banks pivot.
- Currency tagging on news is keyword-based and will occasionally mis-attribute.
- **Indicator history is limited to 150 days** (~5 monthly prints). Longer charts need
  the calendar backfilled into Postgres, which is worth doing once Supabase is set up.
- Coverage gaps are real: Switzerland publishes no manufacturing PMI here, Canada no
  consumer confidence, and PCE/claims/ADP/JOLTS are US-only by construction.
- Consumer confidence for USD resolves to the **Michigan** sentiment index. EdgeFinder
  uses the Conference Board series, which has no released values in this feed. It is a
  context column, so this does not affect any score.
- **The interest-rate column has a market reading for USD and EUR only.** FRED and the
  ECB Data Portal both publish a keyless daily 2-year; no equivalent exists free for
  GBP, JPY, CAD, AUD, NZD or CHF, and the OECD monthly mirrors run ~2 months behind.
  Those six fall back to `CURRENCY_REGIME` and **say so in the cell**, so a
  hand-maintained assumption is never mistaken for a market signal.
- **Crowd sentiment is CFTC small-trader futures money, not a broker feed.** It is
  the closest free stand-in for what EdgeFinder shows, and it is weekly and at
  least three days old where theirs is half-hourly and spot. The Sentiment page
  states this rather than implying parity.
- **Seasonality has no offline fixture.** A decade of daily bars for 51 symbols is
  tens of megabytes, so that one tab is empty under `USE_FIXTURES=true` and says
  why. A cold online load can also lose symbols to Yahoo throttling; the page
  counts how many rather than showing a quietly short ranking.
- **South Africa's calendar coverage is partial.** CPI, PPI, retail sales, GDP,
  unemployment and manufacturing publish; payrolls, PCE, claims, ADP, JOLTS and
  the PMIs do not, so several USDZAR cells inherit the inverted US reading through
  the missing leg. That is the existing missing-leg rule working, not a gap.
- **Indices, metals and crypto use the CFTC crowd reading, not a put/call ratio.**
  A1 scores those from options flow (+2 / −1). No free put/call source is wired.
- Single-user by design: no auth beyond a shared cron secret, no multi-tenancy.

Not financial advice.
