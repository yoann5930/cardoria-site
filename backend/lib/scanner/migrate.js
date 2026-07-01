/**
 * Schéma Scanner Intelligent Cardoria.
 */
import { getDb } from "../engine/database.js";

export function migrateScanner() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS scanner_scans (
      id TEXT PRIMARY KEY,
      analysis_id TEXT,
      created_at TEXT NOT NULL,
      customer_name TEXT DEFAULT '',
      customer_email TEXT DEFAULT '',
      card_id TEXT,
      pending_card_id TEXT,
      license_slug TEXT DEFAULT '',
      photos_count INTEGER DEFAULT 0,
      sides_json TEXT DEFAULT '[]',
      confidence_score INTEGER,
      suspicion_alert INTEGER DEFAULT 0,
      suspicion_reasons TEXT DEFAULT '[]',
      condition_grade TEXT DEFAULT '',
      defects_json TEXT DEFAULT '[]',
      detection_json TEXT DEFAULT '{}',
      client_json TEXT DEFAULT '{}',
      admin_json TEXT DEFAULT '{}',
      status TEXT DEFAULT 'completed',
      admin_status TEXT DEFAULT 'pending',
      raw_response TEXT DEFAULT '',
      multi_card_count INTEGER DEFAULT 1,
      processing_ms INTEGER DEFAULT 0,
      device_info TEXT DEFAULT '',
      fallback_used INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS scanner_pending_cards (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL,
      license_slug TEXT DEFAULT '',
      name TEXT NOT NULL,
      extension TEXT DEFAULT '',
      card_number TEXT DEFAULT '',
      rarity TEXT DEFAULT '',
      language TEXT DEFAULT '',
      version TEXT DEFAULT '',
      detection_json TEXT DEFAULT '{}',
      status TEXT DEFAULT 'pending',
      admin_note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      FOREIGN KEY (scan_id) REFERENCES scanner_scans(id)
    );

    CREATE INDEX IF NOT EXISTS idx_scanner_scans_date ON scanner_scans(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scanner_scans_suspicion ON scanner_scans(suspicion_alert, created_at);
    CREATE INDEX IF NOT EXISTS idx_scanner_scans_license ON scanner_scans(license_slug);
    CREATE INDEX IF NOT EXISTS idx_scanner_pending_status ON scanner_pending_cards(status, created_at);
  `);
}

export function makeScannerId() {
  return `SCN-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

export function makePendingCardId() {
  return `PND-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}
