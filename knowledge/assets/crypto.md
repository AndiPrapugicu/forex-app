---
title: Crypto (BTCUSD, ETHUSD)
asOf: 2026-10-03
sources:
  - internal: config/symbols.config.ts (crypto reads the US economy)
---

# Crypto

## How the board reads it
Bitcoin and Ether read the **US economy**, like other dollar-priced risk assets. COT comes from CME futures, the only regulated venue the CFTC reports on. (internal: symbols config)

## Channels (background — general market structure)
1. **Liquidity and real yields.** Crypto has traded as a high-beta risk asset. Easier financial conditions and falling real yields have tended to help it.
2. **Risk appetite.** The Nasdaq and the VIX in the cross-asset section.
3. **Flows into regulated products**, such as spot ETFs, and regulatory news. None of this is in our data feeds, so use only what the headlines say, and label it.
4. **Idiosyncratic events**: exchange failures, hacks, protocol upgrades. These can dominate macro entirely. Name them when they appear in the news.

## A caution
The macro board explains less of crypto than of currencies. Weight positioning and news more heavily here, and say that the macro cells are a weak guide for this asset.
