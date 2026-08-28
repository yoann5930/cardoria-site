import pg from "pg";
import { getDb } from "../engine/database.js";
import { cleanupProductionDemoData } from "../production-demo-cleanup.js";
import { flushPurchasePersistence } from "../purchase-persistence-bootstrap.js";
import { flushMarketplacePersistence, flushEnginePersistence } from "./persistence.js";

const { Pool } = pg;
const MIGRATION_ID = "empty-public-catalog-v1";

function databaseUrl() { return String(process.env.MARKETPLACE_DATABASE_URL || "").trim(); }

/**
 * Vide une seule fois toutes les annonces Marketplace déjà présentes en production,
 * puis retire à chaque démarrage les données explicitement marquées demo/test.
 */
export async function emptyPublicCatalogOnce() {
  const url = databaseUrl();
  if (!url) return { ok: true, skipped: true, reason: "database_not_configured" };

  const pool = new Pool({ connectionString: url, max: 1, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  let applied = false;
  let alreadyApplied = false;

  try {
    await client.query(`CREATE TABLE IF NOT EXISTS cardoria_maintenance_migrations (id TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const existing = await client.query("SELECT id FROM cardoria_maintenance_migrations WHERE id = $1 LIMIT 1", [MIGRATION_ID]);
    alreadyApplied = Boolean(existing.rowCount);
    if (!alreadyApplied) {
      await client.query("BEGIN");
      await client.query("UPDATE mk_listings SET status = 'removed', stock = 0");
      await client.query("INSERT INTO cardoria_maintenance_migrations (id) VALUES ($1)", [MIGRATION_ID]);
      await client.query("COMMIT");
      applied = true;
    }
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  if (applied) {
    const db = getDb();
    db.prepare("UPDATE mk_listings SET status = 'removed', stock = 0, updated_at = ?").run(new Date().toISOString());
    try { db.exec("DELETE FROM mk_listings_fts;"); } catch {}
  }

  const cleanup = cleanupProductionDemoData();
  const changedMarketplace = applied || cleanup.demoUsers > 0 || cleanup.demoSellers > 0 || cleanup.demoListings > 0 || cleanup.relatedRows > 0;
  const changedEngine = cleanup.demoCards > 0;
  const changedPurchases = cleanup.demoPurchases > 0;

  const results = [];
  if (changedPurchases) results.push(await flushPurchasePersistence("production-demo-cleanup"));
  if (changedMarketplace) results.push(await flushMarketplacePersistence("production-demo-cleanup"));
  if (changedEngine) results.push(await flushEnginePersistence("production-demo-cleanup"));
  const persistenceOk = results.every((result) => result?.ok !== false);
  if (!persistenceOk) throw new Error("Nettoyage demo effectué mais persistance incomplète.");

  console.log(`[startup] production-demo-cleanup: ok users=${cleanup.demoUsers} sellers=${cleanup.demoSellers} listings=${cleanup.demoListings} cards=${cleanup.demoCards} purchases=${cleanup.demoPurchases}`);
  return { ok: true, applied, alreadyApplied, cleanup, persistenceOk };
}
