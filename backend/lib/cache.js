/**
 * Cache mémoire TTL — réponses fréquentes (catalogue, tendances).
 */
const store = new Map();
const DEFAULT_TTL = Number(process.env.CACHE_TTL_MS || 60_000);

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheSet(key, value, ttlMs = DEFAULT_TTL) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (store.size > 2000) {
    const first = store.keys().next().value;
    store.delete(first);
  }
}

export function cacheWrap(key, fn, ttlMs) {
  const cached = cacheGet(key);
  if (cached != null) return cached;
  const value = fn();
  cacheSet(key, value, ttlMs);
  return value;
}

export function cacheStats() {
  return { entries: store.size, defaultTtlMs: DEFAULT_TTL };
}

export function cacheClear() {
  store.clear();
}
