import { Router } from "express";
import { readJson, writeJson } from "../lib/storage.js";
import { sendEmail } from "../lib/email.js";

const router = Router();

function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function recentMatchingEstimate({ customerEmail, cardName, cardId }) {
  const estimations = readJson("estimations", []);
  const email = clean(customerEmail, 200).toLowerCase();
  const name = clean(cardName, 250).toLowerCase();
  const id = clean(cardId, 250);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  return estimations.find((item) => {
    const created = Date.parse(item?.createdAt || "");
    if (!Number.isFinite(created) || created < cutoff) return false;
    if (id && String(item?.cardId || "") === id) return true;
    if (email && name) {
      return String(item?.customerEmail || "").trim().toLowerCase() === email &&
        String(item?.cardName || "").trim().toLowerCase() === name;
    }
    return false;
  }) || null;
}

router.post("/propositions", async (req, res) => {
  const body = req.body || {};

  // Champ honeypot : un utilisateur normal ne le remplit jamais.
  if (clean(body.website, 100)) {
    return res.status(400).json({ ok: false, error: "Requête invalide." });
  }

  if (clean(body.source, 50) !== "estimation") {
    return res.status(403).json({ ok: false, error: "Commencez par une estimation Cardoria." });
  }

  const customerName = clean(body.customerName, 150);
  const customerEmail = clean(body.customerEmail, 200);
  const cardName = clean(body.cardName, 250);
  const cardId = clean(body.cardId, 250);
  const message = clean(body.message, 1200);

  if (!customerEmail || !cardName) {
    return res.status(400).json({ ok: false, error: "Email et carte requis." });
  }

  const verifiedEstimate = recentMatchingEstimate({ customerEmail, cardName, cardId });
  if (!verifiedEstimate) {
    return res.status(403).json({ ok: false, error: "Estimation Cardoria récente introuvable. Relancez l’estimation avant de proposer la carte." });
  }

  const proposal = {
    id: `buy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    status: "Proposition reçue",
    source: "estimation",
    estimationId: verifiedEstimate.id,
    customerName: verifiedEstimate.customerName || customerName,
    customerEmail: verifiedEstimate.customerEmail || customerEmail,
    cardName: verifiedEstimate.cardName || cardName,
    cardGame: verifiedEstimate.cardGame || clean(body.cardGame, 100),
    cardId: verifiedEstimate.cardId || cardId,
    condition: verifiedEstimate.condition || clean(body.condition, 100),
    detection: verifiedEstimate.detection || null,
    estimationResult: verifiedEstimate.result || "",
    message
  };

  const purchases = readJson("purchases", []);
  purchases.unshift(proposal);
  writeJson("purchases", purchases.slice(0, 500));

  await sendEmail({
    subject: `[Cardoria] Proposition de vente — ${proposal.cardName}`,
    text: [
      "Nouvelle proposition de vente Cardoria",
      "",
      `Référence : ${proposal.id}`,
      `Estimation : ${proposal.estimationId}`,
      `Client : ${proposal.customerName || "—"}`,
      `Email : ${proposal.customerEmail}`,
      `Carte : ${proposal.cardName}`,
      `Licence : ${proposal.cardGame || "—"}`,
      `État : ${proposal.condition || "—"}`,
      `Message : ${proposal.message || "Aucun"}`,
      "",
      "Cette proposition provient d’une estimation Cardoria vérifiée des dernières 24 h."
    ].join("\n")
  });

  res.status(201).json({ ok: true, id: proposal.id, message: "Votre proposition a bien été transmise à Cardoria." });
});

export default router;
