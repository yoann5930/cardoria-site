/**
 * Comparateur de prix multi-sources + Cardoria Global Index.
 */
import { getDb } from "../engine/database.js";
import { getCardById } from "../engine/cards.js";
import { getPriceSources } from "../engine/pricing.js";

const SOURCE_KEYS = ["cardmarket", "ebay", "pricecharting", "tcgplayer", "psa"];

const SOURCE_MULTIPLIERS = {
  cardmarket: 1.0,
  ebay: 1.06,
  pricecharting: 0.94,
  tcgplayer: 1.02,
  psa: 1.38
};

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function sourcePriceFromRow(sources, key) {
  const row = sources.find((s) => String(s.source).toLowerCase() === key);
  return row?.price != null ? Number(row.price) : null;
}

function isGradedPsa(card, detection) {
  const blob = `${card?.name || ""} ${card?.rarity || ""} ${detection?.version || ""} ${detection?.notes || ""}`.toLowerCase();
  return /psa\s*(10|9\.5|9|8|7)|gem\s*mint|graded/.test(blob);
}

export function computePriceComparison(cardId, { detection = null, persist = true } = {}) {
  const card = getCardById(cardId);
  if (!card) return null;

  const sources = getPriceSources(cardId);
  const base = card.recommendedPrice || card.avgPrice || card.lowPrice || 10;
  const graded = isGradedPsa(card, detection);

  const prices = {};
  const meta = {};

  SOURCE_KEYS.forEach((key) => {
    const stored = sourcePriceFromRow(sources, key);
    if (stored != null) {
      prices[key] = round2(stored);
      meta[key] = "live";
    } else if (key === "psa") {
      prices[key] = graded ? round2(base * SOURCE_MULTIPLIERS.psa) : null;
      meta[key] = graded ? "estimated_graded" : "n/a";
    } else {
      prices[key] = round2(base * SOURCE_MULTIPLIERS[key]);
      meta[key] = "estimated";
    }
  });

  const valid = Object.values(prices).filter((p) => p != null && p > 0);
  const worldAverage = valid.length
    ? round2(valid.reduce((a, b) => a + b, 0) / valid.length)
    : round2(base);

  const spread = valid.length >= 2
    ? (Math.max(...valid) - Math.min(...valid)) / worldAverage
    : 0.08;

  const trendBoost = clamp((card.trendPercent || 0) * 0.4, -8, 12);
  const liquidity = clamp((card.views || 0) / 50, 0, 15);
  const globalIndex = clamp(Math.round(50 + trendBoost + liquidity - spread * 30), 0, 100);

  const payload = {
    cardId,
    currency: "EUR",
    prices: {
      cardmarket: prices.cardmarket,
      ebay: prices.ebay,
      pricecharting: prices.pricecharting,
      tcgplayer: prices.tcgplayer,
      psa: prices.psa,
      worldAverage
    },
    globalIndex: {
      score: globalIndex,
      label: globalIndexLabel(globalIndex),
      spreadPercent: round2(spread * 100)
    },
    sourcesMeta: meta,
    computedAt: new Date().toISOString()
  };

  if (persist) {
    getDb().prepare(`
      INSERT INTO ultimate_price_cache (
        card_id, cardmarket, ebay, pricecharting, tcgplayer, psa, world_average, global_index,
        sources_json, computed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(card_id) DO UPDATE SET
        cardmarket = excluded.cardmarket, ebay = excluded.ebay, pricecharting = excluded.pricecharting,
        tcgplayer = excluded.tcgplayer, psa = excluded.psa, world_average = excluded.world_average,
        global_index = excluded.global_index, sources_json = excluded.sources_json, computed_at = excluded.computed_at
    `).run(
      cardId,
      prices.cardmarket, prices.ebay, prices.pricecharting, prices.tcgplayer, prices.psa,
      worldAverage, globalIndex, JSON.stringify(meta), payload.computedAt
    );
  }

  return payload;
}

function globalIndexLabel(score) {
  if (score >= 80) return "Marché mondial très dynamique";
  if (score >= 65) return "Marché mondial favorable";
  if (score >= 50) return "Marché mondial équilibré";
  if (score >= 35) return "Marché mondial calme";
  return "Marché mondial faible";
}

export function getPriceComparison(cardId) {
  const cached = getDb().prepare("SELECT * FROM ultimate_price_cache WHERE card_id = ?").get(cardId);
  if (cached) {
    const age = Date.now() - new Date(cached.computed_at).getTime();
    if (age < 3600000) {
      return {
        cardId,
        currency: cached.currency || "EUR",
        prices: {
          cardmarket: cached.cardmarket,
          ebay: cached.ebay,
          pricecharting: cached.pricecharting,
          tcgplayer: cached.tcgplayer,
          psa: cached.psa,
          worldAverage: cached.world_average
        },
        globalIndex: { score: cached.global_index, label: globalIndexLabel(cached.global_index) },
        sourcesMeta: JSON.parse(cached.sources_json || "{}"),
        computedAt: cached.computed_at,
        cached: true
      };
    }
  }
  return computePriceComparison(cardId);
}
