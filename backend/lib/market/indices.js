/**
 * Indices marché Cardoria — liquidité, demande, rareté.
 */
const RARITY_PATTERNS = [
  { pattern: /secret|illustration rare|alternate|gold|prismatic|1st edition|first edition|special/i, score: 92 },
  { pattern: /ultra rare|super rare|legendary|hyper rare|special illustration|leader|chase|grail/i, score: 78 },
  { pattern: /holo rare|rare holo|double rare|promo|full art|vmax|vstar|ex\b|gx\b/i, score: 62 },
  { pattern: /uncommon|peu commune/i, score: 38 },
  { pattern: /common|commune|base|standard/i, score: 22 }
];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function parseRarityScore(rarityText = "") {
  const text = String(rarityText || "");
  for (const rule of RARITY_PATTERNS) {
    if (rule.pattern.test(text)) return rule.score;
  }
  return text ? 50 : 40;
}

export function computeIndicesFromStats({
  card = {},
  volume = 0,
  avgPrice = 0,
  evolution30 = 0,
  evolution90 = 0,
  avgDaysToSell = null,
  buybackVolume = 0
}) {
  let liquidity = 40;
  liquidity += clamp(volume * 3, 0, 30);
  liquidity += clamp((30 - (avgDaysToSell ?? 45)) * 0.4, -15, 15);
  if (evolution30 > 0) liquidity += clamp(evolution30 * 0.3, 0, 10);
  if (evolution30 < 0) liquidity -= clamp(Math.abs(evolution30) * 0.25, 0, 12);
  if (avgPrice > 500) liquidity -= 8;
  liquidity = clamp(Math.round(liquidity), 0, 100);

  let demand = 35;
  demand += clamp(volume * 4, 0, 35);
  demand += clamp(evolution30 * 0.35, -12, 12);
  demand += clamp(evolution90 * 0.2, -8, 8);
  demand += clamp(buybackVolume * 2, 0, 10);
  demand += clamp((card.views || 0) / 40, 0, 10);
  demand = clamp(Math.round(demand), 0, 100);

  let rarity = parseRarityScore(card.rarity);
  if (avgPrice >= 200) rarity = clamp(rarity + 8, 0, 100);
  if (avgPrice >= 800) rarity = clamp(rarity + 10, 0, 100);
  if (volume <= 2 && avgPrice >= 80) rarity = clamp(rarity + 5, 0, 100);

  return {
    liquidity,
    demand,
    rarity: clamp(Math.round(rarity), 0, 100)
  };
}
