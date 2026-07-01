/**
 * Worker Ultimate — recalcul cache en arrière-plan.
 */
import { getDb } from "../engine/database.js";
import { computePriceComparison } from "./comparator.js";
import { computeInvestmentAdvice } from "./advisor.js";
import { getUltimateHistory } from "./history.js";
import { buildUltimateDashboard } from "./dashboard.js";

let timer = null;
let running = false;
let lastRun = null;

const INTERVAL_MS = Number(process.env.ULTIMATE_WORKER_MS || 20 * 60 * 1000);

export async function runUltimateWorker(reason = "scheduled") {
  if (running) return { skipped: true };
  running = true;
  const start = Date.now();

  try {
    const cardIds = getDb().prepare(`
      SELECT id FROM cards WHERE active = 1 ORDER BY views DESC LIMIT 150
    `).all().map((r) => r.id);

    cardIds.forEach((id) => {
      try {
        computePriceComparison(id, { persist: true });
        computeInvestmentAdvice(id, { persist: true });
        getUltimateHistory(id, "30", { refresh: true });
      } catch { /* skip */ }
    });

    buildUltimateDashboard();
    lastRun = { at: new Date().toISOString(), reason, cards: cardIds.length, durationMs: Date.now() - start };
    return lastRun;
  } finally {
    running = false;
  }
}

export function startUltimateWorker() {
  setTimeout(() => runUltimateWorker("boot"), 20000);
  timer = setInterval(() => runUltimateWorker("interval"), INTERVAL_MS);
}

export function getUltimateWorkerStatus() {
  return { lastRun, running, intervalMs: INTERVAL_MS };
}
