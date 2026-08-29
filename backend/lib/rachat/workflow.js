import crypto from "crypto";
import { readJson, writeJson } from "../storage.js";
import { sendEmail } from "../email.js";
import { logAudit } from "../audit.js";

export const RACHAT_STATUSES = [
  "Proposition reçue",
  "À vérifier",
  "Offre envoyée",
  "Acceptée",
  "Refusée",
  "Carte reçue",
  "Payée"
];

const STORE = "rachat-proposals";
const PURCHASES_STORE = "purchases";
const DEFAULT_PROPOSALS = [];
const DEFAULT_PURCHASES = [];
const DECISION_TTL_DAYS = 14;

function clean(value, max = 500) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function nowIso() {
  return new Date().toISOString();
}

function proposalId() {
  return `buy_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function purchaseId() {
  return `ach_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (!left.length || left.length !== right.length) return false;
  try { return crypto.timingSafeEqual(left, right); } catch { return false; }
}

function isLegacyProposal(item) {
  if (!item) return false;
  const id = String(item.id || "").toLowerCase();
  const source = String(item.source || "").toLowerCase();
  const status = String(item.status || "");
  return id.startsWith("buy_") || (source === "estimation" && RACHAT_STATUSES.includes(status) && !item.purchaseType);
}

function normalizeHistory(item) {
  if (Array.isArray(item.history) && item.history.length) return item.history;
  return [{ at: item.createdAt || nowIso(), status: item.status || "Proposition reçue", user: "migration", note: "Proposition migrée vers le workflow Rachat." }];
}

export function migrateLegacyRachatProposals() {
  const purchases = readJson(PURCHASES_STORE, DEFAULT_PURCHASES);
  const proposals = readJson(STORE, DEFAULT_PROPOSALS);
  const known = new Set(proposals.map((item) => String(item.id)));
  const legacy = purchases.filter(isLegacyProposal);
  if (!legacy.length) return { migrated: 0 };

  let migrated = 0;
  for (const item of legacy) {
    if (known.has(String(item.id))) continue;
    proposals.unshift({
      ...item,
      status: RACHAT_STATUSES.includes(item.status) ? item.status : "Proposition reçue",
      updatedAt: item.updatedAt || item.createdAt || nowIso(),
      history: normalizeHistory(item),
      offer: item.offer || null,
      customerDecision: item.customerDecision || null,
      received: item.received || null,
      payment: item.payment || { status: "unpaid" },
      purchaseId: item.purchaseId || ""
    });
    known.add(String(item.id));
    migrated += 1;
  }

  writeJson(STORE, proposals.slice(0, 2000));
  writeJson(PURCHASES_STORE, purchases.filter((item) => !isLegacyProposal(item)));
  if (migrated) logAudit({ type: "rachat", action: "legacy_migration", user: "system", detail: `${migrated} proposition(s) retirée(s) des achats comptables.` });
  return { migrated };
}

migrateLegacyRachatProposals();

export function listRachatProposals({ status = "", q = "", limit = 1000 } = {}) {
  const wantedStatus = clean(status, 80);
  const query = clean(q, 200).toLowerCase();
  return readJson(STORE, DEFAULT_PROPOSALS)
    .filter((item) => !wantedStatus || wantedStatus === "all" || item.status === wantedStatus)
    .filter((item) => !query || JSON.stringify(item).toLowerCase().includes(query))
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .slice(0, Math.max(1, Math.min(5000, Number(limit) || 1000)));
}

export function getRachatProposal(id) {
  return readJson(STORE, DEFAULT_PROPOSALS).find((item) => String(item.id) === String(id)) || null;
}

function saveProposal(proposal) {
  const proposals = readJson(STORE, DEFAULT_PROPOSALS);
  const index = proposals.findIndex((item) => String(item.id) === String(proposal.id));
  if (index < 0) proposals.unshift(proposal);
  else proposals[index] = proposal;
  writeJson(STORE, proposals.slice(0, 2000));
  return proposal;
}

function addHistory(proposal, status, user, note = "") {
  proposal.history = Array.isArray(proposal.history) ? proposal.history : [];
  proposal.history.push({ at: nowIso(), status, user: clean(user, 200) || "admin", note: clean(note, 1200) });
  proposal.updatedAt = nowIso();
}

function assertStatus(proposal, allowed) {
  if (!allowed.includes(proposal.status)) {
    const error = new Error(`Action impossible depuis le statut « ${proposal.status} ».`);
    error.status = 409;
    throw error;
  }
}

export function createRachatProposal({ estimate, customerName, customerEmail, cardName, cardGame, cardId, condition, message } = {}) {
  if (!estimate) throw Object.assign(new Error("Estimation Cardoria vérifiée requise."), { status: 403 });
  const email = clean(estimate.customerEmail || customerEmail, 200).toLowerCase();
  const name = clean(estimate.cardName || cardName, 250);
  if (!email || !name) throw Object.assign(new Error("Email et carte requis."), { status: 400 });

  const createdAt = nowIso();
  const proposal = {
    id: proposalId(),
    createdAt,
    updatedAt: createdAt,
    status: "Proposition reçue",
    source: "estimation",
    estimationId: estimate.id || "",
    customerName: clean(estimate.customerName || customerName, 150),
    customerEmail: email,
    cardName: name,
    cardGame: clean(estimate.cardGame || cardGame, 100),
    cardId: clean(estimate.cardId || cardId, 250),
    condition: clean(estimate.condition || condition, 100),
    detection: estimate.detection || null,
    estimationResult: estimate.result || "",
    message: clean(message, 1200),
    history: [{ at: createdAt, status: "Proposition reçue", user: "client", note: "Proposition issue d’une estimation Cardoria vérifiée." }],
    offer: null,
    customerDecision: null,
    received: null,
    payment: { status: "unpaid" },
    purchaseId: "",
    stockReference: ""
  };
  saveProposal(proposal);
  logAudit({ type: "rachat", action: "proposal_created", user: proposal.customerEmail, detail: `${proposal.id} — ${proposal.cardName}` });
  return proposal;
}

export function startRachatReview(id, { user = "admin", note = "" } = {}) {
  const proposal = getRachatProposal(id);
  if (!proposal) throw Object.assign(new Error("Proposition introuvable."), { status: 404 });
  assertStatus(proposal, ["Proposition reçue"]);
  proposal.status = "À vérifier";
  addHistory(proposal, proposal.status, user, note || "Vérification de la carte et de l’estimation démarrée.");
  saveProposal(proposal);
  logAudit({ type: "rachat", action: "review_started", user, detail: proposal.id });
  return proposal;
}

function publicBaseUrl() {
  return clean(process.env.SITE_URL || process.env.FRONTEND_URL || "https://cardoria-site-f2cy.onrender.com", 500).replace(/\/$/, "");
}

export async function sendRachatOffer(id, { amount, note = "", expiresDays = DECISION_TTL_DAYS, user = "admin" } = {}) {
  const proposal = getRachatProposal(id);
  if (!proposal) throw Object.assign(new Error("Proposition introuvable."), { status: 404 });
  assertStatus(proposal, ["À vérifier", "Offre envoyée"]);
  const offerAmount = money(amount);
  if (!(offerAmount > 0)) throw Object.assign(new Error("Montant de l’offre invalide."), { status: 400 });

  const token = crypto.randomBytes(32).toString("hex");
  const days = Math.max(1, Math.min(30, Math.trunc(Number(expiresDays) || DECISION_TTL_DAYS)));
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  const offerUrl = `${publicBaseUrl()}/rachat-suivi.html?id=${encodeURIComponent(proposal.id)}&token=${encodeURIComponent(token)}`;
  const sentAt = nowIso();
  const emailSent = await sendEmail({
    to: proposal.customerEmail,
    subject: `[Cardoria] Offre de rachat — ${proposal.cardName}`,
    text: [
      `Bonjour${proposal.customerName ? ` ${proposal.customerName}` : ""},`,
      "",
      `Cardoria vous propose ${offerAmount.toFixed(2).replace(".", ",")} € pour votre carte ${proposal.cardName}.`,
      proposal.condition ? `État indiqué : ${proposal.condition}` : "",
      note ? `Message Cardoria : ${clean(note, 1200)}` : "",
      "",
      `Répondez à l’offre ici : ${offerUrl}`,
      `Offre valable jusqu’au ${new Date(expiresAt).toLocaleDateString("fr-FR")}.`,
      "",
      `Référence : ${proposal.id}`
    ].filter(Boolean).join("\n")
  });

  proposal.status = "Offre envoyée";
  proposal.offer = {
    amount: offerAmount,
    note: clean(note, 1200),
    sentAt,
    expiresAt,
    emailSent,
    decisionTokenHash: hashToken(token)
  };
  proposal.customerDecision = null;
  addHistory(proposal, proposal.status, user, `Offre ${offerAmount.toFixed(2)} EUR${emailSent ? " envoyée par e-mail" : " préparée ; e-mail non envoyé"}.`);
  saveProposal(proposal);
  logAudit({ type: "rachat", action: "offer_sent", user, detail: `${proposal.id} — ${offerAmount} EUR — email:${emailSent ? "yes" : "no"}` });
  return { proposal, offerUrl, emailSent };
}

function validateDecisionToken(proposal, token) {
  const expected = proposal?.offer?.decisionTokenHash || "";
  if (!expected || !safeEqual(expected, hashToken(token))) throw Object.assign(new Error("Lien d’offre invalide."), { status: 403 });
  if (Date.parse(proposal.offer.expiresAt || "") < Date.now()) throw Object.assign(new Error("Cette offre a expiré."), { status: 410 });
}

export function getPublicRachatOffer(id, token) {
  const proposal = getRachatProposal(id);
  if (!proposal) throw Object.assign(new Error("Offre introuvable."), { status: 404 });
  validateDecisionToken(proposal, token);
  return {
    id: proposal.id,
    status: proposal.status,
    cardName: proposal.cardName,
    cardGame: proposal.cardGame,
    condition: proposal.condition,
    customerName: proposal.customerName,
    offer: proposal.offer ? { amount: proposal.offer.amount, note: proposal.offer.note, sentAt: proposal.offer.sentAt, expiresAt: proposal.offer.expiresAt } : null,
    customerDecision: proposal.customerDecision ? { decision: proposal.customerDecision.decision, at: proposal.customerDecision.at } : null
  };
}

export function decideRachatOffer(id, { token, decision, user = "client" } = {}) {
  const proposal = getRachatProposal(id);
  if (!proposal) throw Object.assign(new Error("Offre introuvable."), { status: 404 });
  validateDecisionToken(proposal, token);
  const normalized = String(decision || "").toLowerCase();
  if (!["accepted", "refused"].includes(normalized)) throw Object.assign(new Error("Décision invalide."), { status: 400 });
  if (!["Offre envoyée", "Acceptée", "Refusée"].includes(proposal.status)) throw Object.assign(new Error("Cette offre ne peut plus être modifiée."), { status: 409 });
  if (proposal.customerDecision) {
    if (proposal.customerDecision.decision === normalized) return proposal;
    throw Object.assign(new Error("Une décision a déjà été enregistrée pour cette offre."), { status: 409 });
  }
  proposal.status = normalized === "accepted" ? "Acceptée" : "Refusée";
  proposal.customerDecision = { decision: normalized, at: nowIso(), by: user };
  if (proposal.offer) delete proposal.offer.decisionTokenHash;
  addHistory(proposal, proposal.status, user, normalized === "accepted" ? "Offre acceptée par le client." : "Offre refusée par le client.");
  saveProposal(proposal);
  logAudit({ type: "rachat", action: normalized === "accepted" ? "offer_accepted" : "offer_refused", user: proposal.customerEmail || user, detail: proposal.id });
  return proposal;
}

export function adminDecideRachatOffer(id, { decision, user = "admin", note = "" } = {}) {
  const proposal = getRachatProposal(id);
  if (!proposal) throw Object.assign(new Error("Proposition introuvable."), { status: 404 });
  assertStatus(proposal, ["Offre envoyée"]);
  const normalized = String(decision || "").toLowerCase();
  if (!["accepted", "refused"].includes(normalized)) throw Object.assign(new Error("Décision invalide."), { status: 400 });
  proposal.status = normalized === "accepted" ? "Acceptée" : "Refusée";
  proposal.customerDecision = { decision: normalized, at: nowIso(), by: user, adminRecorded: true };
  if (proposal.offer) delete proposal.offer.decisionTokenHash;
  addHistory(proposal, proposal.status, user, note || `Décision client enregistrée par ${user}.`);
  saveProposal(proposal);
  logAudit({ type: "rachat", action: "decision_recorded", user, detail: `${proposal.id} — ${normalized}` });
  return proposal;
}

export function markRachatCardReceived(id, { receivedCondition = "", authenticityConfirmed = false, note = "", user = "admin" } = {}) {
  const proposal = getRachatProposal(id);
  if (!proposal) throw Object.assign(new Error("Proposition introuvable."), { status: 404 });
  assertStatus(proposal, ["Acceptée"]);
  if (authenticityConfirmed !== true) throw Object.assign(new Error("Confirmez l’authenticité avant d’enregistrer la réception."), { status: 400 });
  proposal.status = "Carte reçue";
  proposal.received = { at: nowIso(), condition: clean(receivedCondition, 100) || proposal.condition || "", authenticityConfirmed: true, note: clean(note, 1200) };
  addHistory(proposal, proposal.status, user, note || `Carte reçue et authenticité confirmée${proposal.received.condition ? ` — état ${proposal.received.condition}` : ""}.`);
  saveProposal(proposal);
  logAudit({ type: "rachat", action: "card_received", user, detail: proposal.id });
  return proposal;
}

function stockPreferenceLine(proposal, purchaseIdValue) {
  return proposal.cardId ? `card:${proposal.cardId}` : `purchase:${purchaseIdValue}`;
}

function createPurchaseFromProposal(proposal, { amount, method, reference, buyer, boutiquePrice, boutiqueEnabled } = {}) {
  const purchases = readJson(PURCHASES_STORE, DEFAULT_PURCHASES);
  if (proposal.purchaseId) {
    const existing = purchases.find((item) => String(item.id) === String(proposal.purchaseId));
    if (existing) return existing;
  }

  const paidAmount = money(amount || proposal.offer?.amount || 0);
  if (!(paidAmount > 0)) throw Object.assign(new Error("Montant payé invalide."), { status: 400 });
  const id = purchaseId();
  const stockKey = stockPreferenceLine(proposal, id);
  const price = money(boutiquePrice || 0);
  const enabled = boutiqueEnabled !== false;
  const pref = { condition: proposal.received?.condition || proposal.condition || "", boutique: enabled, boutiquePrice: price > 0 ? price : null };
  const createdAt = nowIso();
  const purchase = {
    id,
    createdAt,
    updatedAt: createdAt,
    date: createdAt.slice(0, 10),
    seller: clean(`${proposal.customerName || "Client"} <${proposal.customerEmail || ""}>`, 160),
    description: clean(proposal.cardName || "Carte Pokémon rachetée", 240),
    buyer: ["yoann", "valentin"].includes(String(buyer || "").toLowerCase()) ? String(buyer).toLowerCase() : "non_attribue",
    purchaseType: "pokemon_card",
    packaging: "carte_unite",
    category: "cartes",
    license: String(proposal.cardGame || "").toLowerCase().includes("pokemon") || !proposal.cardGame ? "pokemon" : clean(proposal.cardGame, 80).toLowerCase(),
    quantity: 1,
    amount: paidAmount,
    unitPrice: paidAmount,
    paymentMethod: clean(method, 80) || "autre",
    reference: proposal.cardId ? `catalog-card:${proposal.cardId}` : `rachat:${proposal.id}`,
    status: "paid",
    condition: proposal.received?.condition || proposal.condition || "",
    source: "rachat",
    rachatProposalId: proposal.id,
    notes: `[RACHAT] ${proposal.id}\n[STOCK_PREFS] ${JSON.stringify({ [stockKey]: pref })}`,
    createdBy: "rachat-workflow"
  };
  purchases.unshift(purchase);
  writeJson(PURCHASES_STORE, purchases);
  return purchase;
}

export async function markRachatPaid(id, { amount, method = "", reference = "", buyer = "", boutiquePrice = 0, boutiqueEnabled = true, user = "admin" } = {}) {
  const proposal = getRachatProposal(id);
  if (!proposal) throw Object.assign(new Error("Proposition introuvable."), { status: 404 });
  assertStatus(proposal, ["Carte reçue"]);
  if (!proposal.received?.authenticityConfirmed) throw Object.assign(new Error("Authenticité non confirmée."), { status: 409 });

  const paidAmount = money(amount || proposal.offer?.amount || 0);
  if (!(paidAmount > 0)) throw Object.assign(new Error("Montant payé invalide."), { status: 400 });
  const paymentMethod = clean(method, 80);
  if (!paymentMethod) throw Object.assign(new Error("Mode de paiement obligatoire."), { status: 400 });
  const paymentReference = clean(reference, 160);
  if (paymentMethod !== "especes" && !paymentReference) throw Object.assign(new Error("Référence du paiement obligatoire hors espèces."), { status: 400 });

  const purchase = createPurchaseFromProposal(proposal, { amount: paidAmount, method: paymentMethod, reference: paymentReference, buyer, boutiquePrice, boutiqueEnabled });
  proposal.status = "Payée";
  proposal.payment = { status: "paid", amount: paidAmount, method: paymentMethod, reference: paymentReference, paidAt: nowIso(), recordedBy: user };
  proposal.purchaseId = purchase.id;
  proposal.stockReference = purchase.reference;
  proposal.boutique = { enabled: boutiqueEnabled !== false, price: money(boutiquePrice || 0) || null };
  addHistory(proposal, proposal.status, user, `Paiement enregistré — achat réel ${purchase.id} créé et injecté au stock.`);
  saveProposal(proposal);
  logAudit({ type: "rachat", action: "paid_and_converted", user, detail: `${proposal.id} -> ${purchase.id} — ${paidAmount} EUR` });

  const emailed = await sendEmail({
    to: proposal.customerEmail,
    subject: `[Cardoria] Rachat finalisé — ${proposal.cardName}`,
    text: [
      `Bonjour${proposal.customerName ? ` ${proposal.customerName}` : ""},`,
      "",
      `Le rachat de votre carte ${proposal.cardName} est finalisé.`,
      `Montant enregistré : ${paidAmount.toFixed(2).replace(".", ",")} €`,
      `Référence Cardoria : ${proposal.id}`,
      paymentReference ? `Référence paiement : ${paymentReference}` : "",
      "",
      "Merci pour votre confiance."
    ].filter(Boolean).join("\n")
  });
  return { proposal, purchase, emailSent: emailed };
}

export function getRachatSummary() {
  const proposals = listRachatProposals({ limit: 5000 });
  const byStatus = Object.fromEntries(RACHAT_STATUSES.map((status) => [status, 0]));
  for (const proposal of proposals) byStatus[proposal.status] = (byStatus[proposal.status] || 0) + 1;
  return {
    total: proposals.length,
    byStatus,
    active: proposals.filter((item) => !["Refusée", "Payée"].includes(item.status)).length,
    offersToAnswer: byStatus["Offre envoyée"] || 0,
    acceptedToReceive: byStatus["Acceptée"] || 0,
    receivedToPay: byStatus["Carte reçue"] || 0,
    completed: byStatus["Payée"] || 0,
    paidAmount: money(proposals.filter((item) => item.status === "Payée").reduce((sum, item) => sum + Number(item.payment?.amount || 0), 0))
  };
}
