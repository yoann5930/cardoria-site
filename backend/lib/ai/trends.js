/**
 * Détection des tendances marché — cartes en hausse ou en baisse.
 */
import { getDb } from "../engine/database.js";
import { ensureAiPriceHistoryTable } from "./migrate.js";

export function computeTrendForCard(cardId, cardName = "", license = "") {
  const db = getDb();
  ensureAiPriceHistoryTable(db);
  const rows = db.prepare(`
    SELECT price_recommended, recorded_at FROM ai_price_history
    WHERE card_id = ? ORDER BY recorded_at DESC LIMIT 60
  `).all(cardId);

  if (rows.length < 4) return null;

  const mid = Math.floor(rows.length / 2);
  const recent = rows.slice(0, mid);
  const older = rows.slice(mid);
  const avgRecent = recent.reduce((s, r) => s + r.price_recommended, 0) / recent.length;
  const avgOlder = older.reduce((s, r) => s + r.price_recommended, 0) / older.length;
  if (!avgOlder) return null;

  const changePercent = Math.round(((avgRecent - avgOlder) / avgOlder) * 1000) / 10;
  let direction = "stable";
  if (changePercent > 5) direction = "up";
  else if (changePercent < -5) direction = "down";

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ai_trends (card_id, direction, change_percent, period_days, computed_at, card_name, license_slug)
    VALUES (?, ?, ?, 30, ?, ?, ?)
    ON CONFLICT(card_id) DO UPDATE SET direction=excluded.direction, change_percent=excluded.change_percent, computed_at=excluded.computed_at
  `).run(cardId, direction, changePercent, now, cardName, license);

  return { cardId, direction, changePercent, periodDays: 30 };
}

export function getTrends({ direction, limit = 20 } = {}) {
  const db = getDb();
  let sql = "SELECT * FROM ai_trends WHERE direction != 'stable'";
  const params = [];
  if (direction === "up" || direction === "down") {
    sql += " AND direction = ?";
    params.push(direction);
  }
  sql += " ORDER BY ABS(change_percent) DESC LIMIT ?";
  params.push(Math.min(limit, 100));

  return db.prepare(sql).all(...params).map((r) => ({
    cardId: r.card_id,
    name: r.card_name,
    license: r.license_slug,
    direction: r.direction,
    changePercent: r.change_percent,
    computedAt: r.computed_at
  }));
}

export function refreshAllTrends(limit = 100) {
  const db = getDb();
  ensureAiPriceHistoryTable(db);
  const cards = db.prepare(`
    SELECT DISTINCT card_id FROM ai_price_history LIMIT ?
  `).all(limit);
  let updated = 0;
  cards.forEach(({ card_id }) => {
    if (computeTrendForCard(card_id)) updated++;
  });
  return { updated };
}
