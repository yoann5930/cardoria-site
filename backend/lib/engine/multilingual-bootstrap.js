import { restoreMultilingualCards, persistMultilingualCards, closeMultilingualCardPersistence } from "./multilingual-card-persistence.js";
import { ensureCatalogFrenchLocalizationSchema, localizeMultilingualCatalogToFrench } from "./catalog-french-localization.js";
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

let readinessChecks = 0;
const readinessTimer = setInterval(async () => {
  readinessChecks += 1;
  const state = catalogReady();
  if (state.ready) {
    const result = await localizeAndCheckpointMultilingualCatalog("catalog-ready-checkpoint");
    if (result.ok) clearInterval(readinessTimer);
  } else if (readinessChecks >= 60) {
    clearInterval(readinessTimer);
    console.warn(`[multilingual-bootstrap] catalog readiness timeout EN=${state.counts.en} JA=${state.counts.ja} KO=${state.counts.ko}`);
  }
}, 10000);
readinessTimer.unref?.();

const checkpointTimer = setInterval(async () => {
  if (!localized) return;
  await localizeAndCheckpointMultilingualCatalog("periodic-checkpoint");
}, 15 * 60 * 1000);
checkpointTimer.unref?.();

async function close() {
  clearInterval(readinessTimer);
  clearInterval(checkpointTimer);
  try {
    const state = catalogReady();
    if (state.ready) await localizeAndCheckpointMultilingualCatalog("shutdown-checkpoint");
    else await checkpoint("shutdown-raw-checkpoint");
  } catch {}
  try { await closeMultilingualCardPersistence(); } catch {}
}

process.once("beforeExit", () => { close().catch(() => {}); });
