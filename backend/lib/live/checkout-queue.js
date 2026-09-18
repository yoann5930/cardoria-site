/**
 * Serialize work within one live without sharing one buyer's result with another.
 * This is process-local: multi-worker deployments need a database transaction/lock.
 */
export function createCheckoutQueue() {
  const tails = new Map();
  return function run(key, task) {
    if (typeof key !== "string" || !key.trim() || typeof task !== "function") {
      return Promise.reject(new TypeError("A live key and a task are required."));
    }
    const previous = tails.get(key) || Promise.resolve();
    const result = previous.then(() => task());
    // A failed payment must not poison subsequent work for the same live.
    const settled = result.then(() => undefined, () => undefined);
    tails.set(key, settled);
    settled.then(() => { if (tails.get(key) === settled) tails.delete(key); });
    return result;
  };
}

export const runLiveCheckoutTask = createCheckoutQueue();
