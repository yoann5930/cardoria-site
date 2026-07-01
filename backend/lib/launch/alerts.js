/**
 * Alertes automatiques si service critique en panne.
 */
import { getHealthReport } from "../monitoring/health.js";
import { sendEmail } from "../email.js";
import { logAudit } from "../audit.js";

let lastAlertAt = 0;
const COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS || 3600000);

export async function checkAndAlert() {
  const report = getHealthReport();
  const failures = [];
  if (!report.checks.database.ok) failures.push("SQLite");
  if (!report.checks.sumup.configured && process.env.NODE_ENV === "production") failures.push("SumUp non configuré");
  if (!report.checks.smtp.configured && process.env.ALERT_EMAIL === "true") failures.push("SMTP");

  if (!failures.length) return { ok: true, alerted: false };

  if (Date.now() - lastAlertAt < COOLDOWN_MS) {
    return { ok: true, alerted: false, skipped: "cooldown", failures };
  }

  const to = process.env.ADMIN_EMAIL || process.env.MAIL_TO;
  if (!to || process.env.ALERT_EMAIL !== "true") {
    return { ok: true, alerted: false, failures, note: "ALERT_EMAIL non activé" };
  }

  const subject = `[Cardoria] Alerte santé — ${failures.join(", ")}`;
  const body = `Alerte automatique Cardoria V1\n\nServices en échec : ${failures.join(", ")}\n\nTimestamp : ${report.timestamp}\nVersion : ${report.version}`;

  try {
    await sendEmail({ to, subject, text: body });
    lastAlertAt = Date.now();
    logAudit({ type: "system", action: "health_alert", user: "system", detail: failures.join(",") });
    return { ok: true, alerted: true, failures };
  } catch (e) {
    return { ok: false, error: e.message, failures };
  }
}

export function startAlertScheduler(intervalMs = Number(process.env.HEALTH_ALERT_INTERVAL_MS || 900000)) {
  if (intervalMs <= 0) return;
  setInterval(() => { checkAndAlert().catch(() => {}); }, intervalMs);
}
