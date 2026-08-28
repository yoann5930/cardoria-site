import { restoreMultilingualCards, persistMultilingualCards, closeMultilingualCardPersistence } from "./multilingual-card-persistence.js";
import { ensureCatalogFrenchLocalizationSchema, localizeMultilingualCatalogToFrench } from "./catalog-french-localization.js";
import { getMultilingualImageRepairStatus, repairMultilingualImages } from "./multilingual-image-repair.js";
import { getDb } from "./database.js";

const READY_MINIMUMS = { en: 23000, ja: 12000, ko: 200 };

try {
  ensureCatalogFrenchLocalizationSchema();
  await restoreMultilingualCards();
} catch (error) {
  console.error("[multilingual-bootstrap] restore failed", error?.message || String(error));
}

let busy = false;
let localized = false;
let imageRepairRunning = false;

function languageCounts() {
  const db = getDb();
  const counts = { en: 0, ja: 0, ko: 0 };
  try {
    for (const row of db.prepare("SELECT language,COUNT(*) AS count FROM cards WHERE license_slug='pokemon' AND language IN ('en','ja','ko') AND active=1 GROUP BY language").all()) {
      if (Object.prototype.hasOwnProperty.call(counts, row.language)) counts[row.language] = Number(row.count || 0);
    }
  } catch {}
  return counts;
}

function catalogReady() {
  const counts = languageCounts();
  return { counts, ready: Object.keys(READY_MINIMUMS).every((lang) => counts[lang] >= READY_MINIMUMS[lang]) };
}

async function checkpoint(reason) {
  if (busy) return { ok: false, skipped: true, reason: "busy" };
  busy = true;
  try { return await persistMultilingualCards(reason); }
  catch (error) {
    console.error("[multilingual-bootstrap] checkpoint failed", error?.message || String(error));
    return { ok: false, error: error?.message || String(error) };
  }
  finally { busy = false; }
}

export async function localizeAndCheckpointMultilingualCatalog(reason = "catalog-localization") {
  if (busy) return { ok: false, skipped: true, reason: "busy" };
  const state = catalogReady();
  if (!state.ready) {
    console.log(`[multilingual-bootstrap] waiting catalog EN=${state.counts.en} JA=${state.counts.ja} KO=${state.counts.ko}`);
    return { ok: true, skipped: true, reason: "catalog_not_ready", counts: state.counts };
  }
  busy = true;
  try {
    const localization = localizeMultilingualCatalogToFrench();
    const persistence = await persistMultilingualCards(reason);
    localized = persistence?.ok !== false;
    return { ok: localized, localization, persistence };
  } catch (error) {
    console.error("[multilingual-bootstrap] localization failed", error?.message || String(error));
    return { ok: false, error: error?.message || String(error) };
  } finally {
    busy = false;
  }
}

async function runImageRepairPass() {
  if (!localized || busy || imageRepairRunning) return;
  const before = getMultilingualImageRepairStatus();
  if (!before.totalPending) return;
  imageRepairRunning = true;
  try {
    const result = await repairMultilingualImages({ limit: 500 });
    if (result.repaired > 0 && result.totalPending === 0) {
      await checkpoint("image-repair-pass-complete");
    }
  } catch (error) {
    console.error("[multilingual-image-repair] pass failed", error?.message || String(error));
  } finally {
    imageRepairRunning = false;
  }
}

let readinessChecks = 0;
const readinessTimer = setInterval(async () => {
  readinessChecks += 1;
  const state = catalogReady();
  if (state.ready) {
    const result = await localizeAndCheckpointMultilingualCatalog("catalog-ready-checkpoint");
    if (result.ok) {
      clearInterval(readinessTimer);
      setTimeout(() => runImageRepairPass(), 5000).unref?.();
    }
  } else if (readinessChecks >= 60) {
    clearInterval(readinessTimer);
    console.warn(`[multilingual-bootstrap] catalog readiness timeout EN=${state.counts.en} JA=${state.counts.ja} KO=${state.counts.ko}`);
  }
}, 10000);
readinessTimer.unref?.();

const imageRepairTimer = setInterval(() => runImageRepairPass(), 45000);
imageRepairTimer.unref?.();

const checkpointTimer = setInterval(async () => {
  if (!localized || imageRepairRunning) return;
  await checkpoint("periodic-checkpoint");
}, 15 * 60 * 1000);
checkpointTimer.unref?.();

async function close() {
  clearInterval(readinessTimer);
  clearInterval(imageRepairTimer);
  clearInterval(checkpointTimer);
  try {
    const state = catalogReady();
    if (state.ready && !imageRepairRunning) await localizeAndCheckpointMultilingualCatalog("shutdown-checkpoint");
    else await checkpoint("shutdown-raw-checkpoint");
  } catch {}
  try { await closeMultilingualCardPersistence(); } catch {}
}

process.once("beforeExit", () => { close().catch(() => {}); });
