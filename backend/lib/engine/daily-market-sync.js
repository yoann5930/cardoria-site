import { syncPokemonReferenceCatalog } from "./tcgdex-sync.js";
import { msUntilNextParisNoon, nextParisNoon } from "./market-schedule.js";
import { flushEnginePersistence } from "../marketplace/persistence.js";

let timer = null;
let running = false;

async function runDailyMarketSync() {
  if (running) return;
  running = true;
  try {
    let totalChecked = 0;
    let totalPriced = 0;
    let totalUnavailable = 0;
    const maxPasses = 12;
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const result = await syncPokemonReferenceCatalog({ priceLimit: 2000, skipRarities: true });
      totalChecked += Number(result.priceLimit || 0);
      totalPriced += Number(result.priced || 0);
      totalUnavailable += Number(result.unavailable || 0);
      if (!result.priceLimit) break;
    }
    const saved = await flushEnginePersistence("daily-market-sync-paris-noon");
    if (!saved.ok) console.error("[market-prices-daily] persistence failed", saved.error || "unknown");
    console.log(`[market-prices-daily] ${totalChecked} checked · ${totalPriced} priced · ${totalUnavailable} unavailable`);
  } catch (error) {
    console.error("[market-prices-daily] sync failed", error?.message || String(error));
  } finally {
    running = false;
    scheduleNextDailyMarketSync();
  }
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
  timer = null;
}

if (process.env.NODE_ENV !== "test") scheduleNextDailyMarketSync();
