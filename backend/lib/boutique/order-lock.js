/**
 * Serialize Boutique order mutations in this Node process.
 * Multi-worker deployments still need a single writer or a database lock.
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
