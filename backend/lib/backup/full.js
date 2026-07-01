/**
 * Sauvegardes complètes — JSON, SQLite, images IA, restauration.
 */
import fs from "fs";
import path from "path";
import { DATA_DIR, readJson } from "../storage.js";
import { logAudit } from "../audit.js";

const DB_PATH = path.join(DATA_DIR, "cardoria-engine.db");
const AI_IMAGES = path.join(DATA_DIR, "ai-images");

export function createFullBackup({ label = "" } = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(DATA_DIR, "backups", stamp);
  fs.mkdirSync(backupDir, { recursive: true });

  const manifest = {
    id: stamp,
    label,
    createdAt: new Date().toISOString(),
    files: []
  };

  copyIfExists(DB_PATH, path.join(backupDir, "cardoria-engine.db"), manifest);
  copyDirIfExists(AI_IMAGES, path.join(backupDir, "ai-images"), manifest);

  const jsonFiles = [
    "estimations.json", "users.json", "purchases.json", "audit-log.json",
    "site-analytics.json", "settings.json", "witnot-attribution.json", "error-log.json", "orders.json"
  ];

  jsonFiles.forEach((name) => {
    const src = path.join(DATA_DIR, name);
    copyIfExists(src, path.join(backupDir, "json", name), manifest);
  });

  fs.writeFileSync(path.join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  logAudit({ type: "backup", action: "full_backup", user: "system", detail: stamp });

  return { id: stamp, path: backupDir, manifest };
}

function copyIfExists(src, dest, manifest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  manifest.files.push({ type: "file", path: path.basename(dest), size: fs.statSync(dest).size });
}

function copyDirIfExists(src, dest, manifest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
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
      }
    }
  };
  walk(src, dest);
  manifest.files.push({ type: "directory", path: "ai-images", count });
}

export function listBackups() {
  const dir = path.join(DATA_DIR, "backups");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const manifestPath = path.join(dir, d.name, "manifest.json");
      let manifest = { id: d.name, createdAt: d.name };
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch { /* ignore */ }
      return manifest;
    })
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export function restoreBackup(backupId, { dryRun = false } = {}) {
  const backupDir = path.join(DATA_DIR, "backups", backupId);
  if (!fs.existsSync(backupDir)) throw new Error("Sauvegarde introuvable");

  const preRestore = createFullBackup({ label: "pre-restore-" + backupId });

  if (dryRun) return { ok: true, dryRun: true, backupId, preRestoreId: preRestore.id };

  const dbSrc = path.join(backupDir, "cardoria-engine.db");
  if (fs.existsSync(dbSrc)) fs.copyFileSync(dbSrc, DB_PATH);

  const jsonDir = path.join(backupDir, "json");
  if (fs.existsSync(jsonDir)) {
    fs.readdirSync(jsonDir).forEach((f) => {
      fs.copyFileSync(path.join(jsonDir, f), path.join(DATA_DIR, f));
    });
  }

  const imgSrc = path.join(backupDir, "ai-images");
  if (fs.existsSync(imgSrc)) {
    if (fs.existsSync(AI_IMAGES)) fs.rmSync(AI_IMAGES, { recursive: true, force: true });
    copyDirIfExists(imgSrc, AI_IMAGES, { files: [] });
  }

  logAudit({ type: "backup", action: "restore", user: "admin", detail: backupId });

  return { ok: true, restored: backupId, preRestoreId: preRestore.id };
}

/** Sauvegarde automatique si intervalle écoulé */
export function scheduleAutoBackup() {
  const hours = Number(process.env.BACKUP_INTERVAL_HOURS || 24);
  if (hours <= 0) return;

  const flag = path.join(DATA_DIR, ".last-backup");
  let last = 0;
  try { last = Number(fs.readFileSync(flag, "utf8")) || 0; } catch { /* ignore */ }

  if (Date.now() - last < hours * 3600000) return;

  createFullBackup({ label: "auto" });
  fs.writeFileSync(flag, String(Date.now()), "utf8");
}
