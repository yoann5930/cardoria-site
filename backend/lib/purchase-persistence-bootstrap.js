import fs from "fs";
import path from "path";
import pg from "pg";

const { Pool } = pg;
const dataDir = path.join(process.cwd(), "data");
const purchasesFile = path.join(dataDir, "purchases.json");
const url = String(process.env.MARKETPLACE_DATABASE_URL || "").trim();
let pool = null;
let timer = null;
let writing = false;
let queued = false;
const status = {
  configured: Boolean(url), initialized: false, restored: false, remoteCount: null,
  localCount: 0, lastSavedCount: null, lastSavedAt: "", lastError: ""
};

function getPool() {
  if (!url) return null;
  if (!pool) pool = new Pool({ connectionString: url, max: 2, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
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
}
async function restore() {
  const db = getPool();
  if (!db) { console.log("[purchase-persistence] disabled: MARKETPLACE_DATABASE_URL absente"); return; }
  const client = await db.connect();
  try {
    await ensureSchema(client);
    const remote = await client.query("SELECT payload, updated_at FROM cardoria_purchase_snapshot WHERE id='primary' LIMIT 1");
    if (remote.rows[0]?.payload && Array.isArray(remote.rows[0].payload.purchases)) {
      const purchases = remote.rows[0].payload.purchases;
      writeLocal(purchases);
      Object.assign(status, { initialized: true, restored: true, remoteCount: purchases.length, localCount: purchases.length, lastError: "" });
      console.log(`[purchase-persistence] restored ${purchases.length} purchase(s) from PostgreSQL`);
      return;
    }
    const purchases = localPurchases();
    await client.query("INSERT INTO cardoria_purchase_snapshot (id,payload,updated_at) VALUES ('primary',$1::jsonb,NOW()) ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()", [JSON.stringify({ version: 1, purchases, capturedAt: new Date().toISOString() })]);
    Object.assign(status, { initialized: true, restored: false, remoteCount: purchases.length, localCount: purchases.length, lastSavedCount: purchases.length, lastSavedAt: new Date().toISOString(), lastError: "" });
    console.log(`[purchase-persistence] initialized PostgreSQL with ${purchases.length} local purchase(s)`);
  } catch (error) { status.lastError = error?.message || String(error); throw error; }
  finally { client.release(); }
}
async function persist(reason = "storage-write") {
  const db = getPool();
  if (!db) return { ok: false, skipped: true, reason: "not_configured" };
  if (writing) { queued = true; return { ok: true, queued: true }; }
  writing = true;
  const client = await db.connect();
  try {
    await ensureSchema(client);
    const purchases = localPurchases();
    await client.query("INSERT INTO cardoria_purchase_snapshot (id,payload,updated_at) VALUES ('primary',$1::jsonb,NOW()) ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()", [JSON.stringify({ version: 1, purchases, capturedAt: new Date().toISOString(), reason })]);
    Object.assign(status, { initialized: true, remoteCount: purchases.length, localCount: purchases.length, lastSavedCount: purchases.length, lastSavedAt: new Date().toISOString(), lastError: "" });
    console.log(`[purchase-persistence] saved ${purchases.length} purchase(s) (${reason})`);
    return { ok: true, count: purchases.length };
  } catch (error) {
    status.lastError = error?.message || String(error);
    console.error("[purchase-persistence] save failed", status.lastError);
    return { ok: false, error: status.lastError };
  } finally {
    client.release(); writing = false;
    if (queued) { queued = false; schedule("queued-write", 50); }
  }
}
function schedule(reason, delay = 120) {
  if (!url) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; persist(reason); }, delay);
  timer.unref?.();
}
process.on("cardoria:storage-write", (key) => { if (String(key) === "purchases") schedule("purchases-write"); });
try { await restore(); }
catch (error) { status.lastError = error?.message || String(error); console.error("[purchase-persistence] restore failed", status.lastError); }

export function getPurchasePersistenceStatus() {
  const localCount = localPurchases().length; status.localCount = localCount;
  return { configured: status.configured, initialized: status.initialized, restored: status.restored, remoteCount: status.remoteCount, localCount, countsMatch: status.remoteCount !== null && status.remoteCount === localCount, lastSavedCount: status.lastSavedCount, lastSavedAt: status.lastSavedAt, lastError: status.lastError ? "persistence_error" : "" };
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
