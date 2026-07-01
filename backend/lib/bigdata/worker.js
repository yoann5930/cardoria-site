/**
 * Worker Big Data — sync + agrégations en arrière-plan.
 */
import { runFullIngestSync } from "./ingest.js";
import { refreshAllCardMetrics } from "./indices.js";
import { computePriceEvolution } from "./evolution.js";
import { computeBigDataTrends } from "./trends.js";
import { computeHeatmap } from "./heatmap.js";
import { computeAiStats } from "./aiStats.js";
import { invalidateCache } from "./cache.js";
import { getDb } from "../engine/database.js";

let timer = null;
let running = false;
let lastRun = null;

const INTERVAL_MS = Number(process.env.BIGDATA_WORKER_MS || 25 * 60 * 1000);

export async function runBigDataWorker(reason = "scheduled") {
  if (running) return { skipped: true };
  running = true;
  const start = Date.now();

  try {
    const ingest = runFullIngestSync();
    refreshAllCardMetrics(350);
    computePriceEvolution({ days: 730 });
    computeBigDataTrends();
    computeHeatmap();
    computeAiStats();
    invalidateCache("analytics:");

    const now = new Date().toISOString();
    getDb().prepare(`
      INSERT INTO bigdata_sync_state (sync_key, last_synced_at, last_source_id)
      VALUES ('worker', ?, ?)
      ON CONFLICT(sync_key) DO UPDATE SET last_synced_at = excluded.last_synced_at
    `).run(now, reason);

    lastRun = { at: now, reason, ingest, durationMs: Date.now() - start };
    return lastRun;
  } finally {
    running = false;
  }
}

export function startBigDataWorker() {
  setTimeout(() => runBigDataWorker("boot"), 25000);
  timer = setInterval(() => runBigDataWorker("interval"), INTERVAL_MS);
}

export function getBigDataWorkerStatus() {
  const state = getDb().prepare("SELECT * FROM bigdata_sync_state WHERE sync_key = 'worker'").get();
  return { lastRun, running, intervalMs: INTERVAL_MS, lastSyncedAt: state?.last_synced_at };
}
