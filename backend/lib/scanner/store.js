/**
 * Persistance scans scanner.
 */
import { getDb } from "../engine/database.js";

export function saveScan(record) {
  const db = getDb();
  db.prepare(`
    INSERT INTO scanner_scans (
      id, analysis_id, created_at, customer_name, customer_email, card_id, pending_card_id,
      license_slug, photos_count, sides_json, confidence_score, suspicion_alert, suspicion_reasons,
      condition_grade, defects_json, detection_json, client_json, admin_json, status, admin_status,
      raw_response, multi_card_count, processing_ms, device_info, fallback_used
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.analysisId || null,
    record.createdAt,
    record.customerName || "",
    record.customerEmail || "",
    record.cardId || null,
    record.pendingCardId || null,
    record.licenseSlug || "",
    record.photosCount || 0,
    JSON.stringify(record.sides || []),
    record.confidenceScore,
    record.suspicionAlert ? 1 : 0,
    JSON.stringify(record.suspicionReasons || []),
    record.conditionGrade || "",
    JSON.stringify(record.defects || []),
    JSON.stringify(record.detection || {}),
    JSON.stringify(record.client || {}),
    JSON.stringify(record.admin || {}),
    record.status || "completed",
    record.adminStatus || "pending",
    record.rawResponse || "",
    record.multiCardCount || 1,
    record.processingMs || 0,
    record.deviceInfo || "",
    record.fallbackUsed ? 1 : 0
  );
  return getScan(record.id);
}

export function getScan(id) {
  const row = getDb().prepare("SELECT * FROM scanner_scans WHERE id = ?").get(id);
  return row ? mapScan(row) : null;
}

export function listScans({ suspicious, license, limit = 50, adminStatus } = {}) {
  const db = getDb();
  const clauses = [];
  const params = [];

  if (suspicious === true || suspicious === "1") {
    clauses.push("suspicion_alert = 1");
  }
  if (license) {
    clauses.push("license_slug = ?");
    params.push(license);
  }
  if (adminStatus) {
    clauses.push("admin_status = ?");
    params.push(adminStatus);
  }

  let sql = "SELECT * FROM scanner_scans";
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  return db.prepare(sql).all(...params).map(mapScan);
}

export function updateScanAdmin(id, { adminStatus, detection, adminPayload, adminNote }) {
  const db = getDb();
  const sets = ["admin_status = ?"];
  const params = [adminStatus || "reviewed"];

  if (detection) {
    sets.push("detection_json = ?");
    params.push(JSON.stringify(detection));
  }
  if (adminPayload) {
    sets.push("admin_json = ?");
    params.push(JSON.stringify(adminPayload));
  }

  params.push(id);
  db.prepare(`UPDATE scanner_scans SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  if (adminNote) {
    db.prepare("UPDATE ai_analyses SET admin_status = ? WHERE id = (SELECT analysis_id FROM scanner_scans WHERE id = ?)")
      .run(adminStatus || "reviewed", id);
  }

  return getScan(id);
}

export function getStatsByLicense() {
  const rows = getDb().prepare(`
    SELECT license_slug AS license,
      COUNT(*) AS scans,
      SUM(CASE WHEN suspicion_alert = 1 THEN 1 ELSE 0 END) AS suspicious,
      AVG(confidence_score) AS avgConfidence,
      AVG(processing_ms) AS avgProcessingMs
    FROM scanner_scans
    WHERE license_slug != ''
    GROUP BY license_slug
    ORDER BY scans DESC
  `).all();

  return rows.map((r) => ({
    license: r.license,
    scans: r.scans,
    suspicious: r.suspicious,
    avgConfidence: Math.round(r.avgConfidence || 0),
    avgProcessingMs: Math.round(r.avgProcessingMs || 0)
  }));
}

export function exportScansCsv(limit = 2000) {
  const scans = listScans({ limit });
  const header = [
    "id", "date", "email", "license", "carte", "extension", "numero", "etat",
    "confiance", "suspicion", "card_id", "processing_ms", "admin_status"
  ].join(";");

  const lines = scans.map((s) => {
    const d = s.detection || {};
    return [
      s.id,
      s.createdAt,
      s.customerEmail,
      s.licenseSlug || d.license,
      d.name || "",
      d.extension || "",
      d.number || "",
      s.conditionGrade,
      s.confidenceScore ?? "",
      s.suspicionAlert ? "oui" : "non",
      s.cardId || "",
      s.processingMs,
      s.adminStatus
    ].map(csvCell).join(";");
  });

  return header + "\n" + lines.join("\n");
}

function csvCell(v) {
  const s = String(v ?? "").replace(/"/g, '""');
  return s.includes(";") || s.includes('"') ? `"${s}"` : s;
}

function mapScan(row) {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    createdAt: row.created_at,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    cardId: row.card_id,
    pendingCardId: row.pending_card_id,
    licenseSlug: row.license_slug,
    photosCount: row.photos_count,
    sides: JSON.parse(row.sides_json || "[]"),
    confidenceScore: row.confidence_score,
    suspicionAlert: !!row.suspicion_alert,
    suspicionReasons: JSON.parse(row.suspicion_reasons || "[]"),
    conditionGrade: row.condition_grade,
    defects: JSON.parse(row.defects_json || "[]"),
    detection: JSON.parse(row.detection_json || "{}"),
    client: JSON.parse(row.client_json || "{}"),
    admin: JSON.parse(row.admin_json || "{}"),
    status: row.status,
    adminStatus: row.admin_status,
    rawResponse: row.raw_response,
    multiCardCount: row.multi_card_count,
    processingMs: row.processing_ms,
    deviceInfo: row.device_info,
    fallbackUsed: !!row.fallback_used
  };
}
