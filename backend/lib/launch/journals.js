/**
 * Journaux dédiés lancement V1 — connexions, paiements, estimations.
 * Fichiers JSONL dans data/journals/ (compatible rotation PostgreSQL future).
 */
import fs from "fs";
import path from "path";
import { DATA_DIR } from "../storage.js";

const JOURNAL_DIR = path.join(DATA_DIR, "journals");
const MAX_LINES = Number(process.env.JOURNAL_MAX_LINES || 10000);

const FILES = {
  connections: "connections.jsonl",
  payments: "payments.jsonl",
  estimations: "estimations.jsonl"
};

function ensureDir() {
  fs.mkdirSync(JOURNAL_DIR, { recursive: true });
}

function append(type, entry) {
  ensureDir();
  const file = path.join(JOURNAL_DIR, FILES[type]);
  const row = JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n";
  fs.appendFileSync(file, row, "utf8");
  rotateIfNeeded(file);
}

function rotateIfNeeded(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  if (lines.length <= MAX_LINES) return;
  const kept = lines.slice(-MAX_LINES);
  fs.writeFileSync(file, kept.join("\n") + "\n", "utf8");
}

export function logConnection({ method, path: p, ip, status, ms, userAgent = "" }) {
  append("connections", { method, path: p, ip, status, ms, userAgent: String(userAgent).slice(0, 200) });
}

export function logPayment({ orderId, checkoutId, amount, status, provider = "sumup", meta = {} }) {
  append("payments", { orderId, checkoutId, amount, status, provider, ...meta });
}

export function logEstimation({ email, license, confidence, source = "api", ms = 0 }) {
  append("estimations", { email: email ? String(email).slice(0, 80) : "", license, confidence, source, ms });
}

export function readJournal(type, limit = 100) {
  ensureDir();
  const file = path.join(JOURNAL_DIR, FILES[type]);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  return lines.slice(-limit).reverse().map((line) => {
    try { return JSON.parse(line); } catch { return { raw: line }; }
  });
}

export function getJournalStats() {
  const stats = {};
  Object.keys(FILES).forEach((key) => {
    const file = path.join(JOURNAL_DIR, FILES[key]);
    if (!fs.existsSync(file)) {
      stats[key] = { lines: 0, sizeKb: 0 };
      return;
    }
    const content = fs.readFileSync(file, "utf8");
    stats[key] = {
      lines: content.split("\n").filter(Boolean).length,
      sizeKb: Math.round(content.length / 1024)
    };
  });
  return stats;
}
