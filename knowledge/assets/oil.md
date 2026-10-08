---
title: Crude oil (WTIUSD)
asOf: 2026-10-03
sources:
  - https://www.eia.gov/finance/markets/crudeoil/
  - https://www.eia.gov/energyexplained/us-energy-facts/imports-and-exports.php
  - internal: config/symbols.config.ts (WTI reads demand, not haven)
---

# Crude oil (WTI)

## How the board reads it
WTI reads the **US economy with growth taken straight**: strong data means more demand for oil, which is bullish. Unlike gold, its growth cells are **not** inverted. (internal: symbols config)

## What drives the price
The EIA names seven drivers of crude prices:
- spot prices;
- **OPEC supply**;
- **non-OPEC supply**;
- the **supply–demand balance and inventories**;
- **financial markets**;
- **non-OECD demand**;
- **OECD demand**.

(EIA, "What drives crude oil prices")

## The US position
The US is a **net total energy exporter (since 2019)** but still a **net importer of crude oil**; it exports refined products. (EIA)

## Channels (background)
1. **Supply decisions.** OPEC+ meetings and production quotas. Headlines about them belong in the news section of the dossier.
2. **Geopolitics in producing regions.** Supply-risk premia can spike prices without any change in demand.
3. **Global growth**, China above all. Weak PMIs weigh on prices.
4. **Inventories.** The weekly US EIA petroleum status report, if it appears in the calendar.
5. **The dollar.** Oil is priced in dollars.

## Cross-market links
Higher oil helps CAD, is mixed for USD, and hurts the terms of trade of EUR and JPY. Brent (BZ=F) in the cross-asset section is the global benchmark; WTI is the US one.
