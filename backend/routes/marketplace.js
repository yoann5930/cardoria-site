/**
 * API publique marketplace Cardoria.
 */
import { Router } from "express";
import { searchListings, getListing, createListing, updateListing, deleteListing } from "../lib/marketplace/listings.js";
import { registerSeller, getSeller, getSellerReviews } from "../lib/marketplace/sellers.js";
import { createOrder, getOrder, getOrdersByBuyer, getInvoiceHtml } from "../lib/marketplace/orders.js";
import { getShippingOptions, calculateShipping, generateShippingLabel } from "../lib/marketplace/shipping.js";
import { createCheckoutSession, isSumUpConfigured } from "../lib/marketplace/payments.js";
import { addFavorite, removeFavorite, getFavorites, addWishlistItem, getWishlist, removeWishlistItem, createPriceAlert, getPriceAlerts, deletePriceAlert } from "../lib/marketplace/social.js";
import { comparePrices } from "../lib/marketplace/compare.js";
import { addReview } from "../lib/marketplace/sellers.js";
import { recordWitnotRegistration, resolveTrafficSource } from "../lib/attribution/witnot.js";

const router = Router();

router.get("/listings", (req, res) => {
  res.json({ ok: true, ...searchListings(req.query) });
});

router.get("/listings/:id", (req, res) => {
  const listing = getListing(req.params.id, { trackView: true });
  if (!listing) return res.status(404).json({ ok: false, error: "Annonce introuvable" });
  res.json({ ok: true, listing });
});

router.post("/listings", (req, res) => {
  try {
    const body = req.body || {};
    let seller = getSeller(body.sellerId);
    if (!seller && body.sellerEmail) {
      seller = registerSeller({ email: body.sellerEmail, displayName: body.sellerName, sellerType: body.sellerType });
    }
    if (!seller) return res.status(400).json({ ok: false, error: "Vendeur requis" });
    const listing = createListing({ ...body, sellerId: seller.id });
    res.json({ ok: true, listing, seller });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.put("/listings/:id", (req, res) => {
  const listing = updateListing(req.params.id, req.body.sellerId, req.body);
  if (!listing) return res.status(404).json({ ok: false, error: "Annonce introuvable" });
  res.json({ ok: true, listing });
});

router.delete("/listings/:id", (req, res) => {
  if (!deleteListing(req.params.id, req.query.sellerId)) {
    return res.status(404).json({ ok: false, error: "Annonce introuvable" });
  }
  res.json({ ok: true });
});

router.get("/sellers/:id", (req, res) => {
  const seller = getSeller(req.params.id);
  if (!seller) return res.status(404).json({ ok: false, error: "Vendeur introuvable" });
  const reviews = getSellerReviews(req.params.id);
  const listings = searchListings({ sellerId: req.params.id, limit: 24 });
  res.json({ ok: true, seller, reviews, listings: listings.listings });
});

router.post("/sellers/register", (req, res) => {
  try {
    const seller = registerSeller(req.body || {});
    const source = resolveTrafficSource(req, req.body || {}) || req.body?.trafficSource;
    if (source === "witnot" && seller?.email) {
      recordWitnotRegistration({
        email: seller.email,
        visitorId: req.body?.visitorId,
        trafficSource: "witnot",
        meta: { type: "marketplace_seller" }
      });
    }
    res.json({ ok: true, seller });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get("/shipping/options", (req, res) => {
  res.json({ ok: true, options: getShippingOptions() });
});

router.post("/shipping/quote", (req, res) => {
  try {
    const price = calculateShipping(req.body.carrier, req.body.weightKg);
    res.json({ ok: true, price, carrier: req.body.carrier });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/orders", (req, res) => {
  try {
    const order = createOrder(req.body || {});
    res.json({ ok: true, order });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get("/orders/:id", (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ ok: false, error: "Commande introuvable" });
  res.json({ ok: true, order });
});

router.get("/orders", (req, res) => {
  const orders = getOrdersByBuyer(req.query.email || "", req.query.userId || "");
  res.json({ ok: true, orders });
});

router.get("/orders/:id/invoice", (req, res) => {
  const html = getInvoiceHtml(req.params.id);
  if (!html) return res.status(404).json({ ok: false, error: "Commande introuvable" });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

router.post("/checkout", async (req, res) => {
  try {
    if (!isSumUpConfigured()) {
      return res.status(503).json({ ok: false, error: "Paiement SumUp non configuré. Définir SUMUP_API_KEY et SUMUP_MERCHANT_CODE." });
    }
    const { orderId, successUrl, cancelUrl } = req.body || {};
    const order = getOrder(orderId);
    if (!order) return res.status(404).json({ ok: false, error: "Commande introuvable" });
    const session = await createCheckoutSession(
      order,
      successUrl || process.env.MARKETPLACE_SUCCESS_URL || "https://cardoria.vercel.app/mes-commandes.html",
      cancelUrl || process.env.MARKETPLACE_CANCEL_URL || "https://cardoria.vercel.app/marketplace.html"
    );
    res.json({ ok: true, ...session });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/reviews", (req, res) => {
  try {
    const seller = addReview(req.body || {});
    res.json({ ok: true, seller });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get("/favorites/:userId", (req, res) => {
  res.json({ ok: true, favorites: getFavorites(req.params.userId) });
});

router.post("/favorites", (req, res) => {
  try {
    const favorites = addFavorite(req.body.userId, req.body.listingId);
    res.json({ ok: true, favorites });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.delete("/favorites", (req, res) => {
  const favorites = removeFavorite(req.body.userId, req.body.listingId);
  res.json({ ok: true, favorites });
});

router.get("/wishlist/:userId", (req, res) => {
  res.json({ ok: true, wishlist: getWishlist(req.params.userId) });
});

router.post("/wishlist", (req, res) => {
  const item = addWishlistItem(req.body.userId, req.body);
  res.json({ ok: true, item });
});

router.delete("/wishlist/:userId/:itemId", (req, res) => {
  removeWishlistItem(req.params.userId, req.params.itemId);
  res.json({ ok: true });
});

router.get("/alerts/:userId", (req, res) => {
  res.json({ ok: true, alerts: getPriceAlerts(req.params.userId) });
});

router.post("/alerts", (req, res) => {
  const alert = createPriceAlert(req.body || {});
  res.json({ ok: true, alert });
});

router.delete("/alerts/:userId/:alertId", (req, res) => {
  deletePriceAlert(req.params.userId, req.params.alertId);
  res.json({ ok: true });
});

router.get("/compare", (req, res) => {
  res.json({ ok: true, ...comparePrices(req.query) });
});

router.get("/search", (req, res) => {
  const start = Date.now();
  const result = searchListings({ ...req.query, limit: req.query.limit || 24 });
  res.json({ ok: true, ...result, ms: Date.now() - start });
});

export default router;
