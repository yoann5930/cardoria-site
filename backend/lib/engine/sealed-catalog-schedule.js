import { syncCardmarketSealedCatalog, getSealedCatalogStatus } from "./sealed-products.js";
import { msUntilNextParisNoon, nextParisNoon } from "./market-schedule.js";
import { flushEnginePersistence } from "../marketplace/persistence.js";

let startupTimer = null;
let dailyTimer = null;
let running = false;

async function runSealedCatalogSync(reason = "sealed-catalog-sync") {
  if (running) return { ok: false, skipped: true, reason: "already_running" };
  running = true;
  try {
    const before = getSealedCatalogStatus();
    const result = await syncCardmarketSealedCatalog({ force: false });
    const after = getSealedCatalogStatus();
    if (!result.skipped || after.active !== before.active || after.priced !== before.priced) {
      const saved = await flushEnginePersistence(reason);
      if (!saved.ok) console.error("[sealed-catalog] persistence failed", saved.error || "unknown");
    }
    console.log(`[sealed-catalog] ${after.active} active · ${after.priced} priced · source ${after.source}${result.skipped ? " · fresh" : " · synchronized"}`);
    return { ok: true, ...after, synchronized: !result.skipped };
  } catch (error) {
    console.error("[sealed-catalog] sync failed", error?.message || String(error));
    return { ok: false, error: error?.message || String(error) };
  } finally {
    running = false;
  }
}

function scheduleNextDaily(from = new Date()) {
  if (dailyTimer) clearTimeout(dailyTimer);
  const next = nextParisNoon(from);
  const delay = msUntilNextParisNoon(from);
  console.log(`[sealed-catalog] next daily sync: ${next.toISOString()} (12:00 Europe/Paris)`);
  dailyTimer = setTimeout(async () => {
    await runSealedCatalogSync("daily-sealed-catalog-paris-noon");
    scheduleNextDaily(new Date(Date.now() + 1000));
  }, delay);
  dailyTimer.unref?.();
}

export function startSealedCatalogSchedule() {
  if (process.env.NODE_ENV === "test") return;
  if (!startupTimer) {
    startupTimer = setTimeout(() => runSealedCatalogSync("startup-sealed-catalog"), 15000);
    startupTimer.unref?.();
  }
  scheduleNextDaily();
}

export function stopSealedCatalogSchedule() {
  if (startupTimer) clearTimeout(startupTimer);
  if (dailyTimer) clearTimeout(dailyTimer);
  startupTimer = null;
  dailyTimer = null;
}

startSealedCatalogSchedule();
