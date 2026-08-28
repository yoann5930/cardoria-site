/**
 * Sauvegardes complètes locales — snapshot SQLite cohérent, JSON, images IA,
 * restauration transactionnelle et validation sans effet de bord.
 *
 * En production Render, ces copies locales servent de fallback/runtime. Le module
 * durable PostgreSQL conserve les sauvegardes historiques entre les déploiements.
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { DATA_DIR } from "../storage.js";
import { getDb } from "../engine/database.js";
import { logAudit } from "../audit.js";

const DB_PATH = path.join(DATA_DIR, "cardoria-engine.db");
const AI_IMAGES = path.join(DATA_DIR, "ai-images");
const JSON_FILES = [
  "estimations.json", "users.json", "purchases.json", "audit-log.json",
  "site-analytics.json", "settings.json", "witnot-attribution.json", "error-log.json",
  "orders.json", "rachat-proposals.json"
];
const SECURITY_EPHEMERAL_TABLES = new Set(["auth_sessions", "auth_reset_tokens", "auth_magic_tokens"]);

function sqliteQuote(value) {
  return String(value).replace(/'/g, "''");
}

function snapshotSqlite(destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) fs.rmSync(destination, { force: true });
  const db = getDb();
  try { db.pragma("wal_checkpoint(PASSIVE)"); } catch {}
  db.exec(`VACUUM INTO '${sqliteQuote(destination)}'`);
  return fs.statSync(destination).size;
}

export function createFullBackup({ label = "", createdBy = "system" } = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(DATA_DIR, "backups", stamp);
  fs.mkdirSync(backupDir, { recursive: true });

  const manifest = {
    version: 2,
    id: stamp,
    label: String(label || "").slice(0, 160),
    createdBy: String(createdBy || "system").slice(0, 160),
    createdAt: new Date().toISOString(),
    files: []
  };

  const dbDest = path.join(backupDir, "cardoria-engine.db");
  const dbSize = snapshotSqlite(dbDest);
  manifest.files.push({ type: "sqlite", path: "cardoria-engine.db", size: dbSize });
  copyDirIfExists(AI_IMAGES, path.join(backupDir, "ai-images"), manifest);

  JSON_FILES.forEach((name) => {
    const src = path.join(DATA_DIR, name);
    copyIfExists(src, path.join(backupDir, "json", name), manifest, `json/${name}`);
  });

  fs.writeFileSync(path.join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  logAudit({ type: "backup", action: "full_backup", user: createdBy || "system", detail: stamp });
  return { id: stamp, path: backupDir, manifest };
}

function copyIfExists(src, dest, manifest, manifestPath = path.basename(dest)) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  manifest.files.push({ type: "file", path: manifestPath, size: fs.statSync(dest).size });
}

function copyDirIfExists(src, dest, manifest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  let size = 0;
  const walk = (from, to) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const s = path.join(from, entry.name);
      const d = path.join(to, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(d, { recursive: true });
        walk(s, d);
      } else {
        fs.copyFileSync(s, d);
        count++;
        size += fs.statSync(d).size;
      }
    }
  };
  walk(src, dest);
  manifest.files.push({ type: "directory", path: "ai-images", count, size });
}

export function listBackups() {
  const dir = path.join(DATA_DIR, "backups");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".restore-"))
    .map((d) => {
      const manifestPath = path.join(dir, d.name, "manifest.json");
      let manifest = { id: d.name, createdAt: d.name, mode: "local" };
      try { manifest = { ...JSON.parse(fs.readFileSync(manifestPath, "utf8")), mode: "local" }; } catch {}
      return manifest;
    })
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export function validateBackup(backupId) {
  const safeId = String(backupId || "");
  if (!/^[0-9A-Za-z._-]{8,120}$/.test(safeId)) throw Object.assign(new Error("Identifiant de sauvegarde invalide"), { status: 400 });
  const backupDir = path.join(DATA_DIR, "backups", safeId);
  const resolved = path.resolve(backupDir);
  const root = path.resolve(DATA_DIR, "backups");
  if (!resolved.startsWith(root + path.sep)) throw Object.assign(new Error("Identifiant de sauvegarde invalide"), { status: 400 });
  if (!fs.existsSync(backupDir)) throw Object.assign(new Error("Sauvegarde introuvable"), { status: 404 });

  let manifest = { id: safeId, createdAt: "", files: [] };
  try { manifest = JSON.parse(fs.readFileSync(path.join(backupDir, "manifest.json"), "utf8")); } catch {}
  const dbSrc = path.join(backupDir, "cardoria-engine.db");
  if (!fs.existsSync(dbSrc)) throw Object.assign(new Error("Snapshot SQLite manquant dans la sauvegarde"), { status: 422 });
  const dbSize = fs.statSync(dbSrc).size;
  if (dbSize < 1024) throw Object.assign(new Error("Snapshot SQLite invalide"), { status: 422 });
  return { ok: true, backupId: safeId, backupDir, dbSrc, dbSize, manifest };
}

function ordinaryTables(database) {
  return database.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .filter((row) => row.name && row.sql && !/CREATE\s+VIRTUAL\s+TABLE/i.test(row.sql) && !row.name.includes("_fts"));
}

function columnsFor(database, table) {
  return database.prepare(`PRAGMA table_info("${String(table).replace(/"/g, '""')}")`).all().map((c) => c.name);
}

function insertRows(target, source, table, sourceColumns, targetColumns, rowFilter = null) {
  const columns = sourceColumns.filter((column) => targetColumns.includes(column));
  if (!columns.length) return 0;
  const quoted = columns.map((column) => `"${column.replace(/"/g, '""')}"`);
  const select = source.prepare(`SELECT ${quoted.join(",")} FROM "${table.replace(/"/g, '""')}"`);
  const insert = target.prepare(`INSERT INTO "${table.replace(/"/g, '""')}" (${quoted.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
  let count = 0;
  for (const row of select.iterate()) {
    if (rowFilter && !rowFilter(row)) continue;
    insert.run(...columns.map((column) => row[column]));
    count++;
  }
  return count;
}

export function restoreSqliteSnapshot(sourcePath, { preserveCurrentSuperAdmins = true } = {}) {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const target = getDb();
  const restored = [];
  let preservedSuperAdmins = [];
  try {
    if (preserveCurrentSuperAdmins) {
      try { preservedSuperAdmins = target.prepare("SELECT * FROM auth_users WHERE role='super_admin' AND active=1").all(); } catch {}
    }

    const targetTables = new Set(ordinaryTables(target).map((row) => row.name));
    const sourceTables = ordinaryTables(source).filter((row) => targetTables.has(row.name));
    target.pragma("foreign_keys = OFF");

    const tx = target.transaction(() => {
      for (const { name } of sourceTables) {
        target.prepare(`DELETE FROM "${name.replace(/"/g, '""')}"`).run();
        if (SECURITY_EPHEMERAL_TABLES.has(name)) {
          restored.push({ table: name, rows: 0, securityPurged: true });
          continue;
        }
        const sourceColumns = columnsFor(source, name);
        const targetColumns = columnsFor(target, name);
        if (name === "auth_users" && preservedSuperAdmins.length) {
          const rows = insertRows(target, source, name, sourceColumns, targetColumns, (row) => row.role !== "super_admin");
          const insertColumns = targetColumns;
          const quoted = insertColumns.map((column) => `"${column.replace(/"/g, '""')}"`);
          const insert = target.prepare(`INSERT INTO "auth_users" (${quoted.join(",")}) VALUES (${insertColumns.map(() => "?").join(",")})`);
          preservedSuperAdmins.forEach((row) => insert.run(...insertColumns.map((column) => row[column] ?? null)));
          restored.push({ table: name, rows: rows + preservedSuperAdmins.length, superAdminsPreserved: preservedSuperAdmins.length });
          continue;
        }
        restored.push({ table: name, rows: insertRows(target, source, name, sourceColumns, targetColumns) });
      }
    });
    tx();
  } finally {
    try { target.pragma("foreign_keys = ON"); } catch {}
    source.close();
  }

  try { target.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')"); } catch {}
  try { target.exec("INSERT INTO mk_listings_fts(mk_listings_fts) VALUES('rebuild')"); } catch {}
  return { ok: true, tables: restored, securitySessionsPurged: true, superAdminsPreserved: preservedSuperAdmins.length };
}

function restoreJsonFiles(backupDir) {
  const jsonDir = path.join(backupDir, "json");
  const restored = [];
  if (!fs.existsSync(jsonDir)) return restored;
  fs.readdirSync(jsonDir, { withFileTypes: true }).forEach((entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".json")) return;
    const source = path.join(jsonDir, entry.name);
    const destination = path.join(DATA_DIR, entry.name);
    const tmp = `${destination}.restore-${process.pid}`;
    fs.copyFileSync(source, tmp);
    fs.renameSync(tmp, destination);
    restored.push(entry.name);
  });
  return restored;
}

function restoreImages(backupDir) {
  const imgSrc = path.join(backupDir, "ai-images");
  if (!fs.existsSync(imgSrc)) return false;
  const staging = path.join(DATA_DIR, `.ai-images-restore-${process.pid}`);
  fs.rmSync(staging, { recursive: true, force: true });
  copyDirIfExists(imgSrc, staging, { files: [] });
  fs.rmSync(AI_IMAGES, { recursive: true, force: true });
  fs.renameSync(staging, AI_IMAGES);
  return true;
}

export function restoreBackup(backupId, { dryRun = false, actor = "admin" } = {}) {
  const validated = validateBackup(backupId);
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      backupId: validated.backupId,
      dbSize: validated.dbSize,
      manifest: validated.manifest,
      security: { sessionsWillBePurged: true, currentSuperAdminsWillBePreserved: true }
    };
  }

  const preRestore = createFullBackup({ label: `pre-restore-${validated.backupId}`, createdBy: actor });
  const database = restoreSqliteSnapshot(validated.dbSrc, { preserveCurrentSuperAdmins: true });
  const jsonFiles = restoreJsonFiles(validated.backupDir);
  const imagesRestored = restoreImages(validated.backupDir);
  logAudit({ type: "backup", action: "restore", user: actor, detail: `${validated.backupId};pre=${preRestore.id}` });

  return {
    ok: true,
    restored: validated.backupId,
    preRestoreId: preRestore.id,
    database,
    jsonFiles,
    imagesRestored,
    requiresReauth: true
  };
}

/** Sauvegarde automatique locale de secours si intervalle écoulé. */
export function scheduleAutoBackup() {
  const hours = Number(process.env.BACKUP_INTERVAL_HOURS || 24);
  if (hours <= 0) return;
  const flag = path.join(DATA_DIR, ".last-backup");
  let last = 0;
  try { last = Number(fs.readFileSync(flag, "utf8")) || 0; } catch {}
  if (Date.now() - last < hours * 3600000) return;
  createFullBackup({ label: "auto-local", createdBy: "system" });
  fs.writeFileSync(flag, String(Date.now()), "utf8");
}
