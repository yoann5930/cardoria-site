/**
 * Audit serveur — API, sécurité, doublons routes.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getHealthReport } from "../monitoring/health.js";
import { getJournalStats } from "./journals.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");

export function runServerAudit() {
  const issues = [];
  const warnings = [];
  const ok = [];

  const health = getHealthReport();
  Object.entries(health.checks).forEach(([name, check]) => {
    if (check.retired) {
      ok.push(`Service ${name} : retiré`);
      return;
    }
    if (check.ok || check.configured) ok.push(`Service ${name} : OK`);
    else warnings.push(`Service ${name} : non configuré ou en échec`);
  });

  if (!process.env.ADMIN_CODE && !process.env.ADMIN_INITIAL_PASSWORD) {
    warnings.push("Aucun ADMIN_CODE ni ADMIN_INITIAL_PASSWORD — auth admin à configurer");
  }
  if (process.env.NODE_ENV === "production" && !process.env.CORS_ORIGINS) {
    issues.push("CORS_ORIGINS non défini en production");
  }
  if (!process.env.REVOLUT_SECRET_KEY) warnings.push("REVOLUT_SECRET_KEY manquant — Boutique et Live Admin");
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    warnings.push("PayPal Marketplace non configuré — Marketplace et Live vendeur");
  }

  const envExample = path.join(ROOT, "backend", ".env.example");
  if (fs.existsSync(envExample)) ok.push(".env.example présent");

  const journals = getJournalStats();
  ok.push(`Journaux : ${Object.keys(journals).length} types actifs`);

  return {
    ok: issues.length === 0,
    timestamp: new Date().toISOString(),
    issues,
    warnings,
    passed: ok,
    score: Math.max(0, 100 - issues.length * 15 - warnings.length * 5)
  };
}
