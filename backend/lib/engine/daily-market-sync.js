import { syncPokemonCatalog, syncPokemonReferenceCatalog, getMarketPriceStatus } from "./tcgdex-sync.js";
import { msUntilNextParisNoon, nextParisNoon } from "./market-schedule.js";
import { flushEnginePersistence } from "../marketplace/persistence.js";

let timer = null;
let startupCatchupTimer = null;
let catalogRetryTimer = null;
let running = false;

async function reconcileCatalog(reason) {
  const catalog = await syncPokemonCatalog({ languages: ["fr", "en", "ja", "ko"] });
  console.log(`[pokemon-catalog-daily] source=${catalog.totalSource || 0} created=${catalog.created || 0} updated=${catalog.updated || 0} unchanged=${catalog.unchanged || 0} failed=${catalog.failed || 0} total=${catalog.count || 0}`);
  if (!catalog.skipped) {
    const catalogSaved = await flushEnginePersistence(`${reason}-catalog`);
    if (!catalogSaved.ok) console.error(`[pokemon-catalog-daily] persistence failed (${reason})`, catalogSaved.error || "unknown");
  }
  return catalog;
}

async function runCatalogRetry(reason = "hourly-catalog-retry") {
  if (running) return { ok: false, skipped: true, reason: "already_running" };
  running = true;
  try {
    const catalog = await reconcileCatalog(reason);
    return { ok: true, catalog };
  } catch (error) {
    console.error(`[pokemon-catalog-retry] failed (${reason})`, error?.message || String(error));
    return { ok: false, error: error?.message || String(error) };
  } finally {
    running = false;
  }
}

async function runMarketSweep(reason = "daily-market-sync-paris-noon") {
  if (running) return { ok: false, skipped: true, reason: "already_running" };
  running = true;
  try {
    const catalog = await reconcileCatalog(reason);
    let totalChecked = 0;
    let totalPriced = 0;
    let totalUnavailable = 0;
    const maxPasses = 12;
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const result = await syncPokemonReferenceCatalog({ language: "fr", priceLimit: 2000, skipRarities: true });
      totalChecked += Number(result.priceLimit || 0);
      totalPriced += Number(result.priced || 0);
      totalUnavailable += Number(result.unavailable || 0);
      console.log(`[market-prices-sweep:fr] pass=${pass + 1}/${maxPasses} checked=${result.priceLimit || 0} priced=${result.priced || 0} unavailable=${result.unavailable || 0}`);
      if (!result.priceLimit) break;
    }
    const saved = await flushEnginePersistence(reason);
    if (!saved.ok) console.error(`[market-prices] persistence failed (${reason})`, saved.error || "unknown");
    const status = getMarketPriceStatus({ language: "fr" });
    console.log(`[market-prices-sweep:fr] complete checked=${totalChecked} priced=${totalPriced} unavailable=${totalUnavailable} coverage=${status.priced}/${status.total} missing=${Math.max(0, status.total - status.priced)}`);
    return { ok: true, catalog, totalChecked, totalPriced, totalUnavailable, status };
  } catch (error) {
    console.error(`[market-prices] sync failed (${reason})`, error?.message || String(error));
    return { ok: false, error: error?.message || String(error) };
  } finally {
    running = false;
  }
}

async function runDailyMarketSync() {
  try {
    await runMarketSweep("daily-market-sync-paris-noon");
  } finally {
    scheduleNextDailyMarketSync();
  }
}

async function runStartupMarketCatchup() {
  await runCatalogRetry("startup-catalog-retry");

  const status = getMarketPriceStatus({ language: "fr" });
  const total = Number(status.total || 0);
  const missing = Math.max(0, total - Number(status.priced || 0));
  if (!total) {
    console.warn("[market-prices-startup] FR catalog unavailable after retry");
    return;
  }
  if (!missing) {
    console.log(`[market-prices-startup] FR already complete ${status.priced}/${status.total}`);
    return;
  }
  console.log(`[market-prices-startup] FR catch-up required coverage=${status.priced}/${status.total} missing=${missing}`);
  await runMarketSweep("startup-market-catchup");
}

export function scheduleNextDailyMarketSync(from = new Date()) {
  if (timer) clearTimeout(timer);
  const next = nextParisNoon(from);
  const delay = msUntilNextParisNoon(from);
  console.log(`[market-prices-daily] next sync: ${next.toISOString()} (12:00 Europe/Paris)`);
  timer = setTimeout(runDailyMarketSync, delay);
  timer.unref?.();
  return { next, delay };
}

export function stopDailyMarketSync() {
  if (timer) clearTimeout(timer);
  if (startupCatchupTimer) clearTimeout(startupCatchupTimer);
  if (catalogRetryTimer) clearInterval(catalogRetryTimer);
  timer = null;
  startupCatchupTimer = null;
  catalogRetryTimer = null;
}

if (process.env.NODE_ENV !== "test") {
  scheduleNextDailyMarketSync();
  // A second catalog reconciliation shortly after boot protects against a
  // temporary provider/network failure during the first startup attempt.
  startupCatchupTimer = setTimeout(() => {
    startupCatchupTimer = null;
    runStartupMarketCatchup().catch((error) => console.error("[market-prices-startup] catch-up failed", error?.message || String(error)));
  }, 3 * 60 * 1000);
  startupCatchupTimer.unref?.();

  // Keep reconciling the source even if TCGdex is temporarily unavailable.
  // This prevents a provider outage around startup/noon from leaving Cardoria
  // stale until the following day.
  catalogRetryTimer = setInterval(() => {
    runCatalogRetry("hourly-catalog-retry").catch((error) => console.error("[pokemon-catalog-retry] hourly failure", error?.message || String(error)));
  }, 60 * 60 * 1000);
  catalogRetryTimer.unref?.();
}
