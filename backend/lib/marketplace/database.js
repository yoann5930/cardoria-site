/**
 * Base de données dédiée Marketplace.
 *
 * - Production persistante : PostgreSQL/Neon via MARKETPLACE_DATABASE_URL ou DATABASE_URL.
 * - Secours/local : SQLite historique Cardoria.
 *
 * Aucun secret n'est journalisé par ce module.
 */
import pg from "pg";
import { getDb as getSqliteDb } from "../engine/database.js";

const { Pool } = pg;
let pool = null;

function connectionString() {
  return String(process.env.MARKETPLACE_DATABASE_URL || process.env.DATABASE_URL || "").trim();
}

export function marketplaceDatabaseKind() {
  return connectionString() ? "postgres" : "sqlite";
}

export function marketplaceUsesPostgres() {
  return marketplaceDatabaseKind() === "postgres";
}

function getPool() {
  if (pool) return pool;
  const url = connectionString();
  if (!url) throw new Error("URL PostgreSQL Marketplace absente.");

  pool = new Pool({
    connectionString: url,
    max: Math.max(1, Number(process.env.MARKETPLACE_DB_POOL_MAX) || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  });

  pool.on("error", (error) => {
    console.error("[marketplace-db] connexion PostgreSQL interrompue:", error?.message || String(error));
  });
  return pool;
}

/** Convertit les placeholders SQLite ? en $1, $2... sans toucher aux chaînes SQL. */
export function toPostgresSql(sql) {
  let out = "";
  let index = 0;
  let single = false;
  let double = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const prev = sql[i - 1];

    if (ch === "'" && !double && prev !== "\\") {
      if (single && sql[i + 1] === "'") {
        out += "''";
        i += 1;
        continue;
      }
      single = !single;
      out += ch;
      continue;
    }
    if (ch === '"' && !single && prev !== "\\") {
      double = !double;
      out += ch;
      continue;
    }
    if (ch === "?" && !single && !double) {
      index += 1;
      out += `$${index}`;
      continue;
    }
    out += ch;
  }
  return out;
}

function scopedPostgres(client) {
  return {
    kind: "postgres",
    async get(sql, params = []) {
      const result = await client.query(toPostgresSql(sql), params);
      return result.rows[0] || null;
    },
    async all(sql, params = []) {
      const result = await client.query(toPostgresSql(sql), params);
      return result.rows;
    },
    async run(sql, params = []) {
      const result = await client.query(toPostgresSql(sql), params);
      return { changes: result.rowCount || 0, rowCount: result.rowCount || 0, rows: result.rows || [] };
    },
    async exec(sql) {
      return client.query(sql);
    }
  };
}

function sqliteAdapter() {
  const sqlite = getSqliteDb();
  return {
    kind: "sqlite",
    async get(sql, params = []) {
      return sqlite.prepare(sql).get(...params) || null;
    },
    async all(sql, params = []) {
      return sqlite.prepare(sql).all(...params);
    },
    async run(sql, params = []) {
      return sqlite.prepare(sql).run(...params);
    },
    async exec(sql) {
      return sqlite.exec(sql);
    }
  };
}

export function marketplaceDb() {
  if (!marketplaceUsesPostgres()) return sqliteAdapter();
  return scopedPostgres(getPool());
}

export async function withMarketplaceTransaction(fn) {
  if (!marketplaceUsesPostgres()) {
    const db = sqliteAdapter();
    await db.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn(db);
      await db.exec("COMMIT");
      return result;
    } catch (error) {
      try { await db.exec("ROLLBACK"); } catch { /* ignore rollback error */ }
      throw error;
    }
  }

  const client = await getPool().connect();
  const db = scopedPostgres(client);
  try {
    await client.query("BEGIN");
    const result = await fn(db);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* ignore rollback error */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyMarketplaceDatabase() {
  const db = marketplaceDb();
  const row = await db.get("SELECT 1 AS ok");
  return { ok: Number(row?.ok) === 1, kind: db.kind };
}

export async function closeMarketplaceDatabase() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
