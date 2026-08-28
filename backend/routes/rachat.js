import { Router } from "express";
import { readJson } from "../lib/storage.js";
import { sendEmail } from "../lib/email.js";
import {
  createRachatProposal,
  getPublicRachatOffer,
  decideRachatOffer
} from "../lib/rachat/workflow.js";

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

  if (!email || !name) return null;

  return estimations.find((item) => {
    const created = Date.parse(item?.createdAt || "");
    if (!Number.isFinite(created) || created < cutoff) return false;

    const sameEmail = String(item?.customerEmail || "").trim().toLowerCase() === email;
    if (!sameEmail) return false;

    const sameCardId = id && String(item?.cardId || "") === id;
    const sameCardName = String(item?.cardName || "").trim().toLowerCase() === name;
    return Boolean(sameCardId || sameCardName);
  }) || null;
}

router.post("/propositions", async (req, res) => {
  const body = req.body || {};

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

  try {
    const proposal = createRachatProposal({
      estimate: verifiedEstimate,
      customerName,
      customerEmail,
      cardName,
      cardGame: clean(body.cardGame, 100),
      cardId,
      condition: clean(body.condition, 100),
      message
    });

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
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message });
  }
});

router.get("/offres/:id", (req, res) => {
  try {
    const offer = getPublicRachatOffer(req.params.id, req.query.token);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, offer });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message });
  }
});

router.post("/offres/:id/decision", (req, res) => {
  try {
    const proposal = decideRachatOffer(req.params.id, {
      token: req.body?.token,
      decision: req.body?.decision,
      user: "client"
    });
    res.json({
      ok: true,
      status: proposal.status,
      decision: proposal.customerDecision?.decision || ""
    });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message });
  }
});

export default router;
