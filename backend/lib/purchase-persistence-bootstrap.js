import fs from "fs";
import path from "path";
import pg from "pg";

const { Pool } = pg;
const dataDir = path.join(process.cwd(), "data");
const purchasesFile = path.join(dataDir, "purchases.json");
const url = String(process.env.MARKETPLACE_DATABASE_URL || "").trim();
const STARTUP_GUARD_MS = 60 * 1000;
const HISTORY_LIMIT = 50;
const INCIDENT_START = "2026-09-01T13:50:00.000Z";
const INCIDENT_LOSS = "2026-09-01T14:12:46.000Z";
const bootAt = Date.now();
let pool = null;
let timer = null;
let writing = false;
let queued = false;
let durablePurchases = [];
const status = {
  configured: Boolean(url), initialized: false, restored: false, remoteCount: null,
  localCount: 0, lastSavedCount: null, lastSavedAt: "", lastError: "", protectedOverwriteCount: 0
};

function getPool() {
  if (!url) return null;
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 2, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000, keepAlive: true });
    pool.on("error", (error) => {
      status.lastError = error?.message || String(error);
      console.warn("[purchase-persistence] idle pool connection", status.lastError);
    });
  }
  return pool;
}
function localPurchases() {
  try {
    if (!fs.existsSync(purchasesFile)) return [];
    const parsed = JSON.parse(fs.readFileSync(purchasesFile, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function writeLocal(purchases) {
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = purchasesFile + ".restore.tmp";
  fs.writeFileSync(tmp, JSON.stringify(Array.isArray(purchases) ? purchases : [], null, 2), "utf8");
  fs.renameSync(tmp, purchasesFile);
}
async function ensureSchema(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS cardoria_purchase_snapshot (id TEXT PRIMARY KEY,payload JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await client.query(`CREATE TABLE IF NOT EXISTS cardoria_purchase_snapshot_history (
    id BIGSERIAL PRIMARY KEY,
    payload JSONB NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_cardoria_purchase_snapshot_history_created_at ON cardoria_purchase_snapshot_history(created_at DESC)`);
}
async function withClient(fn) {
  const db = getPool();
  if (!db) return null;
  const client = await db.connect();
  const onError = (error) => {
    status.lastError = error?.message || String(error);
    console.warn("[purchase-persistence] active client", status.lastError);
  };
  client.on("error", onError);
  try { return await fn(client); }
  finally {
    client.off("error", onError);
    client.release();
  }
}
async function latestNonEmptyHistory(client) {
  const result = await client.query(`
    SELECT payload
    FROM cardoria_purchase_snapshot_history
    WHERE jsonb_typeof(payload->'purchases')='array'
      AND jsonb_array_length(payload->'purchases') > 0
    ORDER BY id DESC
    LIMIT 1
  `);
  const purchases = result.rows[0]?.payload?.purchases;
  return Array.isArray(purchases) ? purchases : [];
}
async function probeIncidentDurableBackups(client) {
  try {
    const exists = await client.query("SELECT to_regclass('public.cardoria_backups') AS table_name");
    if (!exists.rows[0]?.table_name) {
      console.log("[purchase-recovery-probe] durable backup table absent");
      return;
    }
    const incident = await client.query(`
      SELECT id,label,created_at,
        CASE WHEN jsonb_typeof(payload->'json'->'purchases')='array'
          THEN jsonb_array_length(payload->'json'->'purchases') ELSE 0 END AS purchase_count
      FROM cardoria_backups
      WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
      ORDER BY created_at DESC
      LIMIT 30
    `, [INCIDENT_START, INCIDENT_LOSS]);
    if (!incident.rows.length) console.log("[purchase-recovery-probe] no backup in incident window");
    for (const row of incident.rows) {
      console.log(`[purchase-recovery-probe] incident id=${row.id} created=${new Date(row.created_at).toISOString()} purchases=${Number(row.purchase_count || 0)} label=${String(row.label || "").slice(0, 80)}`);
    }
    const latest = await client.query(`
      SELECT id,label,created_at,jsonb_array_length(payload->'json'->'purchases') AS purchase_count
      FROM cardoria_backups
      WHERE created_at <= $1::timestamptz
        AND jsonb_typeof(payload->'json'->'purchases')='array'
        AND jsonb_array_length(payload->'json'->'purchases') > 0
      ORDER BY created_at DESC
      LIMIT 5
    `, [INCIDENT_LOSS]);
    if (!latest.rows.length) console.log("[purchase-recovery-probe] no non-empty durable backup before loss");
    for (const row of latest.rows) {
      console.log(`[purchase-recovery-probe] nonempty id=${row.id} created=${new Date(row.created_at).toISOString()} purchases=${Number(row.purchase_count || 0)} label=${String(row.label || "").slice(0, 80)}`);
    }
  } catch (error) {
    console.warn("[purchase-recovery-probe] failed", error?.message || String(error));
  }
}
async function saveSnapshot(client, purchases, reason) {
  const payload = {
    version: 2,
    purchases,
    capturedAt: new Date().toISOString(),
    reason
  };
  await client.query(
    "INSERT INTO cardoria_purchase_snapshot (id,payload,updated_at) VALUES ('primary',$1::jsonb,NOW()) ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()",
    [JSON.stringify(payload)]
  );
  await client.query(
    "INSERT INTO cardoria_purchase_snapshot_history (payload,reason,created_at) VALUES ($1::jsonb,$2,NOW())",
    [JSON.stringify(payload), String(reason || "")]
  );
  await client.query(`DELETE FROM cardoria_purchase_snapshot_history WHERE id NOT IN (SELECT id FROM cardoria_purchase_snapshot_history ORDER BY id DESC LIMIT $1)`, [HISTORY_LIMIT]);
}
async function restore() {
  const db = getPool();
  if (!db) { console.log("[purchase-persistence] disabled: MARKETPLACE_DATABASE_URL absente"); return; }
  await withClient(async (client) => {
    await ensureSchema(client);
    const remote = await client.query("SELECT payload, updated_at FROM cardoria_purchase_snapshot WHERE id='primary' LIMIT 1");
    if (remote.rows[0]?.payload && Array.isArray(remote.rows[0].payload.purchases)) {
      let purchases = remote.rows[0].payload.purchases;
      if (!purchases.length) {
        const historical = await latestNonEmptyHistory(client);
        if (historical.length) {
          purchases = historical;
          await saveSnapshot(client, purchases, "automatic-history-recovery");
          console.warn(`[purchase-persistence] recovered ${purchases.length} purchase(s) from durable history`);
        } else {
          await probeIncidentDurableBackups(client);
        }
      }
      durablePurchases = purchases.slice();
      writeLocal(purchases);
      Object.assign(status, { initialized: true, restored: true, remoteCount: purchases.length, localCount: purchases.length, lastError: "" });
      console.log(`[purchase-persistence] restored ${purchases.length} purchase(s) from PostgreSQL`);
      return;
    }
    const purchases = localPurchases();
    durablePurchases = purchases.slice();
    await saveSnapshot(client, purchases, "initial-local-export");
    Object.assign(status, { initialized: true, restored: false, remoteCount: purchases.length, localCount: purchases.length, lastSavedCount: purchases.length, lastSavedAt: new Date().toISOString(), lastError: "" });
    console.log(`[purchase-persistence] initialized PostgreSQL with ${purchases.length} local purchase(s)`);
  });
}
async function persist(reason = "storage-write") {
  const db = getPool();
  if (!db) return { ok: false, skipped: true, reason: "not_configured" };
  if (writing) { queued = true; return { ok: true, queued: true }; }
  writing = true;
  try {
    return await withClient(async (client) => {
      await ensureSchema(client);
      let purchases = localPurchases();
      const startupWindow = Date.now() - bootAt < STARTUP_GUARD_MS;
      if (startupWindow && durablePurchases.length > purchases.length) {
        const rejectedCount = purchases.length;
        purchases = durablePurchases.slice();
        writeLocal(purchases);
        status.protectedOverwriteCount += 1;
        status.localCount = purchases.length;
        status.remoteCount = durablePurchases.length;
        console.warn(`[purchase-persistence] blocked stale startup overwrite ${durablePurchases.length}->${rejectedCount}; restored durable purchases`);
        return { ok: true, protected: true, count: purchases.length };
      }
      await saveSnapshot(client, purchases, reason);
      durablePurchases = purchases.slice();
      Object.assign(status, { initialized: true, remoteCount: purchases.length, localCount: purchases.length, lastSavedCount: purchases.length, lastSavedAt: new Date().toISOString(), lastError: "" });
      console.log(`[purchase-persistence] saved ${purchases.length} purchase(s) (${reason})`);
      return { ok: true, count: purchases.length };
    });
  } catch (error) {
    status.lastError = error?.message || String(error);
    console.error("[purchase-persistence] save failed", status.lastError);
    return { ok: false, error: status.lastError };
  } finally {
    writing = false;
    if (queued) { queued = false; schedule("queued-write", 50); }
  }
}
function schedule(reason, delay = 120) {
  if (!url) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; persist(reason).catch(() => {}); }, delay);
  timer.unref?.();
}
process.on("cardoria:storage-write", (key) => { if (String(key) === "purchases") schedule("purchases-write"); });
try { await restore(); }
catch (error) { status.lastError = error?.message || String(error); console.error("[purchase-persistence] restore failed", status.lastError); }

export function getPurchasePersistenceStatus() {
  const localCount = localPurchases().length; status.localCount = localCount;
  return {
    configured: status.configured,
    initialized: status.initialized,
    restored: status.restored,
    remoteCount: status.remoteCount,
    localCount,
    countsMatch: status.remoteCount !== null && status.remoteCount === localCount,
    lastSavedCount: status.lastSavedCount,
    lastSavedAt: status.lastSavedAt,
    protectedOverwriteCount: status.protectedOverwriteCount,
    lastError: status.lastError ? "persistence_error" : ""
  };
}
export async function flushPurchasePersistence(reason = "manual-flush") {
  if (timer) { clearTimeout(timer); timer = null; }
  const result = await persist(reason);
  return { ...result, status: getPurchasePersistenceStatus() };
}
async function close() {
  if (timer) { clearTimeout(timer); timer = null; }
  try { await persist("shutdown"); } catch {}
  if (pool) { const current = pool; pool = null; try { await current.end(); } catch {} }
}
process.once("SIGTERM", () => { close().finally(() => process.exit(0)); });
process.once("SIGINT", () => { close().finally(() => process.exit(0)); });
