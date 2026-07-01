/**
 * Schéma IA Enterprise auto-apprenante — SQLite / PostgreSQL ready.
 */
import { getDb } from "../engine/database.js";

export function migrateAiEnterprise() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_enterprise_history (
      id TEXT PRIMARY KEY,
      analysis_id TEXT,
      scan_id TEXT,
      card_id TEXT,
      created_at TEXT NOT NULL,
      license_slug TEXT DEFAULT '',
      extension TEXT DEFAULT '',
      card_number TEXT DEFAULT '',
      language TEXT DEFAULT '',
      condition_grade TEXT DEFAULT '',
      price_market REAL,
      price_buy_advised REAL,
      price_sell_advised REAL,
      price_actual_sell REAL,
      sale_delay_days INTEGER,
      views_count INTEGER DEFAULT 0,
      favorites_count INTEGER DEFAULT 0,
      offers_count INTEGER DEFAULT 0,
      purchases_count INTEGER DEFAULT 0,
      confidence_score INTEGER,
      reliability_score REAL,
      cardoria_trend_score REAL,
      source TEXT DEFAULT 'estimation',
      metadata_json TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS ai_enterprise_reliability (
      entity_key TEXT PRIMARY KEY,
      entity_type TEXT DEFAULT 'card',
      score REAL DEFAULT 50,
      precision_score REAL DEFAULT 50,
      recognition_score REAL DEFAULT 50,
      market_evolution_score REAL DEFAULT 50,
      sales_coherence_score REAL DEFAULT 50,
      risk_score REAL DEFAULT 50,
      sample_count INTEGER DEFAULT 0,
      computed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_enterprise_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT,
      fingerprint TEXT DEFAULT '',
      trigger_type TEXT DEFAULT 'sale',
      advised_price REAL,
      actual_price REAL,
      delta_percent REAL,
      adjustments_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_enterprise_predictions (
      card_id TEXT PRIMARY KEY,
      price_7d REAL, conf_7d REAL,
      price_30d REAL, conf_30d REAL,
      price_90d REAL, conf_90d REAL,
      price_180d REAL, conf_180d REAL,
      price_365d REAL, conf_365d REAL,
      computed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_enterprise_trend_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT,
      license_slug TEXT DEFAULT '',
      extension TEXT DEFAULT '',
      signal_type TEXT NOT NULL,
      cardoria_trend_score REAL DEFAULT 50,
      change_percent REAL DEFAULT 0,
      label TEXT DEFAULT '',
      computed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_enterprise_dashboard_cache (
      cache_key TEXT PRIMARY KEY DEFAULT 'latest',
      payload_json TEXT DEFAULT '{}',
      computed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ent_history_card ON ai_enterprise_history(card_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ent_history_license ON ai_enterprise_history(license_slug, extension);
    CREATE INDEX IF NOT EXISTS idx_ent_trends_type ON ai_enterprise_trend_signals(signal_type, computed_at);
    CREATE INDEX IF NOT EXISTS idx_ent_adjust_card ON ai_enterprise_adjustments(card_id, created_at);
  `);
}

export function makeEnterpriseHistoryId() {
  return `ENT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}
