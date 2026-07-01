/**
 * Moteur de tendances Big Data Cardoria.
 */
import { getDb } from "../engine/database.js";

const SIGNAL_TYPES = [
  "exploding", "falling", "license_rising", "extension_hot",
  "unusual_rise", "unusual_fall"
];

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}

export function computeBigDataTrends() {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("DELETE FROM bigdata_trends WHERE computed_at < datetime('now', '-5 days')").run();

  const signals = [];

  const cards = db.prepare(`
    SELECT card_id, COUNT(*) AS c,
      AVG(price_market) AS avg_m,
      MAX(price_market) - MIN(price_market) AS spread
    FROM bigdata_records
    WHERE card_id != '' AND recorded_at >= datetime('now', '-30 days')
    GROUP BY card_id HAVING c >= 2
    ORDER BY c DESC LIMIT 120
  `).all();

  cards.forEach((c) => {
    const recent = db.prepare(`
      SELECT AVG(price_market) AS p FROM bigdata_records
      WHERE card_id = ? AND recorded_at >= datetime('now', '-7 days')
    `).get(c.card_id)?.p ?? 0;
    const older = db.prepare(`
      SELECT AVG(price_market) AS p FROM bigdata_records
      WHERE card_id = ? AND recorded_at >= datetime('now', '-30 days')
        AND recorded_at < datetime('now', '-7 days')
    `).get(c.card_id)?.p ?? recent;

    if (!older) return;
    const change = round1(((recent - older) / older) * 100);

    if (change >= 15) addSignal(db, signals, "exploding", "card", c.card_id, change, "Carte en explosion");
    if (change <= -15) addSignal(db, signals, "falling", "card", c.card_id, change, "Carte en chute");
    if (change >= 25) addSignal(db, signals, "unusual_rise", "card", c.card_id, change, "Hausse inhabituelle");
    if (change <= -25) addSignal(db, signals, "unusual_fall", "card", c.card_id, change, "Baisse inhabituelle");
  });

  const licenses = db.prepare(`
    SELECT license_slug, COUNT(*) AS c FROM bigdata_records
    WHERE recorded_at >= datetime('now', '-14 days') AND license_slug != ''
    GROUP BY license_slug ORDER BY c DESC LIMIT 20
  `).all();

  licenses.slice(0, 5).forEach((l, i) => {
    const prev = db.prepare(`
      SELECT COUNT(*) AS c FROM bigdata_records
      WHERE license_slug = ? AND recorded_at >= datetime('now', '-28 days')
        AND recorded_at < datetime('now', '-14 days')
    `).get(l.license_slug)?.c ?? 1;
    const change = round1(((l.c - prev) / Math.max(prev, 1)) * 100);
    if (change >= 20 || i < 2) {
      addSignal(db, signals, "license_rising", "license", l.license_slug, change, "Licence populaire");
    }
  });

  const extensions = db.prepare(`
    SELECT extension, license_slug, COUNT(*) AS c FROM bigdata_records
    WHERE extension != '' AND recorded_at >= datetime('now', '-21 days')
    GROUP BY extension, license_slug ORDER BY c DESC LIMIT 15
  `).all();

  extensions.slice(0, 6).forEach((e) => {
    addSignal(db, signals, "extension_hot", "extension", `${e.license_slug}:${e.extension}`, e.c, "Extension recherchée");
  });

  return { signals: signals.length, computedAt: now };
}

function addSignal(db, list, type, entityType, entityId, change, label) {
  const intensity = Math.min(100, Math.abs(change) + 30);
  db.prepare(`
    INSERT INTO bigdata_trends (signal_type, entity_type, entity_id, entity_label, change_percent, intensity, label, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(type, entityType, entityId, entityId, change, intensity, label, new Date().toISOString());

  list.push({ type, entityType, entityId, changePercent: change, label, intensity });
}

export function getBigDataTrends({ type, limit = 40 } = {}) {
  const db = getDb();
  let sql = "SELECT * FROM bigdata_trends WHERE 1=1";
  const params = [];
  if (type && SIGNAL_TYPES.includes(type)) {
    sql += " AND signal_type = ?";
    params.push(type);
  }
  sql += " ORDER BY computed_at DESC, intensity DESC LIMIT ?";
  params.push(limit);

  return db.prepare(sql).all(...params).map((r) => ({
    type: r.signal_type,
    entityType: r.entity_type,
    entityId: r.entity_id,
    label: r.label,
    changePercent: r.change_percent,
    intensity: r.intensity,
    computedAt: r.computed_at
  }));
}

export { SIGNAL_TYPES };
