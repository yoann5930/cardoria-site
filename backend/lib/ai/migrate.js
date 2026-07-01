/**
 * Schéma IA Premium Cardoria — analyses, validations, historique, tendances.
 */
import { getDb } from "../engine/database.js";

export function ensureAiPriceHistoryTable(db = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      price_low REAL NOT NULL,
      price_avg REAL NOT NULL,
      price_high REAL NOT NULL,
      price_recommended REAL NOT NULL,
      source TEXT DEFAULT 'cardoria_aggregate'
    );
    CREATE INDEX IF NOT EXISTS idx_ai_price_history_card ON ai_price_history(card_id, recorded_at);
  `);
}

export function migrateAi() {
  const db = getDb();
  ensureAiPriceHistoryTable(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_analyses (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      customer_name TEXT DEFAULT '',
      customer_email TEXT DEFAULT '',
      customer_notes TEXT DEFAULT '',
      card_id TEXT,
      photos_count INTEGER DEFAULT 0,
      confidence_score INTEGER,
      suspicion_alert INTEGER DEFAULT 0,
      suspicion_reasons TEXT DEFAULT '[]',
      condition_grade TEXT DEFAULT '',
      client_message TEXT DEFAULT '',
      raw_response TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      admin_status TEXT DEFAULT 'pending',
      prices_json TEXT DEFAULT '{}',
      detection_json TEXT DEFAULT '{}',
      trends_json TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS ai_validations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id TEXT NOT NULL,
      admin_action TEXT NOT NULL,
      corrected_detection TEXT DEFAULT '{}',
      corrected_prices TEXT DEFAULT '{}',
      admin_note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      used_for_training INTEGER DEFAULT 0,
      FOREIGN KEY (analysis_id) REFERENCES ai_analyses(id)
    );

    CREATE TABLE IF NOT EXISTS ai_training_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_slug TEXT,
      detection_json TEXT NOT NULL,
      source TEXT DEFAULT 'admin_validation',
      weight REAL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      price_low REAL NOT NULL,
      price_avg REAL NOT NULL,
      price_high REAL NOT NULL,
      price_recommended REAL NOT NULL,
      source TEXT DEFAULT 'cardoria_aggregate'
    );

    CREATE TABLE IF NOT EXISTS ai_trends (
      card_id TEXT PRIMARY KEY,
      direction TEXT NOT NULL,
      change_percent REAL NOT NULL,
      period_days INTEGER DEFAULT 30,
      computed_at TEXT NOT NULL,
      card_name TEXT DEFAULT '',
      license_slug TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_ai_analyses_status ON ai_analyses(admin_status, created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_price_history_card ON ai_price_history(card_id, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_ai_trends_dir ON ai_trends(direction, change_percent);

    CREATE TABLE IF NOT EXISTS ai_learning_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      license_slug TEXT DEFAULT '',
      extension TEXT DEFAULT '',
      card_number TEXT DEFAULT '',
      rarity TEXT DEFAULT '',
      card_name TEXT DEFAULT '',
      fingerprint TEXT DEFAULT '',
      condition_estimated TEXT DEFAULT '',
      condition_validated TEXT DEFAULT '',
      price_ai_buyback REAL,
      price_ai_resell REAL,
      price_ai_avg REAL,
      price_actual_buy REAL,
      price_actual_sell REAL,
      resale_delay_days INTEGER,
      authenticity_result TEXT DEFAULT '',
      is_counterfeit INTEGER DEFAULT 0,
      confidence_score INTEGER,
      admin_decision TEXT DEFAULT 'pending',
      detection_ai_json TEXT DEFAULT '{}',
      detection_validated_json TEXT DEFAULT '{}',
      prices_ai_json TEXT DEFAULT '{}',
      outcome_recorded INTEGER DEFAULT 0,
      training_weight REAL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS ai_learning_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id TEXT NOT NULL,
      side TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      content_hash TEXT DEFAULT '',
      byte_size INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_feedback_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id TEXT NOT NULL,
      feedback_type TEXT NOT NULL,
      field_name TEXT DEFAULT '',
      ai_value TEXT DEFAULT '',
      corrected_value TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      admin_note TEXT DEFAULT '',
      applied_to_training INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_performance_monthly (
      month TEXT PRIMARY KEY,
      total_evaluated INTEGER DEFAULT 0,
      success_rate REAL DEFAULT 0,
      detection_accuracy REAL DEFAULT 0,
      price_accuracy REAL DEFAULT 0,
      counterfeit_accuracy REAL DEFAULT 0,
      metrics_json TEXT DEFAULT '{}',
      computed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_learning_license ON ai_learning_records(license_slug, extension);
    CREATE INDEX IF NOT EXISTS idx_learning_fingerprint ON ai_learning_records(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_learning_decision ON ai_learning_records(admin_decision, updated_at);
    CREATE INDEX IF NOT EXISTS idx_learning_images_analysis ON ai_learning_images(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_analysis ON ai_feedback_log(analysis_id, created_at);
  `);

  migrateLearningColumns(db);
}

function migrateLearningColumns(db) {
  const cols = db.prepare("PRAGMA table_info(ai_training_examples)").all().map((c) => c.name);
  const add = (sql) => { try { db.exec(sql); } catch { /* exists */ } };
  if (!cols.includes("fingerprint")) add("ALTER TABLE ai_training_examples ADD COLUMN fingerprint TEXT DEFAULT ''");
  if (!cols.includes("extension")) add("ALTER TABLE ai_training_examples ADD COLUMN extension TEXT DEFAULT ''");
  if (!cols.includes("rarity")) add("ALTER TABLE ai_training_examples ADD COLUMN rarity TEXT DEFAULT ''");
  if (!cols.includes("condition_json")) add("ALTER TABLE ai_training_examples ADD COLUMN condition_json TEXT DEFAULT '{}'");
  if (!cols.includes("prices_json")) add("ALTER TABLE ai_training_examples ADD COLUMN prices_json TEXT DEFAULT '{}'");
  if (!cols.includes("feedback_id")) add("ALTER TABLE ai_training_examples ADD COLUMN feedback_id INTEGER");
  if (!cols.includes("analysis_id")) add("ALTER TABLE ai_training_examples ADD COLUMN analysis_id TEXT DEFAULT ''");
}

export function makeAnalysisId() {
  return "AI-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.floor(1000 + Math.random() * 9000);
}
