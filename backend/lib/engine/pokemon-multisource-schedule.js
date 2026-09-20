import { syncPokemonMultiSourceCatalog, getPokemonMultiSourceStatus } from "./pokemon-multisource-sync.js";
import { persistMultilingualCards } from "./multilingual-card-persistence.js";

const START_DELAY_MS = Math.max(60_000, Number(process.env.POKEMON_MULTISOURCE_START_DELAY_MS) || 180_000);
const INTERVAL_MS = Math.max(5 * 60_000, Number(process.env.POKEMON_MULTISOURCE_INTERVAL_MS) || 20 * 60_000);
let running = false;

async function run(reason = "scheduled") {
  if (running || process.env.NODE_ENV === "test") return;
  running = true;
  try {
    const before = getPokemonMultiSourceStatus();
    const result = await syncPokemonMultiSourceCatalog({ tcgcsvGroupLimit: 12, scrydexPageLimit: 10 });
    const changed = result.results?.some((item) => Number(item?.created || 0) > 0 || Number(item?.updated || 0) > 0);
    if (changed) {
      const persistence = await persistMultilingualCards(`pokemon-multisource-${reason}`);
      if (!persistence?.ok) console.warn("[pokemon-multisource] persistence deferred", persistence?.error || persistence?.reason || "unknown");
    }
    console.log("[pokemon-multisource]", reason, JSON.stringify({
      before: before.counts,
      after: result.counts,
      providers: result.results?.map((item) => ({ provider:item.provider, ok:item.ok, skipped:item.skipped, created:item.created||0, matched:item.matched||0, updated:item.updated||0, complete:item.complete }))
    }));
  } catch (error) {
    console.error("[pokemon-multisource] scheduled sync failed", error?.message || String(error));
  } finally {
    running = false;
  }
}

const startTimer = setTimeout(() => run("startup"), START_DELAY_MS);
startTimer.unref?.();
const intervalTimer = setInterval(() => run("interval"), INTERVAL_MS);
intervalTimer.unref?.();

export function stopPokemonMultiSourceSchedule() {
  clearTimeout(startTimer);
  clearInterval(intervalTimer);
}
