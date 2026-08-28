import assert from "node:assert/strict";
import { getDb } from "../lib/engine/database.js";
import { migrateAuth } from "../lib/auth/migrate.js";
import { createFullBackup, listBackups, restoreBackup } from "../lib/backup/full.js";

migrateAuth();
const db = getDb();
const stamp = Date.now().toString(36);
const licenseSlug = `backup-e2e-${stamp}`;
const userId = `usr_backup_${stamp}`;
const sessionId = `ses_backup_${stamp}`;
const tokenHash = `hash_backup_${stamp}`;
const now = new Date().toISOString();
const expires = new Date(Date.now() + 3600000).toISOString();

try {
  db.prepare("INSERT INTO licenses (slug,name,icon,description,active,sort_order,created_at) VALUES (?,?,?,?,1,0,?)")
    .run(licenseSlug, "Backup Original", "T", "system backup e2e", now);

  db.prepare("INSERT INTO auth_users (id,email,password_hash,role,name,totp_secret,totp_enabled,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)")
    .run(userId, `backup-${stamp}@example.test`, "test-hash", "client", "Backup Client", "", 0, now, now);
  db.prepare("INSERT INTO auth_sessions (id,user_id,token_hash,expires_at,ip,user_agent,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(sessionId, userId, tokenHash, expires, "127.0.0.1", "system-backup-e2e", now);

  const superAdmin = db.prepare("SELECT * FROM auth_users WHERE role='super_admin' AND active=1 ORDER BY created_at LIMIT 1").get();
  assert.ok(superAdmin, "an active super admin must exist");

  const backup = createFullBackup({ label: `system-e2e-${stamp}`, createdBy: "system-e2e" });
  assert.ok(backup.id);
  assert.ok(listBackups().some((item) => item.id === backup.id));

  db.prepare("UPDATE licenses SET name=? WHERE slug=?").run("Backup Mutated", licenseSlug);
  db.prepare("UPDATE auth_users SET name=? WHERE id=?").run("CURRENT SUPER ADMIN PRESERVED", superAdmin.id);

  const beforeDryRun = listBackups().length;
  const dry = restoreBackup(backup.id, { dryRun: true, actor: "system-e2e" });
  assert.equal(dry.ok, true);
  assert.equal(dry.dryRun, true);
  assert.equal(listBackups().length, beforeDryRun, "dry run must not create a pre-restore backup");
  assert.equal(db.prepare("SELECT name FROM licenses WHERE slug=?").get(licenseSlug).name, "Backup Mutated", "dry run must not mutate data");

  let traversalRejected = false;
  try { restoreBackup("../outside-backup", { dryRun: true, actor: "system-e2e" }); }
  catch (error) { traversalRejected = Number(error?.status || 0) === 400; }
  assert.equal(traversalRejected, true, "path traversal must be rejected");

  const restored = restoreBackup(backup.id, { actor: "system-e2e" });
  assert.equal(restored.ok, true);
  assert.equal(restored.requiresReauth, true);
  assert.ok(restored.preRestoreId, "a safety backup must be created before restore");
  assert.equal(db.prepare("SELECT name FROM licenses WHERE slug=?").get(licenseSlug).name, "Backup Original", "business data must be restored");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE id=?").get(sessionId).n, 0, "sessions from backup must be purged");
  assert.equal(db.prepare("SELECT name FROM auth_users WHERE id=?").get(superAdmin.id).name, "CURRENT SUPER ADMIN PRESERVED", "current super admin must be preserved");

  console.log("SYSTEM_BACKUP_E2E_PASS");
} finally {
  try { db.prepare("DELETE FROM auth_sessions WHERE id=?").run(sessionId); } catch {}
  try { db.prepare("DELETE FROM auth_users WHERE id=?").run(userId); } catch {}
  try { db.prepare("DELETE FROM licenses WHERE slug=?").run(licenseSlug); } catch {}
}
