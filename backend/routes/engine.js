/**
 * API publique du moteur Cardoria — catalogue, recherche, estimation prix.
 */
import { Router } from "express";
import { listLicenses, getLicense } from "../lib/engine/licenses.js";
import { searchCards, getCardById, getCardBySlug, autocomplete, getSitemapCards, getCardCount } from "../lib/engine/cards.js";
import { estimatePrice } from "../lib/engine/pricing.js";
import { getCatalogAuditSummary, listCatalogAuditReferences, getImageHostAudit } from "../lib/engine/catalog-audit.js";
import "../lib/engine/catalog-audit-log.js";
import "../lib/engine/catalog-green-repair.js";
import { cacheGet, cacheSet } from "../lib/cache.js";

const router = Router();

router.get("/licenses", (req, res) => {
  const key = "licenses:all";
  let licenses = cacheGet(key);
  if (!licenses) { licenses = listLicenses(); cacheSet(key, licenses, 120_000); }
  res.setHeader("Cache-Control", "public, max-age=120");
  res.json({ ok: true, licenses });
});

router.get("/licenses/:slug", (req, res) => {
  const license = getLicense(req.params.slug);
  if (!license) return res.status(404).json({ ok: false, error: "Licence introuvable" });
  res.json({ ok: true, license });
});

router.get("/catalog-audit", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, ...getCatalogAuditSummary() });
});

router.get("/catalog-audit/references", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, ...listCatalogAuditReferences({ category: req.query.category, language: req.query.language, page: req.query.page, limit: req.query.limit }) });
});

router.get("/catalog-audit/images", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, ...getImageHostAudit() });
});

router.get("/cards", (req, res) => {
  const result = searchCards({ q: req.query.q, license: req.query.license, language: req.query.language, extension: req.query.extension, rarity: req.query.rarity, page: req.query.page, limit: req.query.limit, sort: req.query.sort });
  res.json({ ok: true, ...result });
});

router.get("/cards/search", (req, res) => res.json({ ok: true, results: autocomplete(req.query.q, req.query.limit) }));

router.get("/cards/:id", (req, res) => {
  if (req.params.id.includes("-") && req.query.bySlug !== "1") {
    const parts = req.params.id.split("-"), license = parts[0], slug = parts.slice(1).join("-");
    const bySlug = getCardBySlug(license, slug, { trackView: true });
    if (bySlug) return res.json({ ok: true, card: bySlug });
  }
  const card = getCardById(req.params.id, { trackView: true });
  if (!card) return res.status(404).json({ ok: false, error: "Carte introuvable" });
  res.json({ ok: true, card });
});

router.get("/cards/:license/:slug", (req, res) => {
  const card = getCardBySlug(req.params.license, req.params.slug, { trackView: true });
  if (!card) return res.status(404).json({ ok: false, error: "Carte introuvable" });
  res.json({ ok: true, card });
});

router.post("/estimate-price", (req, res) => {
  const { cardId, condition } = req.body || {};
  if (!cardId) return res.status(400).json({ ok: false, error: "cardId requis" });
  const estimate = estimatePrice(cardId, condition);
  if (!estimate) return res.status(404).json({ ok: false, error: "Carte introuvable" });
  res.json({ ok: true, estimate });
});

router.get("/sitemap", (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1), limit = Math.min(Number(req.query.limit) || 500, 5000), offset = (page - 1) * limit;
  const cards = getSitemapCards(limit, offset), total = getCardCount();
  res.json({ ok: true, cards: cards.map((c) => ({ url: `/carte.html?license=${c.license_slug}&slug=${c.slug}`, license: c.license_slug, language: c.language || "fr", slug: c.slug, updatedAt: c.updated_at })), pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } });
});

export default router;