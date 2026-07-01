/**
 * Moteur Cardoria Trend — exploding, falling, undervalued, overvalued, rare_popular.
 */
import { getDb } from "../engine/database.js";
import { getCardById } from "../engine/cards.js";

const SIGNAL_TYPES = ["exploding", "falling", "undervalued", "overvalued", "rare_popular"];

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function computeCardoriaTrendIndex(cardId) {
  const db = getDb();
  const stats = db.prepare("SELECT * FROM market_card_stats WHERE card_id = ?").get(cardId);
  const history = db.prepare(`
    SELECT price_market, price_sell_advised, views_count, favorites_count, created_at
    FROM ai_enterprise_history WHERE card_id = ? ORDER BY created_at DESC LIMIT 30
  `).all(cardId);

  const card = getCardById(cardId);
  const trendPct = stats?.evolution_30d ?? card?.trend_percent ?? 0;
  const viewsDelta = history.length >= 2 ? (history[0].views_count - history[history.length - 1].views_count) : 0;
  const favDelta = history.length >= 2 ? (history[0].favorites_count - history[history.length - 1].favorites_count) : 0;

  const score = clamp(
    50 + trendPct * 1.5 + viewsDelta * 0.05 + favDelta * 2 + (stats?.volume ?? card?.sales_count ?? 0) * 0.3,
    0,
    100
  );

  return { cardId, cardoriaTrendScore: round2(score), trendPercent: trendPct, cardName: card?.name };
}

export function detectTrendSignals(limit = 200) {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare("DELETE FROM ai_enterprise_trend_signals WHERE computed_at < datetime('now', '-3 days')").run();

  const cards = db.prepare(`
    SELECT DISTINCT h.card_id, h.license_slug, h.extension
    FROM ai_enterprise_history h
    WHERE h.card_id IS NOT NULL
    ORDER BY h.created_at DESC LIMIT ?
  `).all(limit);

  const signals = [];
  const globalTrendScores = [];

  for (const c of cards) {
    const { cardId, cardoriaTrendScore, trendPercent } = computeCardoriaTrendIndex(c.card_id);
    globalTrendScores.push(cardoriaTrendScore);

    const stats = db.prepare("SELECT avg_price, min_price, max_price FROM market_card_stats WHERE card_id = ?").get(cardId);
    const hist = db.prepare(`
      SELECT price_sell_advised, price_actual_sell FROM ai_enterprise_history
      WHERE card_id = ? AND price_actual_sell > 0 ORDER BY created_at DESC LIMIT 5
    `).all(cardId);

    const card = getCardById(cardId);
    const advised = hist[0]?.price_sell_advised ?? stats?.avg_price ?? 0;
    const actual = hist[0]?.price_actual_sell ?? stats?.avg_price ?? 0;
    const rarity = card?.rarity || "";

    const types = [];
    if (trendPercent >= 12) types.push({ type: "exploding", change: trendPercent, label: "Explosion de prix" });
    if (trendPercent <= -12) types.push({ type: "falling", change: trendPercent, label: "Chute du marché" });
    if (actual > 0 && advised > 0 && actual > advised * 1.12) {
      types.push({ type: "undervalued", change: round2(((actual - advised) / advised) * 100), label: "Sous-évaluée" });
    }
    if (actual > 0 && advised > 0 && actual < advised * 0.88) {
      types.push({ type: "overvalued", change: round2(((actual - advised) / advised) * 100), label: "Surévaluée" });
    }
    if (/secret|rare|ultra|gold/i.test(rarity) && cardoriaTrendScore >= 65) {
      types.push({ type: "rare_popular", change: cardoriaTrendScore - 50, label: "Rare en vogue" });
    }

    for (const t of types) {
      db.prepare(`
        INSERT INTO ai_enterprise_trend_signals (
          card_id, license_slug, extension, signal_type, cardoria_trend_score, change_percent, label, computed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(cardId, c.license_slug, c.extension, t.type, cardoriaTrendScore, t.change, t.label, now);

      const cardName = card?.name || cardId;
      signals.push({
        cardId,
        cardName,
        license: c.license_slug,
        extension: c.extension,
        signalType: t.type,
        cardoriaTrendScore,
        changePercent: t.change,
        label: t.label
      });
    }
  }

  const cardoriaTrendIndex = globalTrendScores.length
    ? round2(globalTrendScores.reduce((a, b) => a + b, 0) / globalTrendScores.length)
    : 50;

  return { cardoriaTrendIndex, signals, computedAt: now };
}

export function getTrendSignals({ type, limit = 30 } = {}) {
  const db = getDb();
  let sql = `
    SELECT s.*, c.name AS card_name FROM ai_enterprise_trend_signals s
    LEFT JOIN cards c ON c.id = s.card_id WHERE 1=1
  `;
  const params = [];
  if (type && SIGNAL_TYPES.includes(type)) {
    sql += " AND s.signal_type = ?";
    params.push(type);
  }
  sql += " ORDER BY s.computed_at DESC, s.cardoria_trend_score DESC LIMIT ?";
  params.push(limit);

  return db.prepare(sql).all(...params).map((r) => ({
    cardId: r.card_id,
    cardName: r.card_name || r.card_id,
    license: r.license_slug,
    extension: r.extension,
    signalType: r.signal_type,
    cardoriaTrendScore: r.cardoria_trend_score,
    changePercent: r.change_percent,
    label: r.label,
    computedAt: r.computed_at
  }));
}

export function getCardoriaTrendIndex() {
  const db = getDb();
  const row = db.prepare(`
    SELECT AVG(cardoria_trend_score) AS avg_score, MAX(computed_at) AS computed_at
    FROM ai_enterprise_trend_signals WHERE computed_at >= datetime('now', '-1 day')
  `).get();
  return {
    cardoriaTrendIndex: round2(row?.avg_score ?? 50),
    computedAt: row?.computed_at || new Date().toISOString()
  };
}
