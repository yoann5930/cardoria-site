/**
 * Liaison catalogue — fiche existante ou proposition en attente.
 */
import { searchCards, getCardById } from "../engine/cards.js";
import { matchCatalogCard } from "../ai/smart-estimate.js";
import { getDb } from "../engine/database.js";
import { makePendingCardId } from "./migrate.js";

export function resolveCatalogLink(detection, hintedCardId = null) {
  if (hintedCardId) {
    const card = getCardById(hintedCardId);
    if (card) return { cardId: card.id, card, matchType: "hint", pendingProposal: null };
  }

  const matched = matchCatalogCard(detection);
  if (matched) {
    return { cardId: matched.id, card: matched, matchType: "catalog", pendingProposal: null };
  }

  if (!detection?.name) {
    return { cardId: null, card: null, matchType: "none", pendingProposal: null };
  }

  const q = [detection.name, detection.number].filter(Boolean).join(" ");
  const fuzzy = searchCards({ q, license: detection.license || "", limit: 1 });
  if (fuzzy.cards?.[0]) {
    const c = fuzzy.cards[0];
    return { cardId: c.id, card: c, matchType: "fuzzy", pendingProposal: null };
  }

  return { cardId: null, card: null, matchType: "none", pendingProposal: detection };
}

export function createPendingCardProposal(scanId, detection) {
  if (!detection?.name) return null;

  const db = getDb();
  const id = makePendingCardId();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO scanner_pending_cards (
      id, scan_id, license_slug, name, extension, card_number, rarity, language, version,
      detection_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    id,
    scanId,
    detection.license || "",
    detection.name,
    detection.extension || "",
    detection.number || "",
    detection.rarity || "",
    detection.language || "",
    detection.version || "",
    JSON.stringify(detection),
    now
  );

  return { id, status: "pending", detection, createdAt: now };
}

export function listPendingCards({ status = "pending", limit = 50 } = {}) {
  const db = getDb();
  let sql = "SELECT * FROM scanner_pending_cards";
  const params = [];
  if (status) {
    sql += " WHERE status = ?";
    params.push(status);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params).map(mapPending);
}

export function updatePendingCard(id, { status, adminNote }) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE scanner_pending_cards SET status = ?, admin_note = COALESCE(?, admin_note), reviewed_at = ?
    WHERE id = ?
  `).run(status, adminNote || null, now, id);
  const row = db.prepare("SELECT * FROM scanner_pending_cards WHERE id = ?").get(id);
  return row ? mapPending(row) : null;
}

function mapPending(row) {
  return {
    id: row.id,
    scanId: row.scan_id,
    license: row.license_slug,
    name: row.name,
    extension: row.extension,
    number: row.card_number,
    rarity: row.rarity,
    language: row.language,
    version: row.version,
    detection: JSON.parse(row.detection_json || "{}"),
    status: row.status,
    adminNote: row.admin_note,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at
  };
}
