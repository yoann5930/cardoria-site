/**
 * Historique des prix — 7 / 30 / 90 / 365 jours.
 */
import { getDb } from "../engine/database.js";
import { ensureAiPriceHistoryTable } from "./migrate.js";

const PERIODS = { "7": 7, "30": 30, "90": 90, "365": 365, "1y": 365, "1an": 365 };

export function recordPriceSnapshot(cardId, prices, source = "cardoria_aggregate") {
  if (!cardId || !prices) return;
  const db = getDb();
  ensureAiPriceHistoryTable(db);
  db.prepare(`
    INSERT INTO ai_price_history (card_id, recorded_at, price_low, price_avg, price_high, price_recommended, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    cardId,
    new Date().toISOString().slice(0, 10),
    prices.low || 0,
    prices.avg || prices.recommended || 0,
    prices.high || 0,
    prices.recommended || 0,
    source
  );
}

export function getPriceHistory(cardId, period = "30") {
  const db = getDb();
  ensureAiPriceHistoryTable(db);
  const days = PERIODS[String(period)] || 30;
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT recorded_at AS date, price_low AS low, price_avg AS avg, price_high AS high, price_recommended AS recommended
    FROM ai_price_history WHERE card_id = ? AND recorded_at >= ?
    ORDER BY recorded_at ASC
  `).all(cardId, since);

  return { cardId, period: String(period), days, points: rows };
}

export function seedPriceHistoryIfEmpty(cardId, basePrice) {
  const db = getDb();
  ensureAiPriceHistoryTable(db);
  const count = db.prepare("SELECT COUNT(*) AS c FROM ai_price_history WHERE card_id = ?").get(cardId)?.c ?? 0;
  if (count > 0) return;

  const base = Number(basePrice) || 50;
  for (let d = 365; d >= 0; d -= Math.max(1, Math.floor(365 / 52))) {
    const date = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const variance = 1 + (Math.sin(d / 30) * 0.08) + (Math.random() - 0.5) * 0.04;
    const rec = Math.round(base * variance * 100) / 100;
    db.prepare(`
      INSERT INTO ai_price_history (card_id, recorded_at, price_low, price_avg, price_high, price_recommended, source)
      VALUES (?, ?, ?, ?, ?, ?, 'seed')
    `).run(cardId, date, rec * 0.88, rec, rec * 1.12, rec);
  }
}

export { PERIODS };
