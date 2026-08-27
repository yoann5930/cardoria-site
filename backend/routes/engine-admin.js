/**
 * Administration du moteur Cardoria — licences, cartes et suivi marché.
 */
import { Router } from "express";
import { requireAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { listLicenses, createLicense, updateLicense, deleteLicense } from "../lib/engine/licenses.js";
import { searchCards, getCardById, createCard, updateCard, deleteCard, getCatalogFacets } from "../lib/engine/cards.js";
import { setPriceSources, addSaleRecord, estimatePrice } from "../lib/engine/pricing.js";
import { syncPokemonCatalog, syncPokemonReferenceCatalog, getMarketPriceStatus, getCardPriceHistory } from "../lib/engine/tcgdex-sync.js";
import { refreshVisibleCardPrices } from "../lib/engine/visible-prices.js";
import "../lib/engine/daily-market-sync.js";

const router = Router();
router.use(requireAdmin);

router.get("/licenses", (req, res) => res.json({ ok: true, licenses: listLicenses({ activeOnly: false }) }));
router.get("/catalog/facets", (req, res) => res.json({ ok: true, ...getCatalogFacets({ license: req.query.license || "pokemon" }) }));
router.get("/market-prices/status", (req, res) => res.json({ ok: true, ...getMarketPriceStatus() }));
router.post("/market-prices/visible", async (req, res) => {
  try {
    const result = await refreshVisibleCardPrices(req.body?.ids || []);
    res.json({ ok: true, ...result, marketStatus: getMarketPriceStatus() });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message || "Actualisation des cartes visibles impossible" });
  }
});
router.get("/cards/:id/price-history", (req, res) => {
  const card = getCardById(req.params.id);
  if (!card) return res.status(404).json({ ok: false, error: "Carte introuvable" });
  res.json({ ok: true, cardId: req.params.id, history: getCardPriceHistory(req.params.id, req.query.limit) });
});

router.post("/licenses", (req, res) => {
  try { const license = createLicense(req.body || {}); logAudit({ type: "engine", action: "license_create", user: "admin", detail: license.slug }); res.json({ ok: true, license }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.put("/licenses/:slug", (req, res) => {
  const license = updateLicense(req.params.slug, req.body || {}); if (!license) return res.status(404).json({ ok: false, error: "Licence introuvable" });
  logAudit({ type: "engine", action: "license_update", user: "admin", detail: req.params.slug }); res.json({ ok: true, license });
});
router.delete("/licenses/:slug", (req, res) => {
  try { deleteLicense(req.params.slug); logAudit({ type: "engine", action: "license_delete", user: "admin", detail: req.params.slug }); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

router.post("/sync/pokemon", async (req, res) => {
  try { const result = await syncPokemonCatalog({ force: true }); logAudit({ type: "engine", action: "pokemon_catalog_sync", user: "admin", detail: `${result.count || 0} cartes` }); res.json({ ok: true, ...result }); }
  catch (e) { res.status(502).json({ ok: false, error: e.message || "Synchronisation Pokémon impossible" }); }
});
router.post("/sync/pokemon-reference", async (req, res) => {
  try {
    const priceLimit = Math.min(Math.max(Number(req.body?.priceLimit) || 120, 0), 2000);
    const result = await syncPokemonReferenceCatalog({ priceLimit, skipRarities: Boolean(req.body?.skipRarities) });
    logAudit({ type: "engine", action: "pokemon_reference_sync", user: "admin", detail: `${result.rarityUpdated || 0} raretés, ${result.priced || 0} prix` });
    res.json({ ok: true, ...result, marketStatus: getMarketPriceStatus() });
  } catch (e) { res.status(502).json({ ok: false, error: e.message || "Enrichissement Pokémon impossible" }); }
});

router.get("/cards", (req, res) => res.json({ ok: true, ...searchCards({ ...req.query, activeOnly: false }) }));
router.get("/cards/:id", (req, res) => { const card = getCardById(req.params.id); if (!card) return res.status(404).json({ ok: false, error: "Carte introuvable" }); res.json({ ok: true, card }); });
router.post("/cards", (req, res) => {
  try { const card = createCard(req.body || {}); logAudit({ type: "engine", action: "card_create", user: "admin", detail: card.id }); res.json({ ok: true, card }); }
  catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
router.put("/cards/:id", (req, res) => { const card = updateCard(req.params.id, req.body || {}); if (!card) return res.status(404).json({ ok: false, error: "Carte introuvable" }); logAudit({ type: "engine", action: "card_update", user: "admin", detail: req.params.id }); res.json({ ok: true, card }); });
router.delete("/cards/:id", (req, res) => { if (!deleteCard(req.params.id)) return res.status(404).json({ ok: false, error: "Carte introuvable" }); logAudit({ type: "engine", action: "card_delete", user: "admin", detail: req.params.id }); res.json({ ok: true }); });
router.put("/cards/:id/prices", (req, res) => { const card = getCardById(req.params.id); if (!card) return res.status(404).json({ ok: false, error: "Carte introuvable" }); const prices = setPriceSources(req.params.id, req.body?.sources || []); logAudit({ type: "engine", action: "price_update", user: "admin", detail: req.params.id }); res.json({ ok: true, prices, card: getCardById(req.params.id) }); });
router.post("/cards/:id/sales", (req, res) => { const card = getCardById(req.params.id); if (!card) return res.status(404).json({ ok: false, error: "Carte introuvable" }); const history = addSaleRecord(req.params.id, req.body || {}); logAudit({ type: "engine", action: "sale_add", user: "admin", detail: req.params.id }); res.json({ ok: true, salesHistory: history, card: getCardById(req.params.id) }); });
router.post("/estimate-price", (req, res) => { const estimate = estimatePrice(req.body?.cardId, req.body?.condition); if (!estimate) return res.status(404).json({ ok: false, error: "Carte introuvable" }); res.json({ ok: true, estimate }); });

export default router;