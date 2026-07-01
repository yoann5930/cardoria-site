/**
 * Schéma marketplace Cardoria — même base SQLite que le moteur cartes.
 */
import { getDb, normalizeText } from "../engine/database.js";

export function migrateMarketplace() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS mk_sellers (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      seller_type TEXT DEFAULT 'individual',
      verified INTEGER DEFAULT 0,
      avatar TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      rating_avg REAL DEFAULT 0,
      rating_count INTEGER DEFAULT 0,
      sales_count INTEGER DEFAULT 0,
      satisfaction_rate REAL DEFAULT 100,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mk_listings (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL,
      card_id TEXT,
      title TEXT NOT NULL,
      title_normalized TEXT NOT NULL,
      license_slug TEXT DEFAULT '',
      description TEXT DEFAULT '',
      card_condition TEXT NOT NULL DEFAULT 'NM',
      price REAL NOT NULL,
      negotiable INTEGER DEFAULT 0,
      stock INTEGER DEFAULT 1,
      photos TEXT DEFAULT '[]',
      status TEXT DEFAULT 'active',
      views INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (seller_id) REFERENCES mk_sellers(id)
    );

    CREATE TABLE IF NOT EXISTS mk_orders (
      id TEXT PRIMARY KEY,
      buyer_email TEXT NOT NULL,
      buyer_name TEXT DEFAULT '',
      buyer_id TEXT DEFAULT '',
      seller_id TEXT NOT NULL,
      listing_id TEXT NOT NULL,
      listing_title TEXT DEFAULT '',
      qty INTEGER DEFAULT 1,
      unit_price REAL NOT NULL,
      shipping_cost REAL DEFAULT 0,
      shipping_carrier TEXT DEFAULT '',
      total REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      payment_method TEXT DEFAULT '',
      stripe_session_id TEXT DEFAULT '',
      stripe_payment_intent TEXT DEFAULT '',
      shipping_tracking TEXT DEFAULT '',
      shipping_label_url TEXT DEFAULT '',
      shipping_address TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (seller_id) REFERENCES mk_sellers(id),
      FOREIGN KEY (listing_id) REFERENCES mk_listings(id)
    );

    CREATE TABLE IF NOT EXISTS mk_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id TEXT NOT NULL,
      order_id TEXT NOT NULL UNIQUE,
      buyer_email TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (seller_id) REFERENCES mk_sellers(id)
    );

    CREATE TABLE IF NOT EXISTS mk_favorites (
      user_id TEXT NOT NULL,
      listing_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, listing_id),
      FOREIGN KEY (listing_id) REFERENCES mk_listings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mk_wishlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      card_id TEXT,
      listing_id TEXT,
      note TEXT DEFAULT '',
      target_price REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mk_price_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      card_id TEXT,
      listing_id TEXT,
      target_price REAL NOT NULL,
      active INTEGER DEFAULT 1,
      last_notified_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mk_listings_seller ON mk_listings(seller_id, status);
    CREATE INDEX IF NOT EXISTS idx_mk_listings_license ON mk_listings(license_slug, status);
    CREATE INDEX IF NOT EXISTS idx_mk_listings_price ON mk_listings(price);
    CREATE INDEX IF NOT EXISTS idx_mk_listings_title ON mk_listings(title_normalized);
    CREATE INDEX IF NOT EXISTS idx_mk_orders_buyer ON mk_orders(buyer_email);
    CREATE INDEX IF NOT EXISTS idx_mk_orders_seller ON mk_orders(seller_id);
    CREATE INDEX IF NOT EXISTS idx_mk_favorites_user ON mk_favorites(user_id);
    CREATE INDEX IF NOT EXISTS idx_mk_wishlist_user ON mk_wishlist(user_id);
    CREATE INDEX IF NOT EXISTS idx_mk_alerts_user ON mk_price_alerts(user_id, active);
  `);

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS mk_listings_fts USING fts5(
        title, description, license_slug, card_condition,
        content='mk_listings', content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );
    `);
    const fts = db.prepare("SELECT COUNT(*) AS c FROM mk_listings_fts").get()?.c ?? 0;
    const lst = db.prepare("SELECT COUNT(*) AS c FROM mk_listings").get()?.c ?? 0;
    if (lst > 0 && fts === 0) {
      db.exec(`
        INSERT INTO mk_listings_fts(rowid, title, description, license_slug, card_condition)
        SELECT rowid, title, description, license_slug, card_condition FROM mk_listings;
      `);
    }
  } catch { /* FTS optional */ }
}

export function syncListingFts(rowid, listing) {
  try {
    const db = getDb();
    db.prepare("DELETE FROM mk_listings_fts WHERE rowid = ?").run(rowid);
    db.prepare(
      "INSERT INTO mk_listings_fts(rowid, title, description, license_slug, card_condition) VALUES (?,?,?,?,?)"
    ).run(rowid, listing.title, listing.description || "", listing.license_slug || "", listing.card_condition);
  } catch { /* ignore */ }
}

export function makeMarketId(prefix) {
  return prefix + "-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.floor(1000 + Math.random() * 9000);
}

export { normalizeText };
