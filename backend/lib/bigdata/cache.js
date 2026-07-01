/**
 * Cache ultra-rapide Big Data Cardoria.
 */
import { getDb } from "../engine/database.js";

export function setCache(key, payload, ttlSeconds = 3600) {
  getDb().prepare(`
    INSERT INTO bigdata_cache (cache_key, payload_json, computed_at, ttl_seconds)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      computed_at = excluded.computed_at,
      ttl_seconds = excluded.ttl_seconds
  `).run(key, JSON.stringify(payload), new Date().toISOString(), ttlSeconds);
}

export function getCache(key) {
  const row = getDb().prepare("SELECT * FROM bigdata_cache WHERE cache_key = ?").get(key);
  if (!row) return null;
  const age = (Date.now() - new Date(row.computed_at).getTime()) / 1000;
  if (age > (row.ttl_seconds || 3600)) return null;
  try {
    return { data: JSON.parse(row.payload_json), cachedAt: row.computed_at, ttlSeconds: row.ttl_seconds };
  } catch {
    return null;
  }
}

export function getOrCompute(key, computeFn, ttlSeconds = 3600) {
  const cached = getCache(key);
  if (cached) return { ...cached.data, _cached: true, _cachedAt: cached.cachedAt };
  const data = computeFn();
  setCache(key, data, ttlSeconds);
  return data;
}

export function invalidateCache(prefix = "") {
  if (!prefix) {
    getDb().prepare("DELETE FROM bigdata_cache").run();
    return;
  }
  getDb().prepare("DELETE FROM bigdata_cache WHERE cache_key LIKE ?").run(`${prefix}%`);
}
