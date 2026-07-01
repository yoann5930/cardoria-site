/**
 * Détection automatique des cartes exceptionnelles.
 */
import { getDb } from "../engine/database.js";
import { getCardById } from "../engine/cards.js";

const RULES = [
  { type: "misprint", re: /misprint|erreur d'impression|error card|print error|faute d'impression/i, label: "Erreur d'impression détectée", severity: "high" },
  { type: "shadowless", re: /shadowless|sans ombre/i, label: "Variante Shadowless", severity: "high" },
  { type: "first_edition", re: /1(?:er|ère|st)\s*édition|first edition|1st edition|edition 1/i, label: "First Edition", severity: "high" },
  { type: "limited", re: /limited|limitée|promo|event|prerelease|prérelease|tournament/i, label: "Édition limitée / promo", severity: "medium" },
  { type: "very_rare", re: /secret rare|ghost rare|manga rare|illustration rare|alternate art|gold rare|hyper rare|ultimate rare/i, label: "Carte très rare", severity: "medium" },
  { type: "factory_defect", re: /factory|fabrique|défaut|defect|off-center|découpe|cut error/i, label: "Défaut de fabrication possible", severity: "medium" },
  { type: "variant", re: /reverse|holo|full art|rainbow|texture|parallel|variante|alt art|sp/i, label: "Variante spéciale", severity: "info" }
];

export function detectExceptionalTraits({ cardId, detection = {}, cardNotes = "" } = {}) {
  const card = cardId ? getCardById(cardId) : null;
  const blob = [
    card?.name, card?.rarity, card?.extension, card?.number,
    detection?.name, detection?.rarity, detection?.extension, detection?.version, detection?.language,
    cardNotes
  ].filter(Boolean).join(" ");

  const alerts = [];
  for (const rule of RULES) {
    if (rule.re.test(blob)) {
      alerts.push({
        type: rule.type,
        label: rule.label,
        severity: rule.severity,
        details: { matched: rule.re.source }
      });
    }
  }

  if (card?.rarity && /secret|ultra|rare holo/i.test(card.rarity) && !alerts.some((a) => a.type === "very_rare")) {
    alerts.push({ type: "very_rare", label: "Carte très rare", severity: "medium", details: { rarity: card.rarity } });
  }

  return alerts;
}

export function recordExceptionalAlerts({ cardId, analysisId = "", detection = {}, cardNotes = "", notify = true }) {
  const traits = detectExceptionalTraits({ cardId, detection, cardNotes });
  if (!traits.length) return { alerts: [], created: 0 };

  const db = getDb();
  const now = new Date().toISOString();
  let created = 0;

  const ins = db.prepare(`
    INSERT INTO ultimate_exceptional_alerts (
      card_id, analysis_id, alert_type, label, severity, details_json, notified, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  traits.forEach((t) => {
    const dup = db.prepare(`
      SELECT id FROM ultimate_exceptional_alerts
      WHERE card_id = ? AND alert_type = ? AND created_at >= datetime('now', '-7 days')
    `).get(cardId || "", t.type);
    if (dup) return;

    ins.run(
      cardId || "", analysisId, t.type, t.label, t.severity,
      JSON.stringify(t.details || {}), notify ? 1 : 0, now
    );
    created++;
  });

  return { alerts: traits, created };
}

export function getExceptionalAlertsForCard(cardId, limit = 20) {
  return getDb().prepare(`
    SELECT * FROM ultimate_exceptional_alerts WHERE card_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(cardId, limit).map(mapAlert);
}

export function getRecentExceptionalAlerts(limit = 50) {
  return getDb().prepare(`
    SELECT * FROM ultimate_exceptional_alerts ORDER BY created_at DESC LIMIT ?
  `).all(limit).map(mapAlert);
}

function mapAlert(r) {
  return {
    id: r.id,
    cardId: r.card_id,
    analysisId: r.analysis_id,
    type: r.alert_type,
    label: r.label,
    severity: r.severity,
    details: JSON.parse(r.details_json || "{}"),
    createdAt: r.created_at
  };
}

export function buildClientExceptionalAlert(traits) {
  if (!traits?.length) return null;
  const top = traits.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];
  return {
    title: "Carte exceptionnelle détectée",
    message: traits.map((t) => t.label).join(" · "),
    severity: top.severity,
    count: traits.length
  };
}

function severityRank(s) {
  return { high: 3, medium: 2, info: 1 }[s] || 0;
}
