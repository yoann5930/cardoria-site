/**
 * Conformité RGPD — consentements, export, suppression.
 */
import { getDb } from "./engine/database.js";
import { readJson, writeJson } from "./storage.js";
import { getEstimations } from "../routes/estimation.js";

export function recordConsent({ visitorId = "", email = "", analytics = false, marketing = false, preferences = {}, ip = "" }) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = email
    ? db.prepare("SELECT id FROM gdpr_consents WHERE email = ? ORDER BY id DESC LIMIT 1").get(email.toLowerCase())
    : visitorId
      ? db.prepare("SELECT id FROM gdpr_consents WHERE visitor_id = ? ORDER BY id DESC LIMIT 1").get(visitorId)
      : null;

  if (existing) {
    db.prepare(`
      UPDATE gdpr_consents SET analytics = ?, marketing = ?, preferences_json = ?, ip = ?, updated_at = ?
      WHERE id = ?
    `).run(analytics ? 1 : 0, marketing ? 1 : 0, JSON.stringify(preferences), ip, now, existing.id);
    return { ok: true, updated: true };
  }

  db.prepare(`
    INSERT INTO gdpr_consents (visitor_id, email, analytics, marketing, preferences_json, ip, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(visitorId, (email || "").toLowerCase(), analytics ? 1 : 0, marketing ? 1 : 0, JSON.stringify(preferences), ip, now, now);

  return { ok: true, created: true };
}

export function exportPersonalData(email) {
  const key = String(email).toLowerCase();
  const estimations = getEstimations().filter((e) => (e.customerEmail || "").toLowerCase() === key);
  const orders = readJson("orders", []).filter((o) => (o.email || "").toLowerCase() === key);
  const user = getDb().prepare("SELECT id, email, role, name, created_at, last_login_at FROM auth_users WHERE email = ?").get(key);
  const consents = getDb().prepare("SELECT analytics, marketing, updated_at FROM gdpr_consents WHERE email = ?").all(key);

  return {
    exportedAt: new Date().toISOString(),
    email: key,
    account: user || null,
    estimations: estimations.map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      cardName: e.cardName,
      condition: e.condition
    })),
    orders: orders.map((o) => ({ id: o.id, date: o.date, total: o.total, status: o.status })),
    consents
  };
}

export function deletePersonalData(email, { confirmPhrase = "" } = {}) {
  if (confirmPhrase !== "SUPPRIMER") {
    throw Object.assign(new Error("Confirmation invalide — saisir SUPPRIMER."), { status: 400 });
  }

  const key = String(email).toLowerCase();
  const db = getDb();

  const estimations = readJson("estimations", []);
  const filtered = estimations.filter((e) => (e.customerEmail || "").toLowerCase() !== key);
  const removedEst = estimations.length - filtered.length;
  if (removedEst) writeJson("estimations", filtered);

  const orders = readJson("orders", []);
  let ordersChanged = false;
  const ordersFiltered = orders.map((o) => {
    if ((o.email || "").toLowerCase() === key) {
      ordersChanged = true;
      return { ...o, email: "[supprimé]", client: "[supprimé]", anonymized: true };
    }
    return o;
  });
  if (ordersChanged) writeJson("orders", ordersFiltered);

  const user = db.prepare("SELECT id FROM auth_users WHERE email = ?").get(key);
  if (user) {
    db.prepare("UPDATE auth_users SET active = 0, email = ?, name = '[supprimé]', updated_at = ? WHERE id = ?")
      .run(`deleted_${user.id}@anonymized.local`, new Date().toISOString(), user.id);
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(user.id);
  }

  return {
    ok: true,
    email: key,
    removedEstimations: removedEst,
    accountDeactivated: !!user
  };
}
