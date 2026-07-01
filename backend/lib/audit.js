import { readJson, writeJson } from "./storage.js";

const MAX_LOG = 2000;

export function logAudit(entry) {
  const logs = readJson("audit", []);
  const row = {
    id: "LOG-" + Date.now(),
    at: new Date().toISOString(),
    ...entry
  };
  logs.unshift(row);
  writeJson("audit", logs.slice(0, MAX_LOG));
  return row;
}

export function getAuditLogs(filters = {}) {
  let logs = readJson("audit", []);
  if (filters.type) logs = logs.filter((l) => l.type === filters.type);
  if (filters.user) logs = logs.filter((l) => (l.user || "").includes(filters.user));
  if (filters.q) {
    const q = filters.q.toLowerCase();
    logs = logs.filter((l) => JSON.stringify(l).toLowerCase().includes(q));
  }
  return logs.slice(0, Number(filters.limit) || 200);
}
