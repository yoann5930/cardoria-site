/**
 * Serialize Boutique order mutations in this Node process.
 * Production OVH runs a single systemd unit (`npm start` → one Node process),
 * so this queue is the live protection against last-unit oversell.
 * Multi-worker deployments sharing orders.json would still need a single writer
 * or a database lock; this Map/Promise does not coordinate other processes.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const held = new AsyncLocalStorage();
let tail = Promise.resolve();

export function withBoutiqueOrderLock(work) {
  if (typeof work !== "function") return Promise.reject(new TypeError("Boutique order lock requires a function."));
  if (held.getStore()) return Promise.resolve().then(work);
  const run = tail.catch(() => {}).then(() => held.run(true, work));
  tail = run.then(() => undefined, () => undefined);
  return run;
}
