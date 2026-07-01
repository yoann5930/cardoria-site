/**
 * Schéma Cardoria Ultimate Enterprise — SQLite / PostgreSQL ready.
 * Indexation pour scale : 1M cartes, 100K users, 1M estimations.
 */
import { getDb } from "../engine/database.js";

export function migrateUltimate() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ultimate_price_cache (
      card_id TEXT PRIMARY KEY,
      cardmarket REAL, ebay REAL, pricecharting REAL, tcgplayer REAL, psa REAL,
      world_average REAL, global_index REAL,
      currency TEXT DEFAULT 'EUR',
      sources_json TEXT DEFAULT '{}',
      computed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ultimate_investment_advice (
      card_id TEXT PRIMARY KEY,
      primary_action TEXT NOT NULL,
      tags_json TEXT DEFAULT '[]',
      confidence INTEGER DEFAULT 50,
      rationale TEXT DEFAULT '',
      computed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ultimate_exceptional_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT,
      analysis_id TEXT DEFAULT '',
      alert_type TEXT NOT NULL,
      label TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      details_json TEXT DEFAULT '{}',
      notified INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ultimate_history_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      points_json TEXT NOT NULL,
      computed_at TEXT NOT NULL,
      UNIQUE(card_id, period_key)
    );

    CREATE TABLE IF NOT EXISTS ultimate_search_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_text TEXT NOT NULL,
      parsed_json TEXT DEFAULT '{}',
      results_count INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ultimate_dashboard_cache (
      cache_key TEXT PRIMARY KEY DEFAULT 'latest',
      payload_json TEXT NOT NULL,
      computed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ultimate_scale_meta (
      meta_key TEXT PRIMARY KEY,
      meta_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ultimate_exceptional_card ON ultimate_exceptional_alerts(card_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ultimate_exceptional_type ON ultimate_exceptional_alerts(alert_type);
    CREATE INDEX IF NOT EXISTS idx_ultimate_search_log_at ON ultimate_search_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_ultimate_history_card ON ultimate_history_cache(card_id, period_key);
  `);

  seedScaleMeta(db);
}

function seedScaleMeta(db) {
  const now = new Date().toISOString();
  const rows = [
    ["target_cards", "1000000"],
    ["target_users", "100000"],
    ["target_estimations", "1000000"],
    ["pagination_default", "24"],
    ["cache_ttl_seconds", "3600"],
    ["architecture", "sqlite_now_postgres_ready"]
  ];
  const ins = db.prepare(`
    INSERT INTO ultimate_scale_meta (meta_key, meta_value, updated_at)
    VALUES (?, ?, ?) ON CONFLICT(meta_key) DO NOTHING
  `);
  rows.forEach(([k, v]) => ins.run(k, v, now));
}
