/**
 * Routes marketplace v1.0 — panier, annonces étendues, vendeur, SEO, factures.
 */
import { Router } from "express";
import {
  getCart, addToCart, updateCartQty, removeFromCart, clearCart, createOrdersFromCart
} from "../lib/marketplace/v1/cart.js";
import {
  createListingV1, updateListingV1, getListingV1, getListingV1BySlug,
  deleteListingV1, listSellerListings, getListingsSitemapEntries
} from "../lib/marketplace/v1/listings.js";
import {
  assertSellerSession, assertSellerOwnsListing, assertBuyerOwnsOrder, MarketplaceAuthError
} from "../lib/marketplace/v1/security.js";
import { getOrdersBySeller } from "../lib/marketplace/orders.js";
import { createCheckoutSession, isSumUpConfigured } from "../lib/marketplace/payments.js";
import { getOrder, getOrdersByBuyer } from "../lib/marketplace/orders.js";
import { createInvoiceForOrder, getInvoiceHtmlByOrder, exportAccountingCsv } from "../lib/marketplace/v1/invoices.js";
import { createDispute, listDisputes, resolveDispute } from "../lib/marketplace/v1/disputes.js";
import { getMarketplaceStats } from "../lib/marketplace/v1/index.js";
import { registerSeller, getSeller } from "../lib/marketplace/sellers.js";
import { updateOrderStatus } from "../lib/marketplace/orders.js";
import { generateShippingLabel } from "../lib/marketplace/shipping.js";

const router = Router();

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
  const base = (process.env.MARKETPLACE_FRONTEND_URL || process.env.FRONTEND_URL || "https://cardoria.vercel.app").replace(/\/$/, "");
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
    assertSellerSession(body);
    let seller = getSeller(body.sellerId);
    if (!seller && body.sellerEmail) {
      seller = registerSeller({ email: body.sellerEmail, displayName: body.sellerName, sellerType: body.sellerType });
    }
    const listing = createListingV1({ ...body, sellerId: seller.id });
    res.json({ ok: true, listing, seller });
  } catch (e) {
    if (e instanceof MarketplaceAuthError) return authError(res, e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.put("/v1/listings/:id", (req, res) => {
  try {
    assertSellerSession(req.body);
    assertSellerOwnsListing(req.body.sellerId, req.params.id);
    const listing = updateListingV1(req.params.id, req.body.sellerId, req.body);
    res.json({ ok: true, listing });
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

router.post("/v1/cart/checkout", async (req, res) => {
  try {
    const body = req.body || {};
    const orders = createOrdersFromCart(body.userId, body);
    if (!isSumUpConfigured()) {
      return res.json({ ok: true, orders, paymentRequired: false, message: "SumUp non configuré" });
    }
    const sessions = [];
    for (const order of orders) {
      const session = await createCheckoutSession(
        order,
        body.successUrl || process.env.MARKETPLACE_SUCCESS_URL || "https://cardoria.vercel.app/marketplace-paiement-succes.html",
        body.cancelUrl || process.env.MARKETPLACE_CANCEL_URL || "https://cardoria.vercel.app/marketplace-paiement-echec.html"
      );
      sessions.push({ orderId: order.id, ...session });
    }
    res.json({ ok: true, orders, checkout: sessions.length === 1 ? sessions[0] : sessions });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
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
