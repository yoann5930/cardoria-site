import { restoreMultilingualCards, persistMultilingualCards, closeMultilingualCardPersistence } from "./multilingual-card-persistence.js";
import { ensureCatalogFrenchLocalizationSchema, localizeMultilingualCatalogToFrench } from "./catalog-french-localization.js";
import { getMultilingualImageRepairStatus, repairMultilingualImages } from "./multilingual-image-repair.js";
import { getZebraDexRepairStatus, repairImagesWithZebraDex } from "./zebradex-image-repair.js";
import { backfillKoreanOfficialCards, verifyKoreanTauros } from "./korean-official-backfill.js";
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
let zebraRepairRunning = false;
let dirtyImages = false;
let koreanBackfillDone = false;

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
  try {
    const result = await persistMultilingualCards(reason);
    if (result?.ok) dirtyImages = false;
    return result;
  } catch (error) {
    console.error("[multilingual-bootstrap] checkpoint failed", error?.message || String(error));
    return { ok: false, error: error?.message || String(error) };
  } finally {
    busy = false;
  }
}

async function ensureKoreanOfficialBackfill() {
  if (koreanBackfillDone || busy) return { ok: true, skipped: true };
  busy = true;
  try {
    const result = await backfillKoreanOfficialCards({ limit: 160, discover: true });
    koreanBackfillDone = true;
    if (result.added > 0 || result.updated > 0) dirtyImages = true;
    const tauros = verifyKoreanTauros();
    console.log(`[catalog-audit] Tauros KO sv9a 053 ${tauros ? `OK image=${tauros.image_hd ? 'yes' : 'no'} price=${Number(tauros.recommended_price || 0).toFixed(2)}` : 'MISSING'}`);
    return result;
  } catch (error) {
    console.error("[pokemon-korea-official] backfill failed", error?.message || String(error));
    return { ok: false, error: error?.message || String(error) };
  } finally {
    busy = false;
  }
}

export async function localizeAndCheckpointMultilingualCatalog(reason = "catalog-localization") {
  if (busy) return { ok: false, skipped: true, reason: "busy" };
  const state = catalogReady();
  if (!state.ready) {
    console.log(`[multilingual-bootstrap] waiting catalog EN=${state.counts.en} JA=${state.counts.ja} KO=${state.counts.ko}`);
    return { ok: true, skipped: true, reason: "catalog_not_ready", counts: state.counts };
  }

  const ko = await ensureKoreanOfficialBackfill();
  if (ko?.ok === false) return ko;

  busy = true;
  try {
    const localization = localizeMultilingualCatalogToFrench();
    const persistence = await persistMultilingualCards(reason);
    localized = persistence?.ok !== false;
    dirtyImages = false;
    return { ok: localized, localization, persistence };
  } catch (error) {
    console.error("[multilingual-bootstrap] localization failed", error?.message || String(error));
    return { ok: false, error: error?.message || String(error) };
  } finally {
    busy = false;
  }
}

async function runZebraRepairPass() {
  if (!localized || busy || imageRepairRunning || zebraRepairRunning) return;
  const tcgStatus = getMultilingualImageRepairStatus();
  if (tcgStatus.totalPending > 0) return;
  const zebraStatus = getZebraDexRepairStatus();
  if (!zebraStatus.pending) {
    if (dirtyImages) await checkpoint("image-fallbacks-complete");
    return;
  }
  zebraRepairRunning = true;
  try {
    const result = await repairImagesWithZebraDex({ limit: 60 });
    if (result.repaired > 0) dirtyImages = true;
    if (result.pending === 0 && dirtyImages) await checkpoint("zebradex-repair-complete");
  } catch (error) {
    console.error("[zebradex-image-repair] pass failed", error?.message || String(error));
  } finally {
    zebraRepairRunning = false;
  }
}

async function runImageRepairPass() {
  if (!localized || busy || imageRepairRunning || zebraRepairRunning) return;
  const before = getMultilingualImageRepairStatus();
  if (!before.totalPending) {
    await runZebraRepairPass();
    return;
  }
  imageRepairRunning = true;
  try {
    const result = await repairMultilingualImages({ limit: 500 });
    if (result.repaired > 0) dirtyImages = true;
    if (result.totalPending === 0) setTimeout(() => runZebraRepairPass(), 5000).unref?.();
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
const zebraRepairTimer = setInterval(() => runZebraRepairPass(), 120000);
zebraRepairTimer.unref?.();

const checkpointTimer = setInterval(async () => {
  if (!localized || imageRepairRunning || zebraRepairRunning || !dirtyImages) return;
  await checkpoint("periodic-image-checkpoint");
}, 15 * 60 * 1000);
checkpointTimer.unref?.();

async function close() {
  clearInterval(readinessTimer);
  clearInterval(imageRepairTimer);
  clearInterval(zebraRepairTimer);
  clearInterval(checkpointTimer);
  try {
    const state = catalogReady();
    if (state.ready && !imageRepairRunning && !zebraRepairRunning) await checkpoint("shutdown-checkpoint");
    else await checkpoint("shutdown-raw-checkpoint");
  } catch {}
  try { await closeMultilingualCardPersistence(); } catch {}
}

process.once("beforeExit", () => { close().catch(() => {}); });
