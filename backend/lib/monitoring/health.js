/**
 * Santé application — checks DB, disque, mémoire, services.
 */
import fs from "fs";
import path from "path";
import { getDb } from "../engine/database.js";
import { DATA_DIR } from "../storage.js";
import { cacheStats } from "../cache.js";
import { getErrorStats } from "./errors.js";
import { listBackups } from "../backup/full.js";
import { isSumUpConfigured } from "../payments/sumup.js";

const DB_PATH = path.join(DATA_DIR, "cardoria-engine.db");

function checkDb() {
  try {
    const db = getDb();
    db.prepare("SELECT 1 AS ok").get();
    const cards = db.prepare("SELECT COUNT(*) AS c FROM cards").get()?.c ?? 0;
    return { ok: true, cards };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function checkDisk() {
  try {
    const stat = fs.statfsSync ? fs.statfsSync(DATA_DIR) : null;
    if (stat) {
      const freeGb = (stat.bfree * stat.bsize) / (1024 ** 3);
      return { ok: freeGb > 0.5, freeGb: Math.round(freeGb * 10) / 10 };
    }
    return { ok: fs.existsSync(DATA_DIR) };
  } catch {
    return { ok: fs.existsSync(DATA_DIR) };
  }
}

export function getHealthReport() {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const backups = listBackups();

  return {
    status: "ok",
    version: process.env.APP_VERSION || "5.8.0",
    environment: process.env.NODE_ENV || "development",
    uptimeSeconds: Math.round(uptime),
    timestamp: new Date().toISOString(),
    checks: {
      database: checkDb(),
      disk: checkDisk(),
      openai: { ok: !!process.env.OPENAI_API_KEY, configured: !!process.env.OPENAI_API_KEY },
      smtp: { ok: !!process.env.SMTP_HOST, configured: !!process.env.SMTP_HOST },
      sumup: { ok: isSumUpConfigured(), configured: isSumUpConfigured() },
      postgres: {
        ok: !!process.env.DATABASE_URL,
        configured: !!process.env.DATABASE_URL,
        note: process.env.DATABASE_URL ? "URL définie — migration PG à activer" : "SQLite actif"
      }
    },
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024)
    },
    cache: cacheStats(),
    errors: getErrorStats(),
    backups: {
      count: backups.length,
      latest: backups[0] || null
    }
  };
}

export function getPublicHealth() {
  const report = getHealthReport();
  const critical = !report.checks.database.ok;
  return {
    ok: !critical,
    status: critical ? "degraded" : "healthy",
    version: report.version,
    uptimeSeconds: report.uptimeSeconds
  };
}
