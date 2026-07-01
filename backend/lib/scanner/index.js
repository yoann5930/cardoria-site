import { migrateScanner } from "./migrate.js";

export function initScanner() {
  migrateScanner();
  return { ok: true, module: "cardoria-scanner" };
}

export { scanCardIntelligent } from "./analyze.js";
export { getScan, listScans, updateScanAdmin, getStatsByLicense, exportScansCsv } from "./store.js";
export { listPendingCards, updatePendingCard } from "./catalog.js";
