import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, "../sql/marketplace-postgres.sql");
const connectionString = String(process.env.MARKETPLACE_DATABASE_URL || process.env.DATABASE_URL || "").trim();

if (!connectionString) {
  console.error("MARKETPLACE_DATABASE_URL ou DATABASE_URL est requis.");
  process.exit(1);
}

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });

try {
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
  const check = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'mk_%') AS marketplace_tables,
      current_database() AS database_name
  `);
  console.log(JSON.stringify({
    ok: true,
    marketplaceTables: Number(check.rows[0]?.marketplace_tables || 0),
    databaseName: check.rows[0]?.database_name || ""
  }, null, 2));
} catch (error) {
  console.error("Initialisation PostgreSQL Marketplace impossible:", error?.message || String(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
