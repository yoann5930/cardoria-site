/**
 * Persistance durable Cardoria.
 * Marketplace + donnees runtime critiques + moteur cartes sont restaures depuis PostgreSQL.
 */
import pg from "pg";
import { getDb } from "../engine/database.js";
import { readJson, writeJson } from "../storage.js";

const { Pool } = pg;
const MARKET_TABLES = ["mk_sellers","mk_listings","mk_orders","mk_reviews","mk_favorites","mk_wishlist","mk_price_alerts","mk_cart_items","mk_invoices","mk_disputes"];
const MARKET_CHILD_FIRST = [...MARKET_TABLES].reverse();
const RUNTIME_TABLES = ["auth_users","auth_sessions","auth_reset_tokens","auth_magic_tokens","gdpr_consents","pay_transactions"];
const ENGINE_TABLES = ["licenses","cards","price_sources","sales_history","card_price_history"];
const ENGINE_CHILD_FIRST = ["card_price_history","sales_history","price_sources","cards","licenses"];

let pool = null;
let initialized = false;
let syncTimer = null;
let syncPromise = null;
let dirty = false;
let lastError = "";
let lastSyncedAt = "";
let engineSyncTimer = null;
let engineSyncPromise = null;
let engineDirty = false;
let engineLastError = "";
let engineLastSyncedAt = "";

function databaseUrl() { return String(process.env.MARKETPLACE_DATABASE_URL || "").trim(); }
export function marketplacePersistenceConfigured() { return Boolean(databaseUrl()); }
function quoteIdent(name) { if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error("Identifiant SQL invalide."); return `"${name}"`; }
function getPool() {
  if (pool) return pool;
  const url = databaseUrl(); if (!url) throw new Error("MARKETPLACE_DATABASE_URL absente.");
  pool = new Pool({ connectionString: url, max: Math.max(1, Number(process.env.MARKETPLACE_DB_POOL_MAX) || 3), idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  pool.on("error", (error) => { lastError = error?.message || String(error); console.error("[cardoria-persistence] pool:", lastError); });
  return pool;
}
function sqliteRows(table) { return getDb().prepare(`SELECT * FROM ${quoteIdent(table)}`).all(); }
async function ensureRemoteSchema(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS cardoria_runtime_snapshot (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await client.query(`CREATE TABLE IF NOT EXISTS cardoria_engine_snapshot (id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await client.query(`ALTER TABLE mk_sellers ADD COLUMN IF NOT EXISTS auth_user_id TEXT DEFAULT ''`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_mk_sellers_auth_user ON mk_sellers(auth_user_id)`);
}
function runtimePayload() {
  const tables = {};
  for (const table of RUNTIME_TABLES) { try { tables[table] = sqliteRows(table); } catch { tables[table] = []; } }
  return { version: 1, tables, boutiqueOrders: readJson("orders", []), capturedAt: new Date().toISOString() };
}
function enginePayload() {
  const tables = {};
  for (const table of ENGINE_TABLES) { try { tables[table] = sqliteRows(table); } catch { tables[table] = []; } }
  return { version: 2, tables, capturedAt: new Date().toISOString() };
}
async function writeRows(client, table, rows) {
  for (const row of rows) {
    const columns = Object.keys(row); if (!columns.length) continue;
    await client.query(`INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})`, columns.map((c) => row[c]));
  }
}
async function snapshotNow(reason = "runtime") {
  if (!marketplacePersistenceConfigured()) return { ok: false, skipped: true, reason: "not_configured" };
  if (syncPromise) { dirty = true; return syncPromise; }
  syncPromise = (async () => {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await ensureRemoteSchema(client);
      const snapshots = new Map(MARKET_TABLES.map((table) => [table, sqliteRows(table)]));
      for (const table of MARKET_CHILD_FIRST) await client.query(`DELETE FROM ${quoteIdent(table)}`);
      for (const table of MARKET_TABLES) await writeRows(client, table, snapshots.get(table) || []);
      await client.query(`INSERT INTO cardoria_runtime_snapshot (id,payload,updated_at) VALUES ('primary',$1::jsonb,NOW()) ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()`, [JSON.stringify(runtimePayload())]);
      await client.query(`INSERT INTO marketplace_sync_meta (id,initialized,last_synced_at,source) VALUES ('primary',TRUE,NOW(),$1) ON CONFLICT (id) DO UPDATE SET initialized=TRUE,last_synced_at=NOW(),source=EXCLUDED.source`, [reason]);
      await client.query("COMMIT");
      lastError = ""; lastSyncedAt = new Date().toISOString(); initialized = true;
      return { ok: true, reason, lastSyncedAt };
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      lastError = error?.message || String(error); console.error("[cardoria-persistence] snapshot:", lastError); throw error;
    } finally { client.release(); }
  })();
  try { return await syncPromise; }
  finally { syncPromise = null; if (dirty) { dirty = false; scheduleMarketplaceSnapshot("queued-change", 100); } }
}
async function snapshotEngineNow(reason = "engine") {
  if (!marketplacePersistenceConfigured()) return { ok: false, skipped: true, reason: "not_configured" };
  if (engineSyncPromise) { engineDirty = true; return engineSyncPromise; }
  engineSyncPromise = (async () => {
    const client = await getPool().connect();
    try {
      await ensureRemoteSchema(client);
      await client.query(`INSERT INTO cardoria_engine_snapshot (id,payload,updated_at) VALUES ('primary',$1::jsonb,NOW()) ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()`, [JSON.stringify(enginePayload())]);
      engineLastError = "";
      engineLastSyncedAt = new Date().toISOString();
      return { ok: true, reason, lastSyncedAt: engineLastSyncedAt };
    } catch (error) {
      engineLastError = error?.message || String(error);
      console.error("[cardoria-engine-persistence] snapshot:", engineLastError);
      throw error;
    } finally { client.release(); }
  })();
  try { return await engineSyncPromise; }
  finally { engineSyncPromise = null; if (engineDirty) { engineDirty = false; scheduleEngineSnapshot("queued-engine-change", 150); } }
}
function restoreRuntime(payload) {
  if (!payload || typeof payload !== "object") return;
  const sqlite = getDb(); sqlite.pragma("foreign_keys = OFF");
  const tx = sqlite.transaction(() => {
    ["auth_sessions","auth_reset_tokens","auth_magic_tokens","gdpr_consents","pay_transactions","auth_users"].forEach((table) => { try { sqlite.prepare(`DELETE FROM ${quoteIdent(table)}`).run(); } catch {} });
    for (const table of RUNTIME_TABLES) {
      for (const row of payload.tables?.[table] || []) {
        const cols = Object.keys(row); if (!cols.length) continue;
        sqlite.prepare(`INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c]));
      }
    }
  });
  tx(); sqlite.pragma("foreign_keys = ON");
  if (Array.isArray(payload.boutiqueOrders)) writeJson("orders", payload.boutiqueOrders);
}
function restoreEngine(payload) {
  if (!payload || typeof payload !== "object") return false;
  const sqlite = getDb(); sqlite.pragma("foreign_keys = OFF");
  const tx = sqlite.transaction(() => {
    for (const table of ENGINE_CHILD_FIRST) { try { sqlite.prepare(`DELETE FROM ${quoteIdent(table)}`).run(); } catch {} }
    for (const table of ENGINE_TABLES) {
      for (const row of payload.tables?.[table] || []) {
        const cols = Object.keys(row); if (!cols.length) continue;
        try { sqlite.prepare(`INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c])); } catch {}
      }
    }
  });
  tx(); sqlite.pragma("foreign_keys = ON");
  try { sqlite.exec("DELETE FROM cards_fts; INSERT INTO cards_fts(rowid,name,extension,number,rarity,license_slug) SELECT rowid,name,extension,number,rarity,license_slug FROM cards;"); } catch {}
  return true;
}
async function restoreFromPostgres() {
  const client = await getPool().connect();
  try {
    await ensureRemoteSchema(client);
    const meta = await client.query("SELECT initialized,last_synced_at FROM marketplace_sync_meta WHERE id='primary' LIMIT 1");
    if (!meta.rows[0]?.initialized) return { restored: false, engineRestored: false };
    const payload = new Map();
    for (const table of MARKET_TABLES) payload.set(table, (await client.query(`SELECT * FROM ${quoteIdent(table)}`)).rows);
    const sqlite = getDb(); sqlite.pragma("foreign_keys = OFF");
    const restoreMarket = sqlite.transaction(() => {
      for (const table of MARKET_CHILD_FIRST) sqlite.prepare(`DELETE FROM ${quoteIdent(table)}`).run();
      for (const table of MARKET_TABLES) {
        for (const row of payload.get(table) || []) {
          const cols = Object.keys(row); if (!cols.length) continue;
          sqlite.prepare(`INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c]));
        }
      }
    });
    restoreMarket(); sqlite.pragma("foreign_keys = ON");
    const runtime = await client.query("SELECT payload FROM cardoria_runtime_snapshot WHERE id='primary' LIMIT 1");
    if (runtime.rows[0]?.payload) restoreRuntime(runtime.rows[0].payload);
    const engine = await client.query("SELECT payload,updated_at FROM cardoria_engine_snapshot WHERE id='primary' LIMIT 1");
    const engineRestored = engine.rows[0]?.payload ? restoreEngine(engine.rows[0].payload) : false;
    if (engine.rows[0]?.updated_at) engineLastSyncedAt = new Date(engine.rows[0].updated_at).toISOString();
    try { sqlite.exec("DELETE FROM mk_listings_fts; INSERT INTO mk_listings_fts(rowid,title,description,license_slug,card_condition) SELECT rowid,title,description,license_slug,card_condition FROM mk_listings;"); } catch {}
    lastSyncedAt = meta.rows[0].last_synced_at ? new Date(meta.rows[0].last_synced_at).toISOString() : ""; initialized = true; lastError = "";
    return { restored: true, engineRestored, lastSyncedAt };
  } finally { client.release(); }
}
export async function initMarketplacePersistence() {
  if (!marketplacePersistenceConfigured()) { console.log("[cardoria-persistence] disabled: MARKETPLACE_DATABASE_URL absente"); return { ok: true, configured: false }; }
  try {
    const restored = await restoreFromPostgres();
    if (restored.restored) {
      console.log(`[cardoria-persistence] marketplace + runtime restored from PostgreSQL${restored.engineRestored ? " + engine" : ""}`);
      return { ok: true, configured: true, restored: true, engineRestored: restored.engineRestored, lastSyncedAt: restored.lastSyncedAt };
    }
    const seeded = await snapshotNow("initial-sqlite-export");
    await snapshotEngineNow("initial-engine-export");
    console.log("[cardoria-persistence] PostgreSQL initialized from runtime + engine");
    return { ok: true, configured: true, restored: false, engineRestored: false, initialized: seeded.ok };
  } catch (error) { lastError = error?.message || String(error); console.error("[cardoria-persistence] init degraded:", lastError); return { ok: false, configured: true, error: lastError }; }
}
export function scheduleMarketplaceSnapshot(reason = "api-write", delayMs = 150) {
  if (!marketplacePersistenceConfigured()) return;
  dirty = true; if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => { syncTimer = null; if (!dirty) return; dirty = false; try { await snapshotNow(reason); } catch {} }, Math.max(0, Number(delayMs) || 0)); syncTimer.unref?.();
}
export function scheduleEngineSnapshot(reason = "engine-write", delayMs = 300) {
  if (!marketplacePersistenceConfigured()) return;
  engineDirty = true; if (engineSyncTimer) clearTimeout(engineSyncTimer);
  engineSyncTimer = setTimeout(async () => { engineSyncTimer = null; if (!engineDirty) return; engineDirty = false; try { await snapshotEngineNow(reason); } catch {} }, Math.max(0, Number(delayMs) || 0)); engineSyncTimer.unref?.();
}
export function marketplacePersistenceMiddleware(req, res, next) {
  if (["POST","PUT","PATCH","DELETE"].includes(String(req.method || "GET").toUpperCase())) res.on("finish", () => { if (res.statusCode < 500) scheduleMarketplaceSnapshot(`${req.method} ${req.path || ""}`); });
  next();
}
export function enginePersistenceMiddleware(req, res, next) {
  if (["POST","PUT","PATCH","DELETE"].includes(String(req.method || "GET").toUpperCase())) res.on("finish", () => { if (res.statusCode < 500) scheduleEngineSnapshot(`${req.method} ${req.path || ""}`); });
  next();
}
export async function flushMarketplacePersistence(reason = "shutdown") {
  if (!marketplacePersistenceConfigured()) return { ok: true, skipped: true };
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; } dirty = false;
  try { return { ok: true, ...(await snapshotNow(reason)) }; } catch (error) { return { ok: false, error: error?.message || String(error) }; }
}
export async function flushEnginePersistence(reason = "engine-flush") {
  if (!marketplacePersistenceConfigured()) return { ok: true, skipped: true };
  if (engineSyncTimer) { clearTimeout(engineSyncTimer); engineSyncTimer = null; } engineDirty = false;
  try { return { ok: true, ...(await snapshotEngineNow(reason)) }; } catch (error) { return { ok: false, error: error?.message || String(error) }; }
}
export function getMarketplacePersistenceStatus() { return { configured: marketplacePersistenceConfigured(), initialized, syncing: Boolean(syncPromise), dirty, lastSyncedAt, lastError: lastError ? "sync_error" : "" }; }
export function getEnginePersistenceStatus() { return { configured: marketplacePersistenceConfigured(), syncing: Boolean(engineSyncPromise), dirty: engineDirty, lastSyncedAt: engineLastSyncedAt, lastError: engineLastError ? "sync_error" : "" }; }
export async function closeMarketplacePersistence() {
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
  if (engineSyncTimer) { clearTimeout(engineSyncTimer); engineSyncTimer = null; }
  if (!pool) return;
  const current = pool; pool = null; await current.end();
}
