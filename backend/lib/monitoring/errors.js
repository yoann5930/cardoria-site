/**
 * Journalisation centralisée des erreurs applicatives.
 */
import fs from "fs";
import path from "path";
import { DATA_DIR } from "../storage.js";
import { sendEmail } from "../email.js";

const LOG_FILE = path.join(DATA_DIR, "error-log.json");
const MAX_ENTRIES = 500;

function loadLog() {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    return JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveLog(entries) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(entries.slice(0, MAX_ENTRIES), null, 2), "utf8");
}

export function logError({ message, stack, route, user, severity = "error", meta = {} }) {
  const entry = {
    id: "err_" + Date.now().toString(36),
    at: new Date().toISOString(),
    message: String(message || "Erreur inconnue").slice(0, 2000),
    stack: stack ? String(stack).slice(0, 4000) : "",
    route: route || "",
    user: user || "system",
    severity,
    meta
  };

  const log = loadLog();
  log.unshift(entry);
  saveLog(log);

  console.error(`[Cardoria ${severity}] ${entry.route} — ${entry.message}`);

  if (severity === "critical" && process.env.ALERT_EMAIL === "true") {
    sendEmail({
      subject: `[Cardoria CRITIQUE] ${entry.message.slice(0, 80)}`,
      text: JSON.stringify(entry, null, 2)
    }).catch(() => {});
  }

  return entry;
}

export function getRecentErrors(limit = 50) {
  return loadLog().slice(0, limit);
}

export function getErrorStats() {
  const log = loadLog();
  const last24h = log.filter((e) => Date.now() - new Date(e.at).getTime() < 86400000);
  return {
    total: log.length,
    last24h: last24h.length,
    critical: log.filter((e) => e.severity === "critical").length,
    recent: log.slice(0, 10)
  };
}
