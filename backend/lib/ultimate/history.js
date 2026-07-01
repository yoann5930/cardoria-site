/**
 * Historique complet interactif — 7j à maximum disponible.
 */
import { getDb } from "../engine/database.js";
import { getCardById } from "../engine/cards.js";
import { ensureAiPriceHistoryTable } from "../ai/migrate.js";

const PERIODS = {
  "7": 7,
  "30": 30,
  "90": 90,
  "180": 180,
  "365": 365,
  "1095": 1095,
  "1825": 1825,
  max: null
};

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export function getUltimateHistory(cardId, periodKey = "30", { refresh = false } = {}) {
  if (!cardId) return { points: [], period: periodKey };

  if (!refresh) {
    const cached = getDb().prepare(`
      SELECT points_json, computed_at FROM ultimate_history_cache WHERE card_id = ? AND period_key = ?
    `).get(cardId, periodKey);
    if (cached) {
      const age = Date.now() - new Date(cached.computed_at).getTime();
      if (age < 7200000) {
        return {
          cardId,
          period: periodKey,
          points: JSON.parse(cached.points_json || "[]"),
          computedAt: cached.computed_at,
          cached: true
        };
      }
    }
  }

  const points = buildHistoryPoints(cardId, periodKey);
  const now = new Date().toISOString();

  getDb().prepare(`
    INSERT INTO ultimate_history_cache (card_id, period_key, points_json, computed_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(card_id, period_key) DO UPDATE SET
      points_json = excluded.points_json, computed_at = excluded.computed_at
  `).run(cardId, periodKey, JSON.stringify(points), now);

  return { cardId, period: periodKey, points, computedAt: now };
}

function buildHistoryPoints(cardId, periodKey) {
  const db = getDb();
  ensureAiPriceHistoryTable(db);
  const days = PERIODS[periodKey];
  const since = days
    ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
    : "1970-01-01";

  const aiRows = db.prepare(`
    SELECT recorded_at AS date, price_recommended AS price, 'cardoria' AS source
    FROM ai_price_history WHERE card_id = ? AND recorded_at >= ? ORDER BY recorded_at ASC
  `).all(cardId, since);

  const salesRows = db.prepare(`
    SELECT transaction_at AS date, sale_price AS price, 'sale' AS source
    FROM market_transactions WHERE card_id = ? AND sale_price > 0 AND transaction_at >= ?
    ORDER BY transaction_at ASC
  `).all(cardId, since);

  const legacyRows = db.prepare(`
    SELECT sold_at AS date, price, 'legacy' AS source
    FROM sales_history WHERE card_id = ? AND sold_at >= ? ORDER BY sold_at ASC
  `).all(cardId, since);

  const entRows = db.prepare(`
    SELECT date(created_at) AS date, price_market AS price, 'estimate' AS source
    FROM ai_enterprise_history WHERE card_id = ? AND price_market > 0 AND created_at >= ?
    ORDER BY created_at ASC
  `).all(cardId, since);

  const merged = new Map();

  [...aiRows, ...salesRows, ...legacyRows, ...entRows].forEach((r) => {
    if (!r.date || r.price == null) return;
    const key = String(r.date).slice(0, 10);
    const prev = merged.get(key);
    const price = round2(r.price);
    if (!prev) merged.set(key, { date: key, price, sources: [r.source] });
    else {
      prev.price = round2((prev.price + price) / 2);
      prev.sources.push(r.source);
    }
  });

  let points = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));

  if (points.length < 3) {
    const card = getCardById(cardId);
    const base = card?.recommendedPrice || card?.avgPrice || 10;
    points = synthesizeSeedPoints(base, days || 1825);
  }

  return points;
}

function synthesizeSeedPoints(base, days) {
  const span = days || 1825;
  const step = Math.max(1, Math.floor(span / 60));
  const pts = [];
  for (let d = span; d >= 0; d -= step) {
    const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const variance = 1 + Math.sin(d / 45) * 0.07 + (Math.random() - 0.5) * 0.03;
    pts.push({ date, price: round2(base * variance), sources: ["synthetic"] });
  }
  return pts;
}

export function getAllUltimateHistories(cardId) {
  return Object.keys(PERIODS).reduce((acc, key) => {
    acc[key] = getUltimateHistory(cardId, key);
    return acc;
  }, {});
}

export { PERIODS };
