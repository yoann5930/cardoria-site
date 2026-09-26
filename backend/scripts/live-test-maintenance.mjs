import fs from "node:fs";
import path from "node:path";

const mode = String(process.argv[2] || "audit").toLowerCase();
if (!["audit", "cleanup"].includes(mode)) {
  console.error("usage: node live-test-maintenance.mjs <audit|cleanup>");
  process.exit(2);
}

const dataDir = path.resolve(process.env.CARDORIA_DATA_DIR || path.join(process.cwd(), "data"));
const files = {
  sessions: "live-sessions.json",
  actions: "live-actions.json",
  archives: "live-archives.json",
  realtime: "live-realtime-publishers.json",
  shipments: "live-shipments.json",
  audit: "audit-log.json",
  legacyMarker: "live-test-cleanup-20260916.json"
};

const read = (name, fallback) => {
  const file = path.join(dataDir, name);
  if (!fs.existsSync(file)) return structuredClone(fallback);
  return JSON.parse(fs.readFileSync(file, "utf8"));
};
const write = (name, value) => {
  const file = path.join(dataDir, name);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
};

const store = read(files.sessions, { sessions: [], checkouts: [], adminAccess: [] });
const sessions = Array.isArray(store.sessions) ? store.sessions : [];
const checkouts = Array.isArray(store.checkouts) ? store.checkouts : [];
const archivesStore = read(files.archives, { archives: [] });
const archives = Array.isArray(archivesStore.archives) ? archivesStore.archives : [];
const shipments = read(files.shipments, []);
const shipmentRows = Array.isArray(shipments) ? shipments : [];

const protectedStatuses = new Set([
  "paid", "completed", "authorized", "authorised", "refunded",
  "refund_reconciliation_required", "reconciliation_required"
]);
const obviousTestTitle = /(^|[\\s\\-_:])(test|tests|essai|essais|demo|démo|e2e|qa|debug|camera\\s*\\d*|caméra\\s*\\d*|scheduled public|live public|elite pokemon public)([\\s\\-_:]|$)/i;

function isProtected(liveId) {
  const related = checkouts.filter((row) => String(row?.liveId || "") === liveId);
  if (related.some((row) =>
    protectedStatuses.has(String(row?.status || "").toLowerCase()) ||
    String(row?.paymentProviderTransactionId || "").trim()
  )) return true;

  const archive = archives.find((row) => String(row?.liveId || "") === liveId);
  if (Number(archive?.totals?.paidAmount || 0) > 0 || Number(archive?.totals?.paidPurchases || 0) > 0) return true;

  const relatedShipments = shipmentRows.filter((row) => String(row?.liveId || "") === liveId);
  return relatedShipments.some((row) =>
    String(row?.trackingNumber || "").trim() ||
    String(row?.sendcloudShipmentId || "").trim() ||
    String(row?.mondialRelayShipmentNumber || "").trim()
  );
}

function isCandidate(session) {
  const id = String(session?.id || "");
  const title = String(session?.title || "").trim();
  const status = String(session?.status || "").toLowerCase();
  const ownerId = String(session?.ownerId || "").toLowerCase();
  const ownerEmail = String(session?.ownerEmail || "").toLowerCase();

  const explicitTest =
    obviousTestTitle.test(title) ||
    ownerEmail.endsWith("@cardoria.invalid") ||
    /(^|[-_:])(test|e2e|camera|qa|debug)([-_:]|$)/i.test(ownerId);

  const legacyDefaultTest =
    String(session?.ownerRole || "").toLowerCase() === "admin" &&
    ownerId === "cardoria" &&
    title === "Live Cardoria" &&
    ["draft", "ended", "cancelled"].includes(status);

  if (!explicitTest && !legacyDefaultTest) return false;
  return !isProtected(id);
}

const candidates = sessions.filter(isCandidate);
const candidateIds = new Set(candidates.map((row) => String(row.id)));
const protectedMatching = sessions.filter((row) => {
  const title = String(row?.title || "").trim();
  const ownerEmail = String(row?.ownerEmail || "").toLowerCase();
  const looksTest = obviousTestTitle.test(title) || ownerEmail.endsWith("@cardoria.invalid");
  return looksTest && isProtected(String(row?.id || ""));
});

console.log("=== LIVE TEST MAINTENANCE ===");
console.log("mode:", mode);
console.log("data_dir:", dataDir);
console.log("sessions_total:", sessions.length);
console.log("test_candidates:", candidates.length);
console.log("protected_test_like:", protectedMatching.length);
for (const row of candidates) {
  console.log("candidate:", JSON.stringify({
    id: row.id,
    title: row.title,
    status: row.status,
    ownerRole: row.ownerRole,
    createdAt: row.createdAt
  }));
}
for (const row of protectedMatching) {
  console.log("protected:", JSON.stringify({
    id: row.id,
    title: row.title,
    status: row.status,
    reason: "payment_or_shipment"
  }));
}

if (mode === "audit") process.exit(0);
if (!candidateIds.size) {
  console.log("removed_live_tests: 0");
  process.exit(0);
}

store.sessions = sessions.filter((row) => !candidateIds.has(String(row?.id || "")));
store.checkouts = checkouts.filter((row) => !candidateIds.has(String(row?.liveId || "")));
store.adminAccess = (Array.isArray(store.adminAccess) ? store.adminAccess : [])
  .filter((row) => !candidateIds.has(String(row?.liveId || "")));
write(files.sessions, store);

const actions = read(files.actions, { states: {} });
if (actions?.states && typeof actions.states === "object") {
  for (const id of candidateIds) delete actions.states[id];
  write(files.actions, actions);
}

archivesStore.archives = archives.filter((row) => !candidateIds.has(String(row?.liveId || "")));
write(files.archives, archivesStore);

const realtime = read(files.realtime, { lives: [] });
if (Array.isArray(realtime?.lives)) {
  realtime.lives = realtime.lives.filter((row) => !candidateIds.has(String(row?.liveId || "")));
  write(files.realtime, realtime);
}

write(files.shipments, shipmentRows.filter((row) => !candidateIds.has(String(row?.liveId || ""))));

const audit = read(files.audit, []);
if (Array.isArray(audit)) {
  const cleanedAudit = audit.filter((row) => {
    const raw = JSON.stringify(row);
    for (const id of candidateIds) if (raw.includes(id)) return false;
    return true;
  });
  write(files.audit, cleanedAudit);
}

const legacyMarker = path.join(dataDir, files.legacyMarker);
try { if (fs.existsSync(legacyMarker)) fs.unlinkSync(legacyMarker); } catch {}

console.log("removed_live_tests:", candidateIds.size);
console.log("remaining_sessions:", store.sessions.length);
console.log("remaining_archives:", archivesStore.archives.length);
console.log("remaining_shipments:", shipmentRows.filter((row) => !candidateIds.has(String(row?.liveId || ""))).length);
