# FX Intel

A personal forex news intelligence dashboard. It ingests economic releases, market
news and geopolitical headlines, then turns them into an **explainable**
bullish/bearish score per currency, per pair, and for gold, silver, platinum and WTI.

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
npm test               # 78 scoring/alert/connector tests
npm run ingest:dry     # hit every live source, print a health table
npm run drill:fxstreet # verify the app degrades when the primary source dies
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
| Yahoo Finance | none | Prices for gold, silver, platinum, WTI, FX, DXY |
| RSS ×8 (BBC, CNBC, WSJ, Al Jazeera, Reuters, Fed, ECB, BoE) | none | News, geopolitics, corroboration |
| DBnomics | none | Policy rates |
| OpenAI *or* Ollama | optional | Plain-English commentary only |

¹ FXStreet requires a `Referer: https://www.fxstreet.com/` header — that header *is*
the auth mechanism, and the API returns 401 without it.

**Sources deliberately not used**, each ruled out by testing:

- **GDELT** — hard IP-throttled, returned 429 on every attempt across several minutes.
- **TradingEconomics guest API** — returns `410 Gone`; guest accounts were discontinued.
- **Stooq** — 404 on every symbol tried.
- **DBnomics for actuals** — its statistics mirrors lag badly (US CPI last observation
  was ~18 months old, euro HICP ~8 months). It would have produced confident-looking
  cross-checks against year-old data, so it is scoped to policy rates, which are current.

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

## How scoring works

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

Create a free project, run `lib/db/schema.sql` in the SQL editor, then copy the URL
and **service_role** key into your env vars.

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
app/            routes — dashboard, event detail, /api/{ingest,dashboard,actual,ai}
components/     Gauge, CurrencyHeatmap, EventCard, AssetPanel, AlertPanel, ActualInput
config/         scoring.config.ts · assets.config.ts · sources.config.ts   <- tuning lives here
lib/
  connectors/   base.ts (retry, cooldown, stale cache) + one file per source
  scoring/      surprise · currency · news · assets  — pure, clock injected, no I/O
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
- Single-user by design: no auth beyond a shared cron secret, no multi-tenancy.

Not financial advice.
