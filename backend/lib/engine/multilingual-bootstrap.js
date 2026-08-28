import { restoreMultilingualCards, persistMultilingualCards, closeMultilingualCardPersistence } from "./multilingual-card-persistence.js";
import { ensureCatalogFrenchLocalizationSchema, localizeMultilingualCatalogToFrench } from "./catalog-french-localization.js";

try {
  ensureCatalogFrenchLocalizationSchema();
  await restoreMultilingualCards();
} catch (error) {
  console.error("[multilingual-bootstrap] restore failed", error?.message || String(error));
}

let busy = false;
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
  try {
    const localization = localizeMultilingualCatalogToFrench();
    const persistence = await checkpoint(reason);
    return { ok: persistence?.ok !== false, localization, persistence };
  } catch (error) {
    console.error("[multilingual-bootstrap] localization failed", error?.message || String(error));
    return { ok: false, error: error?.message || String(error) };
  }
}

const firstCheckpoint = setTimeout(() => localizeAndCheckpointMultilingualCatalog("startup-checkpoint"), 45000);
firstCheckpoint.unref?.();
const checkpointTimer = setInterval(() => localizeAndCheckpointMultilingualCatalog("periodic-checkpoint"), 15 * 60 * 1000);
checkpointTimer.unref?.();

async function close() {
  clearTimeout(firstCheckpoint);
  clearInterval(checkpointTimer);
  try { await localizeAndCheckpointMultilingualCatalog("shutdown-checkpoint"); } catch {}
  try { await closeMultilingualCardPersistence(); } catch {}
}

process.once("beforeExit", () => { close().catch(() => {}); });
