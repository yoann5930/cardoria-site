/**
 * Couche PostgreSQL — préparée pour migration production.
 * Activer avec DATABASE_URL + USE_POSTGRES=true
 */
let pool = null;

export async function getPgPool() {
  if (process.env.USE_POSTGRES !== "true" || !process.env.DATABASE_URL) {
    return null;
  }
  if (pool) return pool;
  try {
    const pg = await import("pg");
    pool = new pg.default.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PG_SSL === "false" ? false : { rejectUnauthorized: false },
      max: Number(process.env.PG_POOL_MAX || 10)
    });
    return pool;
  } catch (e) {
    console.warn("[Cardoria] PostgreSQL non disponible — SQLite actif.", e.message);
    return null;
  }
}

export async function pgHealthCheck() {
  const p = await getPgPool();
  if (!p) return { ok: false, configured: false };
  try {
    await p.query("SELECT 1");
    return { ok: true, configured: true };
  } catch (e) {
    return { ok: false, configured: true, error: e.message };
  }
}
