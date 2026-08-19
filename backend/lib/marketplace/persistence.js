/**
 * Persistance durable Marketplace Cardoria.
 *
 * SQLite reste le cache/runtime local rapide de l'instance Render.
 * PostgreSQL (Supabase) devient la copie persistante entre les redeploys.
 *
 * Au démarrage :
 * - si PostgreSQL est déjà initialisé, restauration PostgreSQL -> SQLite ;
 * - sinon, l'état SQLite initial est exporté vers PostgreSQL.
 *
 * Après chaque écriture Marketplace : snapshot SQLite -> PostgreSQL.
 */
import pg from "pg";
import { getDb } from "../engine/database.js";

const { Pool } = pg;

const PARENT_FIRST = [
  "mk_sellers",
  "mk_listings",
  "mk_orders",
  "mk_reviews",
  "mk_favorites",
  "mk_wishlist",
  "mk_price_alerts",
  "mk_cart_items",
  "mk_invoices",
  "mk_disputes"
];
const CHILD_FIRST = [...PARENT_FIRST].reverse();

let pool = null;
let initialized = false;
let syncTimer = null;
let syncPromise = null;
let dirty = false;
let lastError = "";
let lastSyncedAt = "";

function databaseUrl() {
  return String(process.env.MARKETPLACE_DATABASE_URL || "").trim();
}

export function marketplacePersistenceConfigured() {
  return Boolean(databaseUrl());
}

function getPool() {
  if (pool) return pool;
  const url = databaseUrl();
  if (!url) throw new Error("MARKETPLACE_DATABASE_URL absente.");
  pool = new Pool({
    connectionString: url,
    max: Math.max(1, Number(process.env.MARKETPLACE_DB_POOL_MAX) || 3),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  });
  pool.on("error", (error) => {
    lastError = error?.message || String(error);
    console.error("[marketplace-persistence] pool:", lastError);
  });
  return pool;
}

function quoteIdent(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error("Identifiant SQL invalide.");
  return `"${name}"`;
}

function sqliteRows(table) {
  return getDb().prepare(`SELECT * FROM ${quoteIdent(table)}`).all();
}

async function replacePostgresTable(client, table, rows) {
  await client.query(`DELETE FROM ${quoteIdent(table)}`);
  for (const row of rows) {
    const columns = Object.keys(row);
    if (!columns.length) continue;
    const names = columns.map(quoteIdent).join(", ");
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const values = columns.map((column) => row[column]);
    await client.query(
      `INSERT INTO ${quoteIdent(table)} (${names}) VALUES (${placeholders})`,
      values
    );
  }
}

async function snapshotNow(reason = "runtime") {
  if (!marketplacePersistenceConfigured()) return { ok: false, skipped: true, reason: "not_configured" };
  if (syncPromise) {
    dirty = true;
    return syncPromise;
  }

  syncPromise = (async () => {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const snapshots = new Map(PARENT_FIRST.map((table) => [table, sqliteRows(table)]));
      for (const table of CHILD_FIRST) {
        await client.query(`DELETE FROM ${quoteIdent(table)}`);
      }
      for (const table of PARENT_FIRST) {
        const rows = snapshots.get(table) || [];
        for (const row of rows) {
          const columns = Object.keys(row);
          if (!columns.length) continue;
          const names = columns.map(quoteIdent).join(", ");
          const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
          await client.query(
            `INSERT INTO ${quoteIdent(table)} (${names}) VALUES (${placeholders})`,
            columns.map((column) => row[column])
          );
        }
      }
      await client.query(`
        INSERT INTO marketplace_sync_meta (id, initialized, last_synced_at, source)
        VALUES ('primary', TRUE, NOW(), $1)
        ON CONFLICT (id) DO UPDATE SET
          initialized = TRUE,
          last_synced_at = NOW(),
          source = EXCLUDED.source
      `, [reason]);
      await client.query("COMMIT");
      lastError = "";
      lastSyncedAt = new Date().toISOString();
      initialized = true;
      return { ok: true, reason, lastSyncedAt };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      lastError = error?.message || String(error);
      console.error("[marketplace-persistence] snapshot:", lastError);
      throw error;
    } finally {
      client.release();
    }
  })();

  try {
    return await syncPromise;
  } finally {
    syncPromise = null;
    if (dirty) {
      dirty = false;
      scheduleMarketplaceSnapshot("queued-change", 100);
    }
  }
}

async function restoreFromPostgres() {
  const client = await getPool().connect();
  try {
    const meta = await client.query(
      "SELECT initialized, last_synced_at FROM marketplace_sync_meta WHERE id = 'primary' LIMIT 1"
    );
    if (!meta.rows[0]?.initialized) return { restored: false };

    const payload = new Map();
    for (const table of PARENT_FIRST) {
      const result = await client.query(`SELECT * FROM ${quoteIdent(table)}`);
      payload.set(table, result.rows);
    }

    const sqlite = getDb();
    sqlite.pragma("foreign_keys = OFF");
    const restore = sqlite.transaction(() => {
      for (const table of CHILD_FIRST) sqlite.prepare(`DELETE FROM ${quoteIdent(table)}`).run();
      for (const table of PARENT_FIRST) {
        for (const row of payload.get(table) || []) {
          const columns = Object.keys(row);
          if (!columns.length) continue;
          const names = columns.map(quoteIdent).join(", ");
          const placeholders = columns.map(() => "?").join(", ");
          sqlite.prepare(`INSERT INTO ${quoteIdent(table)} (${names}) VALUES (${placeholders})`)
            .run(...columns.map((column) => row[column]));
        }
      }
    });
    restore();
    sqlite.pragma("foreign_keys = ON");

    try {
      sqlite.exec("DELETE FROM mk_listings_fts;");
      sqlite.exec(`
        INSERT INTO mk_listings_fts(rowid, title, description, license_slug, card_condition)
        SELECT rowid, title, description, license_slug, card_condition FROM mk_listings;
      `);
    } catch { /* FTS optional */ }

    lastSyncedAt = meta.rows[0].last_synced_at ? new Date(meta.rows[0].last_synced_at).toISOString() : "";
    initialized = true;
    lastError = "";
    return { restored: true, lastSyncedAt };
  } finally {
    client.release();
  }
}

export async function initMarketplacePersistence() {
  if (!marketplacePersistenceConfigured()) {
    console.log("[marketplace-persistence] disabled: MARKETPLACE_DATABASE_URL absente");
    return { ok: true, configured: false };
  }

  try {
    const restored = await restoreFromPostgres();
    if (restored.restored) {
      console.log("[marketplace-persistence] restored from PostgreSQL");
      return { ok: true, configured: true, restored: true, lastSyncedAt: restored.lastSyncedAt };
    }

    const seeded = await snapshotNow("initial-sqlite-export");
    console.log("[marketplace-persistence] initialized PostgreSQL from SQLite");
    return { ok: true, configured: true, restored: false, initialized: seeded.ok };
  } catch (error) {
    lastError = error?.message || String(error);
    console.error("[marketplace-persistence] init degraded:", lastError);
    return { ok: false, configured: true, error: lastError };
  }
}

export function scheduleMarketplaceSnapshot(reason = "api-write", delayMs = 150) {
  if (!marketplacePersistenceConfigured()) return;
  dirty = true;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    syncTimer = null;
    if (!dirty) return;
    dirty = false;
    try { await snapshotNow(reason); } catch { /* logged above */ }
  }, Math.max(0, Number(delayMs) || 0));
  syncTimer.unref?.();
}

export function marketplacePersistenceMiddleware(req, res, next) {
  const method = String(req.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    res.on("finish", () => {
      if (res.statusCode < 500) scheduleMarketplaceSnapshot(`${method} ${req.path || ""}`);
    });
  }
  next();
}

export async function flushMarketplacePersistence(reason = "shutdown") {
  if (!marketplacePersistenceConfigured()) return { ok: true, skipped: true };
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  dirty = false;
  try {
    const result = await snapshotNow(reason);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

export function getMarketplacePersistenceStatus() {
  return {
    configured: marketplacePersistenceConfigured(),
    initialized,
    syncing: Boolean(syncPromise),
    dirty,
    lastSyncedAt,
    lastError: lastError ? "sync_error" : ""
  };
}

export async function closeMarketplacePersistence() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
