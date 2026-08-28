import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const proposalFile = path.join(dataDir, "rachat-proposals.json");
const purchasesFile = path.join(dataDir, "purchases.json");
const ordersFile = path.join(dataDir, "orders.json");

function readFile(file, fallback = []) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeFile(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2)); }

const originalProposals = readFile(proposalFile);
const originalPurchases = readFile(purchasesFile);
const originalOrders = readFile(ordersFile);

try {
  const workflow = await import("../lib/rachat/workflow.js");
  const stock = await import("../lib/boutique/stock.js");

  const proposal = workflow.createRachatProposal({
    estimate: {
      id: "est-ci-rachat",
      createdAt: new Date().toISOString(),
      customerName: "Client CI",
      customerEmail: "client-ci@cardoria.invalid",
      cardName: "Carte CI Rachat",
      cardGame: "Pokemon",
      cardId: "",
      condition: "NM",
      result: "Estimation CI"
    },
    message: "Test workflow complet"
  });

  assert.equal(proposal.status, "Proposition reçue");
  assert.equal(readFile(purchasesFile).some((item) => item.id === proposal.id), false, "Une proposition ne doit jamais entrer dans purchases.");

  const review = workflow.startRachatReview(proposal.id, { user: "ci-admin" });
  assert.equal(review.status, "À vérifier");

  const offerResult = await workflow.sendRachatOffer(proposal.id, { amount: 12.34, note: "Offre CI", expiresDays: 2, user: "ci-admin" });
  assert.equal(offerResult.proposal.status, "Offre envoyée");
  assert.equal(offerResult.proposal.offer.amount, 12.34);
  assert.match(offerResult.offerUrl, /rachat-suivi\.html/);

  const url = new URL(offerResult.offerUrl);
  const token = url.searchParams.get("token");
  assert.ok(token && token.length >= 32);

  const accepted = workflow.decideRachatOffer(proposal.id, { token, decision: "accepted", user: "client" });
  assert.equal(accepted.status, "Acceptée");

  const received = workflow.markRachatCardReceived(proposal.id, {
    receivedCondition: "NM",
    authenticityConfirmed: true,
    note: "Authenticité CI validée",
    user: "ci-admin"
  });
  assert.equal(received.status, "Carte reçue");
  assert.equal(received.received.authenticityConfirmed, true);

  const paid = await workflow.markRachatPaid(proposal.id, {
    amount: 12.34,
    method: "especes",
    buyer: "yoann",
    boutiquePrice: 24.90,
    boutiqueEnabled: true,
    user: "ci-admin"
  });

  assert.equal(paid.proposal.status, "Payée");
  assert.equal(paid.purchase.status, "paid");
  assert.equal(paid.purchase.purchaseType, "pokemon_card");
  assert.equal(paid.purchase.source, "rachat");
  assert.equal(paid.purchase.rachatProposalId, proposal.id);
  assert.equal(paid.purchase.amount, 12.34);

  const purchaseRows = readFile(purchasesFile);
  const actualPurchase = purchaseRows.find((item) => item.id === paid.purchase.id);
  assert.ok(actualPurchase, "L'achat réel doit exister après paiement.");
  assert.equal(purchaseRows.some((item) => item.id === proposal.id), false, "La proposition ne doit toujours pas être comptabilisée comme achat.");

  const inventory = stock.listBoutiqueInventory({ includeDisabled: true });
  const line = inventory.find((item) => (item.purchaseIds || []).includes(paid.purchase.id));
  assert.ok(line, "La carte payée doit apparaître dans le stock Boutique.");
  assert.equal(line.baseStock, 1);
  assert.equal(line.stock, 1);
  assert.equal(line.boutiqueEnabled, true);
  assert.equal(line.boutiquePrice, 24.90);

  console.log("Rachat E2E PASS", { proposalId: proposal.id, purchaseId: paid.purchase.id, stockId: line.id });
} finally {
  writeFile(proposalFile, originalProposals);
  writeFile(purchasesFile, originalPurchases);
  writeFile(ordersFile, originalOrders);
}
