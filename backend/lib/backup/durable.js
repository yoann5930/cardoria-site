import crypto from "crypto";
import pg from "pg";
import { getDb } from "../engine/database.js";
import { readJson, writeJson } from "../storage.js";
import { logAudit } from "../audit.js";

const { Pool } = pg;
let pool;

const MARKET_TABLES = ["mk_sellers","mk_listings","mk_orders","mk_reviews","mk_favorites","mk_wishlist","mk_price_alerts","mk_cart_items","mk_invoices","mk_disputes"];
const RUNTIME_TABLES = ["auth_users","auth_sessions","auth_reset_tokens","auth_magic_tokens","gdpr_consents","pay_transactions"];
const ENGINE_TABLES = ["licenses","cards","price_sources","sales_history","card_price_history","sealed_products"];
const SECURITY_EPHEMERAL_TABLES = new Set(["auth_sessions", "auth_reset_tokens", "auth_magic_tokens"]);
const CHILD_FIRST = ["mk_disputes","mk_invoices","mk_cart_items","mk_price_alerts","mk_wishlist","mk_favorites","mk_reviews","mk_orders","mk_listings","mk_sellers","card_price_history","sales_history","price_sources","cards","sealed_products","licenses","pay_transactions","gdpr_consents","auth_magic_tokens","auth_reset_tokens","auth_sessions","auth_users"];

function databaseUrl() {
  return String(process.env.MARKETPLACE_DATABASE_URL || "").trim();
}

export function durableBackupConfigured() {
  return Boolean(databaseUrl());
}

function getPool() {
  if (pool) return pool;
  if (!databaseUrl()) throw Object.assign(new Error("Sauvegardes durables non configurees."), { status: 503 });
  pool = new Pool({ connectionString: databaseUrl(), max: 2, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  return pool;
}

function quoteIdent(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("Identifiant SQL invalide");
  return `"${name}"`;
}

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS cardoria_backups (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      payload JSONB NOT NULL,
      size_bytes BIGINT NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT ''
    )
  `);
  await client.query("CREATE INDEX IF NOT EXISTS idx_cardoria_backups_created_at ON cardoria_backups(created_at DESC)");
}

function sqliteRows(table) {
  try { return getDb().prepare(`SELECT * FROM ${quoteIdent(table)}`).all(); }
  catch { return []; }
}

function snapshotPayload() {
  const tables = {};
  [...MARKET_TABLES, ...RUNTIME_TABLES, ...ENGINE_TABLES].forEach((table) => {
    tables[table] = sqliteRows(table);
  });
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    tables,
    json: {
      orders: readJson("orders", []),
      purchases: readJson("purchases", []),
      rachatProposals: readJson("rachat-proposals", []),
      estimations: readJson("estimations", []),
      settings: readJson("settings", {}),
      analytics: readJson("site-analytics.json", {}),
      attribution: readJson("witnot-attribution", {})
    }
  };
}

function backupId() {
  return `bkp_${new Date().toISOString().replace(/[:.]/g, "-")}_${crypto.randomBytes(4).toString("hex")}`;
}

function summarize(row) {
  return {
    id: row.id,
    label: row.label,
    createdBy: row.created_by,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    sizeBytes: Number(row.size_bytes || 0),
    sha256: row.sha256,
    mode: "durable-postgresql"
  };
}

export async function createDurableBackup({ label = "", actor = "system" } = {}) {
  const payload = snapshotPayload();
  const serialized = JSON.stringify(payload);
  const id = backupId();
  const sha256 = crypto.createHash("sha256").update(serialized).digest("hex");
  const client = await getPool().connect();
  try {
    await ensureSchema(client);
    const result = await client.query(
      "INSERT INTO cardoria_backups (id,label,created_by,payload,size_bytes,sha256) VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING id,label,created_by,created_at,size_bytes,sha256",
      [id, String(label || "").slice(0, 160), String(actor || "system").slice(0, 160), serialized, Buffer.byteLength(serialized), sha256]
    );
    logAudit({ type: "backup", action: "durable_create", user: actor, detail: id });
    return summarize(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function listDurableBackups(limit = 30) {
  if (!durableBackupConfigured()) return [];
  const client = await getPool().connect();
  try {
    await ensureSchema(client);
    const result = await client.query("SELECT id,label,created_by,created_at,size_bytes,sha256 FROM cardoria_backups ORDER BY created_at DESC LIMIT $1", [Math.max(1, Math.min(100, Number(limit) || 30))]);
    return result.rows.map(summarize);
  } finally {
    client.release();
  }
}

export async function inspectDurableBackup(id) {
  if (!/^bkp_[A-Za-z0-9._-]{12,180}$/.test(String(id || ""))) throw Object.assign(new Error("Identifiant de sauvegarde invalide"), { status: 400 });
  const client = await getPool().connect();
  try {
    await ensureSchema(client);
    const result = await client.query("SELECT id,label,created_by,created_at,size_bytes,sha256,payload FROM cardoria_backups WHERE id=$1 LIMIT 1", [id]);
    if (!result.rows[0]) throw Object.assign(new Error("Sauvegarde introuvable"), { status: 404 });
    const row = result.rows[0];
    const serialized = JSON.stringify(row.payload);
    const sha256 = crypto.createHash("sha256").update(serialized).digest("hex");
    if (row.sha256 && row.sha256 !== sha256) throw Object.assign(new Error("Integrite de la sauvegarde invalide"), { status: 422 });
    return { ...summarize(row), payload: row.payload, integrityOk: true };
  } finally {
    client.release();
  }
}

async function writeRows(client, table, rows) {
  for (const row of rows || []) {
    const columns = Object.keys(row);
    if (!columns.length) continue;
    await client.query(`INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(",")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(",")})`, columns.map((column) => row[column]));
  }
}

function restoreLocalFromPayload(payload, preservedSuperAdmins) {
  const db = getDb();
  const allTables = [...MARKET_TABLES, ...RUNTIME_TABLES, ...ENGINE_TABLES];
  db.pragma("foreign_keys = OFF");
  try {
    const tx = db.transaction(() => {
      CHILD_FIRST.forEach((table) => { try { db.prepare(`DELETE FROM ${quoteIdent(table)}`).run(); } catch {} });
      allTables.forEach((table) => {
        if (SECURITY_EPHEMERAL_TABLES.has(table)) return;
        let rows = Array.isArray(payload.tables?.[table]) ? payload.tables[table] : [];
        if (table === "auth_users" && preservedSuperAdmins.length) rows = rows.filter((row) => row.role !== "super_admin").concat(preservedSuperAdmins);
        rows.forEach((row) => {
          const columns = Object.keys(row);
          if (!columns.length) return;
          try { db.prepare(`INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map((column) => row[column])); } catch {}
        });
      });
    });
    tx();
  } finally {
    db.pragma("foreign_keys = ON");
  }
  try { db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')"); } catch {}
  try { db.exec("INSERT INTO mk_listings_fts(mk_listings_fts) VALUES('rebuild')"); } catch {}
  if (Array.isArray(payload.json?.orders)) writeJson("orders", payload.json.orders);
  if (Array.isArray(payload.json?.purchases)) writeJson("purchases", payload.json.purchases);
  if (Array.isArray(payload.json?.rachatProposals)) writeJson("rachat-proposals", payload.json.rachatProposals);
  if (Array.isArray(payload.json?.estimations)) writeJson("estimations", payload.json.estimations);
  if (payload.json?.settings && typeof payload.json.settings === "object") writeJson("settings", payload.json.settings);
  if (payload.json?.analytics && typeof payload.json.analytics === "object") writeJson("site-analytics.json", payload.json.analytics);
  if (payload.json?.attribution && typeof payload.json.attribution === "object") writeJson("witnot-attribution", payload.json.attribution);
}

export async function restoreDurableBackup(id, { actor = "admin", dryRun = false } = {}) {
  const backup = await inspectDurableBackup(id);
  const payload = backup.payload;
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      backup: { id: backup.id, createdAt: backup.createdAt, label: backup.label, sizeBytes: backup.sizeBytes, integrityOk: true },
      security: { sessionsWillBePurged: true, currentSuperAdminsWillBePreserved: true },
      tables: Object.fromEntries(Object.entries(payload.tables || {}).map(([table, rows]) => [table, Array.isArray(rows) ? rows.length : 0]))
    };
  }

  const preservedSuperAdmins = sqliteRows("auth_users").filter((row) => row.role === "super_admin" && Number(row.active || 0) === 1);
  const preRestore = await createDurableBackup({ label: `pre-restore-${id}`, actor });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await ensureSchema(client);
    for (const table of MARKET_TABLES.slice().reverse()) await client.query(`DELETE FROM ${quoteIdent(table)}`);
    for (const table of MARKET_TABLES) await writeRows(client, table, payload.tables?.[table] || []);

    const runtimePayload = {
      version: 2,
      tables: Object.fromEntries(RUNTIME_TABLES.map((table) => [table, SECURITY_EPHEMERAL_TABLES.has(table) ? [] : (payload.tables?.[table] || [])])),
      boutiqueOrders: payload.json?.orders || [],
      purchases: payload.json?.purchases || [],
      rachatProposals: payload.json?.rachatProposals || [],
      capturedAt: new Date().toISOString()
    };
    runtimePayload.tables.auth_users = (runtimePayload.tables.auth_users || []).filter((row) => row.role !== "super_admin").concat(preservedSuperAdmins);
    const enginePayload = { version: 4, tables: Object.fromEntries(ENGINE_TABLES.map((table) => [table, payload.tables?.[table] || []])), capturedAt: new Date().toISOString() };

    await client.query("INSERT INTO cardoria_runtime_snapshot (id,payload,updated_at) VALUES ('primary',$1::jsonb,NOW()) ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()", [JSON.stringify(runtimePayload)]);
    await client.query("INSERT INTO cardoria_engine_snapshot (id,payload,updated_at) VALUES ('primary',$1::jsonb,NOW()) ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()", [JSON.stringify(enginePayload)]);
    await client.query("INSERT INTO marketplace_sync_meta (id,initialized,last_synced_at,source) VALUES ('primary',TRUE,NOW(),'admin-backup-restore') ON CONFLICT (id) DO UPDATE SET initialized=TRUE,last_synced_at=NOW(),source=EXCLUDED.source");
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }

  restoreLocalFromPayload(payload, preservedSuperAdmins);
  logAudit({ type: "backup", action: "durable_restore", user: actor, detail: `${id};pre=${preRestore.id}` });
  return { ok: true, restored: id, preRestoreId: preRestore.id, requiresReauth: true, integrityOk: true, superAdminsPreserved: preservedSuperAdmins.length };
}

export async function rotateDurableBackups(maxKeep = Number(process.env.BACKUP_MAX_KEEP || 14)) {
  if (!durableBackupConfigured()) return { ok: true, kept: 0, removed: 0, skipped: true };
  const keep = Math.max(2, Math.min(100, Number(maxKeep) || 14));
  const client = await getPool().connect();
  try {
    await ensureSchema(client);
    const ids = (await client.query("SELECT id FROM cardoria_backups ORDER BY created_at DESC OFFSET $1", [keep])).rows.map((row) => row.id);
    if (ids.length) await client.query("DELETE FROM cardoria_backups WHERE id = ANY($1::text[])", [ids]);
    return { ok: true, kept: keep, removed: ids.length };
  } finally {
    client.release();
  }
}
