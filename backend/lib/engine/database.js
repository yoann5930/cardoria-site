/**
 * Cardoria Engine — couche SQLite indexée (FTS5).
 * Conçue pour migrer vers PostgreSQL sans changer l'API publique.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../../data");
const DB_PATH = path.join(DATA_DIR, "cardoria-engine.db");

let db;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '🃏',
      description TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      license_slug TEXT NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      name_normalized TEXT NOT NULL,
      extension TEXT DEFAULT '',
      extension_code TEXT DEFAULT '',
      number TEXT DEFAULT '',
      rarity TEXT DEFAULT '',
      illustration TEXT DEFAULT '',
      image_hd TEXT DEFAULT '',
      image_thumb TEXT DEFAULT '',
      condition_note TEXT DEFAULT 'NM',
      avg_price REAL DEFAULT 0,
      low_price REAL DEFAULT 0,
      high_price REAL DEFAULT 0,
      recommended_price REAL DEFAULT 0,
      market_trend TEXT DEFAULT 'stable',
      trend_percent REAL DEFAULT 0,
      sales_count INTEGER DEFAULT 0,
      views INTEGER DEFAULT 0,
      meta_title TEXT DEFAULT '',
      meta_description TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(license_slug, slug),
      FOREIGN KEY (license_slug) REFERENCES licenses(slug)
    );

    CREATE TABLE IF NOT EXISTS price_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      source TEXT NOT NULL,
      price REAL NOT NULL,
      currency TEXT DEFAULT 'EUR',
      weight REAL DEFAULT 1,
      fetched_at TEXT NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sales_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      sold_at TEXT NOT NULL,
      price REAL NOT NULL,
      condition TEXT DEFAULT 'NM',
      channel TEXT DEFAULT 'Cardoria',
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cards_license ON cards(license_slug, active);
    CREATE INDEX IF NOT EXISTS idx_cards_slug ON cards(license_slug, slug);
    CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name_normalized);
    CREATE INDEX IF NOT EXISTS idx_price_sources_card ON price_sources(card_id);
    CREATE INDEX IF NOT EXISTS idx_sales_card ON sales_history(card_id, sold_at);
  `);

  try {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
        name, extension, number, rarity, license_slug,
        content='cards', content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );
    `);
  } catch {
    /* FTS5 indisponible — recherche LIKE utilisée en fallback */
  }

  const ftsCount = database.prepare("SELECT COUNT(*) AS c FROM cards_fts").get()?.c ?? 0;
  const cardCount = database.prepare("SELECT COUNT(*) AS c FROM cards").get()?.c ?? 0;
  if (cardCount > 0 && ftsCount === 0) {
    try {
      database.exec(`
        INSERT INTO cards_fts(rowid, name, extension, number, rarity, license_slug)
        SELECT rowid, name, extension, number, rarity, license_slug FROM cards;
      `);
    } catch { /* ignore */ }
  }
}

export function normalizeText(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function slugify(str) {
  return normalizeText(str)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "carte";
}

export function makeCardId(licenseSlug, slug) {
  return `${licenseSlug}-${slug}`.slice(0, 180);
}

export function syncFts(cardRowid, card) {
  try {
    const dbi = getDb();
    dbi.prepare("DELETE FROM cards_fts WHERE rowid = ?").run(cardRowid);
    dbi.prepare(
      "INSERT INTO cards_fts(rowid, name, extension, number, rarity, license_slug) VALUES (?,?,?,?,?,?)"
    ).run(cardRowid, card.name, card.extension, card.number, card.rarity, card.license_slug);
  } catch { /* FTS optional */ }
}

export function rowToCard(row, extras = {}) {
  if (!row) return null;
  return {
    id: row.id,
    license: row.license_slug,
    slug: row.slug,
    name: row.name,
    extension: row.extension,
    extensionCode: row.extension_code,
    number: row.number,
    rarity: row.rarity,
    illustration: row.illustration,
    imageHd: row.image_hd,
    imageThumb: row.image_thumb || row.image_hd,
    condition: row.condition_note,
    prices: {
      avg: row.avg_price,
      low: row.low_price,
      high: row.high_price,
      recommended: row.recommended_price
    },
    marketTrend: row.market_trend,
    trendPercent: row.trend_percent,
    salesCount: row.sales_count,
    views: row.views,
    meta: { title: row.meta_title, description: row.meta_description },
    active: !!row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extras
  };
}
