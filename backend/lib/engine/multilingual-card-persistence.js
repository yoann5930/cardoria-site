import pg from "pg";
import { getDb } from "./database.js";

const { Pool } = pg;
const LANGUAGES = ["en", "ja", "ko"];
const BATCH_SIZE = 250;
let pool = null;

function databaseUrl() { return String(process.env.MARKETPLACE_DATABASE_URL || "").trim(); }
function getPool() {
  if (pool) return pool;
  const url = databaseUrl();
  if (!url) return null;
  pool = new Pool({ connectionString: url, max: 2, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  return pool;
}
async function configureClient(client) {
  try { await client.query("SET statement_timeout TO '30000ms'"); } catch {}
  try { await client.query("SET lock_timeout TO '5000ms'"); } catch {}
}
async function ensureSchema(client) {
  await configureClient(client);
  await client.query(`CREATE TABLE IF NOT EXISTS cardoria_multilingual_cards (
    id TEXT PRIMARY KEY,
    language TEXT NOT NULL,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.query("CREATE INDEX IF NOT EXISTS idx_cardoria_multilingual_cards_language ON cardoria_multilingual_cards(language)");
}
function chunks(rows, size = BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
async function writeBatch(client, rows) {
  if (!rows.length) return;
  const values = [];
  const tuples = rows.map((row, index) => {
    const base = index * 3;
    values.push(row.id, row.language, JSON.stringify(row));
    return `($${base + 1},$${base + 2},$${base + 3}::jsonb,NOW())`;
  });
  await client.query(`INSERT INTO cardoria_multilingual_cards (id,language,payload,updated_at) VALUES ${tuples.join(",")}
    ON CONFLICT (id) DO UPDATE SET language=EXCLUDED.language,payload=EXCLUDED.payload,updated_at=NOW()`, values);
}

export async function persistMultilingualCards(reason = "catalog-sync") {
  const dbPool = getPool();
  if (!dbPool) return { ok: true, skipped: true, reason: "database_not_configured" };
  const sqlite = getDb();
  const client = await dbPool.connect();
  const counts = {};
  try {
    await ensureSchema(client);
    for (const language of LANGUAGES) {
      const startedAt = new Date().toISOString();
      const rows = sqlite.prepare("SELECT * FROM cards WHERE license_slug='pokemon' AND language=? AND active=1 ORDER BY id").all(language);
      for (const batch of chunks(rows)) await writeBatch(client, batch);
      try {
        await client.query("DELETE FROM cardoria_multilingual_cards WHERE language=$1 AND updated_at < $2::timestamptz", [language, startedAt]);
      } catch (error) {
        if (!/lock timeout|statement timeout/i.test(String(error?.message || ""))) throw error;
        console.warn(`[multilingual-persistence] stale-row cleanup skipped for ${language}: timeout`);
      }
      counts[language] = rows.length;
    }
    console.log(`[multilingual-persistence] saved EN=${counts.en || 0} JA=${counts.ja || 0} KO=${counts.ko || 0} (${reason})`);
    return { ok: true, counts, reason };
  } catch (error) {
    console.error("[multilingual-persistence] save failed", error?.message || String(error));
    return { ok: false, error: error?.message || String(error), counts };
  } finally {
    client.release();
  }
}

function insertRows(sqlite, rows) {
  if (!rows.length) return 0;
  let inserted = 0;
  const knownColumns = new Set(sqlite.prepare("PRAGMA table_info(cards)").all().map((row) => String(row.name || "")));
  sqlite.pragma("foreign_keys = OFF");
  try {
    const tx = sqlite.transaction(() => {
      for (const row of rows) {
        if (!row || typeof row !== "object" || !row.id) continue;
        // Snapshots may contain fields introduced by a newer catalog provider.
        // Restore every field the current SQLite schema knows instead of
        // rejecting the whole card because one optional column is not migrated yet.
        const columns = Object.keys(row).filter((name) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) && knownColumns.has(name));
        if (!columns.includes("id") || !columns.length) continue;
        const quoted = columns.map((name) => `"${name}"`).join(",");
        const placeholders = columns.map(() => "?").join(",");
        sqlite.prepare(`INSERT OR REPLACE INTO cards (${quoted}) VALUES (${placeholders})`).run(...columns.map((name) => row[name]));
        inserted += 1;
      }
    });
    tx();
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
  return inserted;
}

export async function restoreMultilingualCards() {
  const dbPool = getPool();
  if (!dbPool) return { ok: true, skipped: true, reason: "database_not_configured", counts: { en: 0, ja: 0, ko: 0 } };
  const sqlite = getDb();
  const client = await dbPool.connect();
  const counts = { en: 0, ja: 0, ko: 0 };
  try {
    await ensureSchema(client);
    for (const language of LANGUAGES) {
      let afterId = "";
      while (true) {
        const result = await client.query("SELECT id,payload FROM cardoria_multilingual_cards WHERE language=$1 AND id>$2 ORDER BY id LIMIT 1000", [language, afterId]);
        if (!result.rows.length) break;
        counts[language] += insertRows(sqlite, result.rows.map((row) => row.payload));
        afterId = String(result.rows[result.rows.length - 1].id || "");
        if (result.rows.length < 1000) break;
      }
    }
    try { sqlite.exec("DELETE FROM cards_fts; INSERT INTO cards_fts(rowid,name,extension,number,rarity,license_slug) SELECT rowid,name,extension,number,rarity,license_slug FROM cards;"); } catch {}
    console.log(`[multilingual-persistence] restored EN=${counts.en} JA=${counts.ja} KO=${counts.ko}`);
    return { ok: true, counts };
  } catch (error) {
    console.error("[multilingual-persistence] restore failed", error?.message || String(error));
    return { ok: false, error: error?.message || String(error), counts };
  } finally {
    client.release();
  }
}

export async function closeMultilingualCardPersistence() {
  if (!pool) return;
  const current = pool;
  pool = null;
  try { await current.end(); } catch {}
}
