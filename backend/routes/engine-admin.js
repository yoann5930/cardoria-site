/**
 * Administration du moteur Cardoria — licences et cartes.
 */
import { Router } from "express";
import { requireAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { listLicenses, getLicense, createLicense, updateLicense, deleteLicense } from "../lib/engine/licenses.js";
import { searchCards, getCardById, createCard, updateCard, deleteCard } from "../lib/engine/cards.js";
import { setPriceSources, addSaleRecord, estimatePrice } from "../lib/engine/pricing.js";

const router = Router();
router.use(requireAdmin);

router.get("/licenses", (req, res) => {
  res.json({ ok: true, licenses: listLicenses({ activeOnly: false }) });
});

router.post("/licenses", (req, res) => {
  try {
    const license = createLicense(req.body || {});
    logAudit({ type: "engine", action: "license_create", user: "admin", detail: license.slug });
    res.json({ ok: true, license });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.put("/licenses/:slug", (req, res) => {
  const license = updateLicense(req.params.slug, req.body || {});
  if (!license) return res.status(404).json({ ok: false, error: "Licence introuvable" });
  logAudit({ type: "engine", action: "license_update", user: "admin", detail: req.params.slug });
  res.json({ ok: true, license });
});

router.delete("/licenses/:slug", (req, res) => {
  try {
    deleteLicense(req.params.slug);
    logAudit({ type: "engine", action: "license_delete", user: "admin", detail: req.params.slug });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get("/cards", (req, res) => {
  res.json({ ok: true, ...searchCards({ ...req.query, activeOnly: false }) });
});

router.get("/cards/:id", (req, res) => {
  const card = getCardById(req.params.id);
  if (!card) return res.status(404).json({ ok: false, error: "Carte introuvable" });
  res.json({ ok: true, card });
});

router.post("/cards", (req, res) => {
  try {
    const card = createCard(req.body || {});
    logAudit({ type: "engine", action: "card_create", user: "admin", detail: card.id });
    res.json({ ok: true, card });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.put("/cards/:id", (req, res) => {
  const card = updateCard(req.params.id, req.body || {});
  if (!card) return res.status(404).json({ ok: false, error: "Carte introuvable" });
  logAudit({ type: "engine", action: "card_update", user: "admin", detail: req.params.id });
  res.json({ ok: true, card });
});

router.delete("/cards/:id", (req, res) => {
  if (!deleteCard(req.params.id)) return res.status(404).json({ ok: false, error: "Carte introuvable" });
  logAudit({ type: "engine", action: "card_delete", user: "admin", detail: req.params.id });
  res.json({ ok: true });
});

router.put("/cards/:id/prices", (req, res) => {
  const card = getCardById(req.params.id);
  if (!card) return res.status(404).json({ ok: false, error: "Carte introuvable" });
  const prices = setPriceSources(req.params.id, req.body?.sources || []);
  logAudit({ type: "engine", action: "price_update", user: "admin", detail: req.params.id });
  res.json({ ok: true, prices, card: getCardById(req.params.id) });
});

router.post("/cards/:id/sales", (req, res) => {
  const card = getCardById(req.params.id);
  if (!card) return res.status(404).json({ ok: false, error: "Carte introuvable" });
  const history = addSaleRecord(req.params.id, req.body || {});
  logAudit({ type: "engine", action: "sale_add", user: "admin", detail: req.params.id });
  res.json({ ok: true, salesHistory: history, card: getCardById(req.params.id) });
});

router.post("/estimate-price", (req, res) => {
  const estimate = estimatePrice(req.body?.cardId, req.body?.condition);
  if (!estimate) return res.status(404).json({ ok: false, error: "Carte introuvable" });
  res.json({ ok: true, estimate });
});

export default router;
