import fs from "fs";
import path from "path";

export const DATA_DIR = path.join(process.cwd(), "data");

const FILES = {
  estimations: "estimations.json",
  users: "users.json",
  purchases: "purchases.json",
  audit: "audit-log.json",
  analytics: "site-analytics.json",
  settings: "settings.json",
  "witnot-attribution": "witnot-attribution.json"
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const backupDir = path.join(DATA_DIR, "backups");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
}

export function readJson(key, fallback) {
  ensureDir();
  const file = path.join(DATA_DIR, FILES[key] || key);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(key, data) {
  ensureDir();
  const file = path.join(DATA_DIR, FILES[key] || key);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

export function backupAll() {
  ensureDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(DATA_DIR, "backups", stamp);
  fs.mkdirSync(backupDir, { recursive: true });
  Object.values(FILES).forEach((name) => {
    const src = path.join(DATA_DIR, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(backupDir, name));
  });
  return { id: stamp, path: backupDir, createdAt: new Date().toISOString() };
}
