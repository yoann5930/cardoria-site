import pg from "pg";

const { Client } = pg;
const databaseUrl = String(process.env.MARKETPLACE_DATABASE_URL || "").trim();

async function migrateRemoteModerationSchema() {
  if (!databaseUrl) return { ok: true, skipped: true };
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query(`
      ALTER TABLE IF EXISTS mk_listings ADD COLUMN IF NOT EXISTS moderation_locked INTEGER DEFAULT 0;
      ALTER TABLE IF EXISTS mk_listings ADD COLUMN IF NOT EXISTS moderation_reason TEXT DEFAULT '';
      ALTER TABLE IF EXISTS mk_listings ADD COLUMN IF NOT EXISTS moderated_by TEXT DEFAULT '';
      ALTER TABLE IF EXISTS mk_listings ADD COLUMN IF NOT EXISTS moderated_at TEXT DEFAULT '';
      ALTER TABLE IF EXISTS mk_disputes ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';
      ALTER TABLE IF EXISTS mk_disputes ADD COLUMN IF NOT EXISTS resolution_code TEXT DEFAULT '';
      ALTER TABLE IF EXISTS mk_disputes ADD COLUMN IF NOT EXISTS admin_note TEXT DEFAULT '';
      ALTER TABLE IF EXISTS mk_disputes ADD COLUMN IF NOT EXISTS history_json TEXT DEFAULT '[]';
      ALTER TABLE IF EXISTS mk_disputes ADD COLUMN IF NOT EXISTS resolved_by TEXT DEFAULT '';
      ALTER TABLE IF EXISTS mk_disputes ADD COLUMN IF NOT EXISTS resolved_at TEXT DEFAULT '';
    `);
    console.log("[marketplace-moderation] durable schema ready");
    return { ok: true };
  } catch (error) {
    console.error("[marketplace-moderation] durable schema migration skipped:", error?.message || String(error));
    return { ok: false, error: error?.message || String(error) };
  } finally {
    try { await client.end(); } catch {}
  }
}

await migrateRemoteModerationSchema();

export { migrateRemoteModerationSchema };
