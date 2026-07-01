/**
 * Schéma Big Data Cardoria — référence mondiale TCG.
 * Compatible SQLite aujourd'hui, PostgreSQL ready.
 */
import { getDb } from "../engine/database.js";

export function migrateBigData() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS bigdata_records (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      card_id TEXT DEFAULT '',
      license_slug TEXT DEFAULT '',
      extension TEXT DEFAULT '',
      card_number TEXT DEFAULT '',
      language TEXT DEFAULT '',
      condition_grade TEXT DEFAULT '',
      authenticity TEXT DEFAULT 'unknown',
      price_estimated REAL,
      price_market REAL,
      price_buy_advised REAL,
      price_sell_advised REAL,
      recorded_at TEXT NOT NULL,
      country_code TEXT DEFAULT 'FR',
      region_bucket TEXT DEFAULT 'france',
      rarity TEXT DEFAULT '',
      ai_score INTEGER,
      counterfeit_score INTEGER,
      is_graded INTEGER DEFAULT 0,
      is_psa INTEGER DEFAULT 0,
      UNIQUE(source_type, source_id)
    );

    CREATE TABLE IF NOT EXISTS bigdata_card_metrics (
      card_id TEXT PRIMARY KEY,
      popularity_score REAL DEFAULT 50,
      sale_velocity_days REAL,
      real_rarity_score REAL DEFAULT 50,
      demand_index REAL DEFAULT 50,
      seller_index REAL DEFAULT 50,
      buyer_index REAL DEFAULT 50,
      speculation_index REAL DEFAULT 50,
      collection_index REAL DEFAULT 50,
      investment_index REAL DEFAULT 50,
      estimation_count INTEGER DEFAULT 0,
      computed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bigdata_price_evolution (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_date TEXT NOT NULL,
      region_bucket TEXT DEFAULT 'world',
      avg_market REAL,
      avg_estimated REAL,
      volume INTEGER DEFAULT 0,
      computed_at TEXT NOT NULL,
      UNIQUE(period_date, region_bucket)
    );

    CREATE TABLE IF NOT EXISTS bigdata_trends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      entity_label TEXT DEFAULT '',
      change_percent REAL DEFAULT 0,
      intensity REAL DEFAULT 50,
      label TEXT DEFAULT '',
      computed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bigdata_heatmap (
      region_bucket TEXT PRIMARY KEY,
      estimation_count INTEGER DEFAULT 0,
      avg_price REAL DEFAULT 0,
      avg_ai_score REAL DEFAULT 50,
      intensity REAL DEFAULT 0,
      country_codes_json TEXT DEFAULT '[]',
      computed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bigdata_ai_stats (
      cache_key TEXT PRIMARY KEY DEFAULT 'latest',
      payload_json TEXT NOT NULL,
      computed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bigdata_cache (
      cache_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      computed_at TEXT NOT NULL,
      ttl_seconds INTEGER DEFAULT 3600
    );

    CREATE TABLE IF NOT EXISTS bigdata_sync_state (
      sync_key TEXT PRIMARY KEY,
      last_synced_at TEXT,
      last_source_id TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_bd_records_card ON bigdata_records(card_id, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_bd_records_license ON bigdata_records(license_slug, extension);
    CREATE INDEX IF NOT EXISTS idx_bd_records_region ON bigdata_records(region_bucket, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_bd_records_date ON bigdata_records(recorded_at);
    CREATE INDEX IF NOT EXISTS idx_bd_trends_type ON bigdata_trends(signal_type, computed_at);
    CREATE INDEX IF NOT EXISTS idx_bd_evolution_region ON bigdata_price_evolution(region_bucket, period_date);
    CREATE INDEX IF NOT EXISTS idx_bd_metrics_pop ON bigdata_card_metrics(popularity_score DESC);
  `);
}

export function makeBigDataRecordId() {
  return `BD-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}
