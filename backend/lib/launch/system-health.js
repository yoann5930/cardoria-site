/**
 * Santé étendue V1 — CPU, déploiements, journaux.
 */
import os from "os";
import fs from "fs";
import path from "path";
import { getHealthReport } from "../monitoring/health.js";
import { getErrorStats, getRecentErrors } from "../monitoring/errors.js";
import { getJournalStats } from "./journals.js";
import { getMaintenanceInfo } from "./maintenance.js";
import { DATA_DIR } from "../storage.js";

function checkDbSize() {
  try {
    const dbPath = path.join(DATA_DIR, "cardoria-engine.db");
    if (!fs.existsSync(dbPath)) return { ok: false, sizeMb: 0 };
    const sizeMb = Math.round(fs.statSync(dbPath).size / (1024 * 1024) * 10) / 10;
    return { ok: true, sizeMb };
  } catch {
    return { ok: false, sizeMb: 0 };
  }
}

async function pingUrl(url, timeoutMs = 5000) {
  if (!url) return { ok: false, configured: false };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal, method: "HEAD" });
    clearTimeout(t);
    return { ok: res.ok, status: res.status, configured: true };
  } catch (e) {
    return { ok: false, configured: true, error: e.message };
  }
}

export async function getSystemReport() {
  const base = getHealthReport();
  const load = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  const frontendUrl = process.env.MARKETPLACE_FRONTEND_URL || process.env.SITE_URL || "";
  const renderUrl = process.env.RENDER_EXTERNAL_URL || (process.env.NODE_ENV === "production" ? process.env.SITE_URL : "");

  const [renderPing, vercelPing] = await Promise.all([
    pingUrl(renderUrl ? renderUrl.replace(/\/$/, "") + "/api/health/" : ""),
    pingUrl(frontendUrl ? frontendUrl.replace(/\/$/, "") + "/" : "")
  ]);

  return {
    ...base,
    maintenance: getMaintenanceInfo(),
    system: {
      platform: process.platform,
      node: process.version,
      cpuLoad: [load[0], load[1], load[2]].map((n) => Math.round(n * 100) / 100),
      memoryTotalMb: Math.round(totalMem / 1024 / 1024),
      memoryFreeMb: Math.round(freeMem / 1024 / 1024),
      memoryUsedPercent: Math.round((1 - freeMem / totalMem) * 100)
    },
    storage: {
      dataDir: DATA_DIR,
      sqlite: checkDbSize()
    },
    deployments: {
      render: renderPing,
      vercel: vercelPing,
      frontendUrl: frontendUrl || null,
      backendUrl: renderUrl || null
    },
    journals: getJournalStats(),
    errors: {
      ...getErrorStats(),
      recent: getRecentErrors(20)
    }
  };
}

export function getVersionInfo() {
  return {
    version: process.env.APP_VERSION || "1.0.0",
    codename: "Ready for Launch",
    build: process.env.RENDER_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    node: process.version,
    environment: process.env.NODE_ENV || "development",
    releasedAt: "2026-07-01"
  };
}
