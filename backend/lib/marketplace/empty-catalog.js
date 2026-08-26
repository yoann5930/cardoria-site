import pg from "pg";
import { getDb } from "../engine/database.js";

const { Pool } = pg;
const MIGRATION_ID = "empty-public-catalog-v1";

function databaseUrl() {
  return String(process.env.MARKETPLACE_DATABASE_URL || "").trim();
}

/**
 * Vide une seule fois toutes les annonces Marketplace déjà présentes en production.
 * Les commandes et vendeurs sont conservés. Les nouvelles annonces créées ensuite
 * ne sont pas touchées grâce au marqueur de migration PostgreSQL.
 */
export async function emptyPublicCatalogOnce() {
  const url = databaseUrl();
  if (!url) return { ok: true, skipped: true, reason: "database_not_configured" };

  const pool = new Pool({
    connectionString: url,
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000
  });
  const client = await pool.connect();
  let applied = false;

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS cardoria_maintenance_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const existing = await client.query(
      "SELECT id FROM cardoria_maintenance_migrations WHERE id = $1 LIMIT 1",
      [MIGRATION_ID]
    );
    if (existing.rowCount) return { ok: true, applied: false, alreadyApplied: true };

    await client.query("BEGIN");
    await client.query("UPDATE mk_listings SET status = 'removed', stock = 0");
    await client.query(
      "INSERT INTO cardoria_maintenance_migrations (id) VALUES ($1)",
      [MIGRATION_ID]
    );
    await client.query("COMMIT");
    applied = true;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  if (applied) {
    const db = getDb();
    db.prepare("UPDATE mk_listings SET status = 'removed', stock = 0, updated_at = ?")
      .run(new Date().toISOString());
    try { db.exec("DELETE FROM mk_listings_fts;"); } catch {}
  }

  return { ok: true, applied };
}
