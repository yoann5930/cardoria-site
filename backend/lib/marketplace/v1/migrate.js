/**
 * Migration Marketplace v1.0 — colonnes étendues + panier + factures + litiges.
 */
import { getDb } from "../../engine/database.js";

export function migrateMarketplaceV1() {
  const db = getDb();
  migrateListingColumns(db);
  migrateOrderColumns(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mk_cart_items (
      user_id TEXT NOT NULL,
      listing_id TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (user_id, listing_id),
      FOREIGN KEY (listing_id) REFERENCES mk_listings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mk_invoices (
      invoice_number TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      subtotal REAL NOT NULL,
      vat_rate REAL DEFAULT 20,
      vat_amount REAL DEFAULT 0,
      total REAL NOT NULL,
      buyer_email TEXT DEFAULT '',
      issued_at TEXT NOT NULL,
      html_snapshot TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS mk_disputes (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      buyer_email TEXT DEFAULT '',
      seller_id TEXT DEFAULT '',
      status TEXT DEFAULT 'open',
      reason TEXT DEFAULT '',
      resolution TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mk_listings_slug ON mk_listings(slug);
    CREATE INDEX IF NOT EXISTS idx_mk_cart_user ON mk_cart_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_mk_disputes_order ON mk_disputes(order_id, status);
    CREATE INDEX IF NOT EXISTS idx_mk_invoices_order ON mk_invoices(order_id);
  `);
}

function migrateListingColumns(db) {
  const cols = db.prepare("PRAGMA table_info(mk_listings)").all().map((c) => c.name);
  const add = (name, type) => {
    if (!cols.includes(name)) {
      try { db.exec(`ALTER TABLE mk_listings ADD COLUMN ${name} ${type}`); } catch { /* ignore */ }
    }
  };
  add("extension", "TEXT DEFAULT ''");
  add("card_number", "TEXT DEFAULT ''");
  add("language", "TEXT DEFAULT ''");
  add("slug", "TEXT DEFAULT ''");
  add("seo_title", "TEXT DEFAULT ''");
  add("seo_description", "TEXT DEFAULT ''");
}

function migrateOrderColumns(db) {
  const cols = db.prepare("PRAGMA table_info(mk_orders)").all().map((c) => c.name);
  const add = (name, type) => {
    if (!cols.includes(name)) {
      try { db.exec(`ALTER TABLE mk_orders ADD COLUMN ${name} ${type}`); } catch { /* ignore */ }
    }
  };
  add("items_json", "TEXT DEFAULT '[]'");
  add("invoice_number", "TEXT DEFAULT ''");
  add("vat_rate", "REAL DEFAULT 20");
  add("vat_amount", "REAL DEFAULT 0");
  add("dispute_status", "TEXT DEFAULT ''");
}
