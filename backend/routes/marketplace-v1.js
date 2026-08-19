/**
 * Routes marketplace v1.0 — panier, annonces étendues, vendeur, SEO, factures.
 */
import { Router } from "express";
import {
  getCart, addToCart, updateCartQty, removeFromCart, clearCart
} from "../lib/marketplace/v1/cart.js";
import {
  createListingV1, updateListingV1, getListingV1, getListingV1BySlug,
  deleteListingV1, listSellerListings, getListingsSitemapEntries
} from "../lib/marketplace/v1/listings.js";
import {
  assertSellerSession, assertSellerOwnsListing, assertBuyerOwnsOrder, MarketplaceAuthError
} from "../lib/marketplace/v1/security.js";
import { getOrdersBySeller } from "../lib/marketplace/orders.js";
import { getOrder, getOrdersByBuyer } from "../lib/marketplace/orders.js";
import { createInvoiceForOrder, getInvoiceHtmlByOrder } from "../lib/marketplace/v1/invoices.js";
import { createDispute } from "../lib/marketplace/v1/disputes.js";
import { getMarketplaceStats } from "../lib/marketplace/v1/index.js";
import { registerSeller, getSeller } from "../lib/marketplace/sellers.js";
import { updateOrderStatus } from "../lib/marketplace/orders.js";
import { isMarketplaceDemoMode } from "../lib/marketplace/demo-mode.js";
import paypalMarketplaceRoutes from "./marketplace-paypal.js";

const router = Router();
router.use(paypalMarketplaceRoutes);

function authError(res, e) {
  return res.status(e.code || 403).json({ ok: false, error: e.message });
}

router.get("/v1/stats", (req, res) => {
  res.json({ ok: true, stats: getMarketplaceStats() });
});

router.get("/v1/sitemap/listings", (req, res) => {
  res.json({ ok: true, entries: getListingsSitemapEntries(Number(req.query.limit) || 5000) });
});

router.get("/v1/sitemap.xml", (req, res) => {
  const base = (process.env.MARKETPLACE_FRONTEND_URL || process.env.FRONTEND_URL || "https://cardoria-site-2.onrender.com").replace(/\/$/, "");
  const entries = getListingsSitemapEntries(Number(req.query.limit) || 5000);
  const urls = entries.map((e) =>
    "  <url><loc>" + base + e.url + "</loc>" +
    (e.lastmod ? "<lastmod>" + e.lastmod + "</lastmod>" : "") +
    "<changefreq>daily</changefreq><priority>0.7</priority></url>"
  ).join("\n");
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + "\n</urlset>";
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.send(xml);
});

router.get("/v1/orders", (req, res) => {
  const email = req.query.email || "";
  const userId = req.query.userId || "";
  if (!email) return res.status(400).json({ ok: false, error: "Email requis" });
  res.json({ ok: true, orders: getOrdersByBuyer(email, userId) });
});

router.get("/v1/listings/slug/:slug", (req, res) => {
  const listing = getListingV1BySlug(req.params.slug, { trackView: true });
  if (!listing) return res.status(404).json({ ok: false, error: "Annonce introuvable" });
  res.json({ ok: true, listing });
});

router.get("/v1/listings/:id", (req, res) => {
  const listing = getListingV1(req.params.id, { trackView: true });
  if (!listing) return res.status(404).json({ ok: false, error: "Annonce introuvable" });
  res.json({ ok: true, listing });
});

router.post("/v1/listings", (req, res) => {
  try {
    const body = req.body || {};
    let seller = body.sellerId ? getSeller(body.sellerId) : null;
    if (!seller && body.sellerEmail) {
      seller = registerSeller({ email: body.sellerEmail, displayName: body.sellerName, sellerType: body.sellerType });
    }
    if (!seller) throw new MarketplaceAuthError("Vendeur requis", 400);
    assertSellerSession({ sellerId: seller.id, sellerEmail: body.sellerEmail || seller.email });
    if (body.status !== "draft" && !seller.paypalReady && !isMarketplaceDemoMode()) {
      throw new MarketplaceAuthError("Activez d'abord votre compte vendeur PayPal avant de publier une annonce.", 409);
    }
    const listing = createListingV1({ ...body, sellerId: seller.id });
    res.json({ ok: true, listing, seller, demoMode: isMarketplaceDemoMode() });
  } catch (e) {
    if (e instanceof MarketplaceAuthError) return authError(res, e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.put("/v1/listings/:id", (req, res) => {
  try {
    const seller = assertSellerSession(req.body);
    assertSellerOwnsListing(req.body.sellerId, req.params.id);
    if (req.body.status === "active" && !seller.paypalReady && !isMarketplaceDemoMode()) {
      throw new MarketplaceAuthError("Activez d'abord votre compte vendeur PayPal avant de publier l'annonce.", 409);
    }
    const listing = updateListingV1(req.params.id, req.body.sellerId, req.body);
    res.json({ ok: true, listing, demoMode: isMarketplaceDemoMode() });
  } catch (e) {
    if (e instanceof MarketplaceAuthError) return authError(res, e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.delete("/v1/listings/:id", (req, res) => {
  try {
    assertSellerSession(req.query);
    deleteListingV1(req.params.id, req.query.sellerId);
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof MarketplaceAuthError) return authError(res, e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get("/v1/sellers/:id/listings", (req, res) => {
  try {
    assertSellerSession({ sellerId: req.params.id, sellerEmail: req.query.sellerEmail });
    res.json({ ok: true, listings: listSellerListings(req.params.id, req.query) });
  } catch (e) {
    if (e instanceof MarketplaceAuthError) return authError(res, e);
    res.status(403).json({ ok: false, error: e.message });
  }
});

router.get("/v1/sellers/:id/orders", (req, res) => {
  try {
    assertSellerSession({ sellerId: req.params.id, sellerEmail: req.query.sellerEmail });
    res.json({ ok: true, orders: getOrdersBySeller(req.params.id) });
  } catch (e) {
    if (e instanceof MarketplaceAuthError) return authError(res, e);
    res.status(403).json({ ok: false, error: e.message });
  }
});

router.put("/v1/sellers/:id/orders/:orderId/tracking", (req, res) => {
  try {
    assertSellerSession(req.body);
    if (req.body.sellerId !== req.params.id) throw new MarketplaceAuthError("Vendeur invalide");
    const order = updateOrderStatus(req.params.orderId, req.body.status || "shipped", {
      tracking: req.body.tracking,
      labelUrl: req.body.labelUrl
    });
    res.json({ ok: true, order });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get("/v1/cart/:userId", (req, res) => {
  res.json({ ok: true, cart: getCart(req.params.userId) });
});

router.post("/v1/cart/add", (req, res) => {
  try {
    const body = req.body || {};
    res.json({ ok: true, cart: addToCart(body.userId, body.listingId, body.qty || 1) });
  } catch (e) {
    if (e instanceof MarketplaceAuthError) return authError(res, e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.put("/v1/cart/qty", (req, res) => {
  try {
    const body = req.body || {};
    res.json({ ok: true, cart: updateCartQty(body.userId, body.listingId, body.qty) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.delete("/v1/cart/item", (req, res) => {
  const body = req.body || {};
  res.json({ ok: true, cart: removeFromCart(body.userId, body.listingId) });
});

router.delete("/v1/cart/:userId", (req, res) => {
  res.json({ ok: true, cart: clearCart(req.params.userId) });
});

/**
 * Ancien checkout Marketplace SumUp désactivé.
 * SumUp reste réservé à la Boutique Cardoria ; la Marketplace C2C passe par PayPal.
 */
router.post("/v1/cart/checkout", (req, res) => {
  res.status(410).json({
    ok: false,
    error: "Ce checkout Marketplace est désactivé. Utilisez le paiement PayPal Marketplace.",
    replacement: "/api/marketplace/v1/paypal/checkout"
  });
});

router.get("/v1/orders/secure/:id", (req, res) => {
  try {
    assertBuyerOwnsOrder(req.params.id, req.query.email, req.query.userId);
    res.json({ ok: true, order: getOrder(req.params.id) });
  } catch (e) {
    if (e instanceof MarketplaceAuthError) return authError(res, e);
    res.status(404).json({ ok: false, error: e.message });
  }
});

router.get("/v1/orders/:id/invoice", (req, res) => {
  try {
    if (req.query.email) assertBuyerOwnsOrder(req.params.id, req.query.email, req.query.userId);
    const html = getInvoiceHtmlByOrder(req.params.id);
    if (!html) return res.status(404).json({ ok: false, error: "Facture introuvable" });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e) {
    if (e instanceof MarketplaceAuthError) return authError(res, e);
    res.status(404).json({ ok: false, error: e.message });
  }
});

router.post("/v1/orders/:id/invoice", (req, res) => {
  const inv = createInvoiceForOrder(req.params.id, req.body?.vatRate);
  res.json({ ok: true, invoice: inv });
});

router.post("/v1/disputes", (req, res) => {
  try {
    const dispute = createDispute(req.body || {});
    res.json({ ok: true, dispute });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

export default router;

export function marketplaceV1AdminRouter() {
  const admin = Router();
  return admin;
}
