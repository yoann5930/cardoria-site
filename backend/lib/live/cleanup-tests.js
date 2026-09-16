import { readJson, writeJson } from "../storage.js";

const MARKER_KEY = "live-test-cleanup-20260916.json";
const SESSION_KEY = "live-sessions.json";
const ACTION_KEY = "live-actions.json";
const ARCHIVE_KEY = "live-archives.json";

export function cleanupLegacyLiveTestsOnce() {
  const marker = readJson(MARKER_KEY, { done: false });
  if (marker?.done) return { ...marker, skipped: true };
  const store = readJson(SESSION_KEY, { sessions: [], checkouts: [], adminAccess: [] });
  const sessions = Array.isArray(store.sessions) ? store.sessions : [];
  const removable = sessions.filter((s) => String(s?.ownerRole || "") === "admin" && String(s?.ownerId || "") === "cardoria" && String(s?.title || "").trim() === "Live Cardoria" && ["ended", "cancelled"].includes(String(s?.status || "").toLowerCase()));
  const ids = new Set(removable.map((s) => String(s.id)));
  if (ids.size) {
    store.sessions = sessions.filter((s) => !ids.has(String(s.id)));
    store.checkouts = (Array.isArray(store.checkouts) ? store.checkouts : []).filter((c) => !ids.has(String(c.liveId)));
    store.adminAccess = (Array.isArray(store.adminAccess) ? store.adminAccess : []).filter((g) => !ids.has(String(g.liveId)));
    writeJson(SESSION_KEY, store);
    const actions = readJson(ACTION_KEY, { states: {} });
    if (actions?.states && typeof actions.states === "object") { for (const id of ids) delete actions.states[id]; writeJson(ACTION_KEY, actions); }
    const archives = readJson(ARCHIVE_KEY, { archives: [] });
    if (Array.isArray(archives?.archives)) { archives.archives = archives.archives.filter((a) => !ids.has(String(a.liveId))); writeJson(ARCHIVE_KEY, archives); }
  }
  const result = { done: true, removed: ids.size, removedLiveIds: [...ids], cleanedAt: new Date().toISOString() };
  writeJson(MARKER_KEY, result);
  return result;
}
