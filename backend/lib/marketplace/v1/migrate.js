/**
 * Migration Marketplace v1.0 — colonnes étendues + panier + factures + litiges.
 */
import { getDb } from "../../engine/database.js";

export function migrateMarketplaceV1() {
  const db = getDb();
  migrateSellerColumns(db);
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
    CREATE INDEX IF NOT EXISTS idx_mk_sellers_paypal ON mk_sellers(paypal_merchant_id, paypal_onboarding_status);
    CREATE INDEX IF NOT EXISTS idx_mk_orders_paypal ON mk_orders(paypal_order_id, paypal_capture_id);
  `);
}

function addColumnIfMissing(db, table, cols, name, type) {
  if (!cols.includes(name)) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`); } catch { /* ignore */ }
  }
}

function migrateSellerColumns(db) {
  const cols = db.prepare("PRAGMA table_info(mk_sellers)").all().map((c) => c.name);
  addColumnIfMissing(db, "mk_sellers", cols, "paypal_merchant_id", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "mk_sellers", cols, "paypal_tracking_id", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "mk_sellers", cols, "paypal_onboarding_status", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "mk_sellers", cols, "paypal_payments_receivable", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "mk_sellers", cols, "paypal_email_confirmed", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "mk_sellers", cols, "paypal_permissions_granted", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "mk_sellers", cols, "paypal_connected_at", "TEXT DEFAULT ''");
}

function migrateListingColumns(db) {
  const cols = db.prepare("PRAGMA table_info(mk_listings)").all().map((c) => c.name);
  addColumnIfMissing(db, "mk_listings", cols, "extension", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "mk_listings", cols, "card_number", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "mk_listings", cols, "language", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "mk_listings", cols, "slug", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "mk_listings", cols, "seo_title", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "mk_listings", cols, "seo_description", "TEXT DEFAULT ''");
}

function migrateOrderColumns(db) {
  const cols = db.prepare("PRAGMA table_info(mk_orders)").all().map((c) => c.name);
  addColumnIfMissing(db, "mk_orders", cols, "items_json", "TEXT DEFAULT '[]'");
  addColumnIfMissing(db, "mk_orders", cols, "invoice_number", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "mk_orders", cols, "vat_rate", "REAL DEFAULT 20");
  addColumnIfMissing(db, "mk_orders", cols, "vat_amount", "REAL DEFAULT 0");
  addColumnIfMissing(db, "mk_orders", cols, "dispute_status", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "mk_orders", cols, "payment_provider", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "mk_orders", cols, "paypal_order_id", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "mk_orders", cols, "paypal_capture_id", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "mk_orders", cols, "platform_fee", "REAL DEFAULT 0");
  addColumnIfMissing(db, "mk_orders", cols, "seller_amount_after_platform_fee", "REAL DEFAULT 0");
}
