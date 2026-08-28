import { restoreMultilingualCards, persistMultilingualCards, closeMultilingualCardPersistence } from "./multilingual-card-persistence.js";

try {
  await restoreMultilingualCards();
} catch (error) {
  console.error("[multilingual-bootstrap] restore failed", error?.message || String(error));
}

let busy = false;
async function checkpoint(reason) {
  if (busy) return;
  busy = true;
  try { await persistMultilingualCards(reason); }
  catch (error) { console.error("[multilingual-bootstrap] checkpoint failed", error?.message || String(error)); }
  finally { busy = false; }
}

const firstCheckpoint = setTimeout(() => checkpoint("startup-checkpoint"), 45000);
firstCheckpoint.unref?.();
const checkpointTimer = setInterval(() => checkpoint("periodic-checkpoint"), 15 * 60 * 1000);
checkpointTimer.unref?.();

async function close() {
  clearTimeout(firstCheckpoint);
  clearInterval(checkpointTimer);
  try { await checkpoint("shutdown-checkpoint"); } catch {}
  try { await closeMultilingualCardPersistence(); } catch {}
}

process.once("beforeExit", () => { close().catch(() => {}); });
