/**
 * Worker arrière-plan — recalcule fiabilité, prédictions, tendances, dashboard.
 */
import { refreshAllReliabilityScores } from "./reliability.js";
import { refreshAllPredictions } from "./predict.js";
import { detectTrendSignals } from "./trends.js";
import { processPendingSaleAdjustments } from "./autoadjust.js";
import { buildEnterpriseDashboard } from "./dashboard.js";

let timer = null;
let running = false;
let lastRun = null;
let pendingReason = null;

const DEBOUNCE_MS = 8000;
const INTERVAL_MS = Number(process.env.AI_ENTERPRISE_WORKER_MS || 15 * 60 * 1000);

export function scheduleEnterpriseWorker(reason = "manual") {
  pendingReason = reason;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => runEnterpriseWorker(reason), DEBOUNCE_MS);
}

export async function runEnterpriseWorker(reason = "scheduled") {
  if (running) {
    scheduleEnterpriseWorker(reason);
    return { skipped: true, reason: "already_running" };
  }

  running = true;
  const started = Date.now();
  try {
    processPendingSaleAdjustments(80);
    refreshAllReliabilityScores(400);
    refreshAllPredictions(250);
    detectTrendSignals(180);
    const dashboard = buildEnterpriseDashboard();
    lastRun = {
      at: new Date().toISOString(),
      reason,
      durationMs: Date.now() - started,
      cardoriaTrendIndex: dashboard.cardoriaTrendIndex
    };
    return lastRun;
  } catch (err) {
    lastRun = { at: new Date().toISOString(), reason, error: err.message };
    return lastRun;
  } finally {
    running = false;
  }
}

export function startEnterpriseWorker() {
  scheduleEnterpriseWorker("boot");
  setInterval(() => runEnterpriseWorker("interval"), INTERVAL_MS);
}

export function getWorkerStatus() {
  return { lastRun, running, intervalMs: INTERVAL_MS, pendingReason };
}
