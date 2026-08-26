/**
 * Routes Marketplace v1 — lectures publiques sanitisees, mutations authentifiees.
 */
import { Router } from "express";
import { getCart, addToCart, updateCartQty, removeFromCart, clearCart } from "../lib/marketplace/v1/cart.js";
import { createListingV1, updateListingV1, getListingV1, getListingV1BySlug, deleteListingV1, listSellerListings, getListingsSitemapEntries } from "../lib/marketplace/v1/listings.js";
import { searchListings } from "../lib/marketplace/listings.js";
import { getSeller, getSellerReviews } from "../lib/marketplace/sellers.js";
import { assertSellerSession, assertSellerOwnsListing, assertBuyerOwnsOrder, assertOrderParticipant, assertSellerOwnsOrder, getMarketplaceUser, MarketplaceAuthError } from "../lib/marketplace/v1/security.js";
import { getOrdersBySeller, getOrdersByBuyer, updateOrderStatus } from "../lib/marketplace/orders.js";
import { createInvoiceForOrder, getInvoiceHtmlByOrder } from "../lib/marketplace/v1/invoices.js";
import { createDispute } from "../lib/marketplace/v1/disputes.js";
import { getMarketplaceStats } from "../lib/marketplace/v1/index.js";
import { isMarketplaceDemoMode } from "../lib/marketplace/demo-mode.js";
import paypalMarketplaceRoutes from "./marketplace-paypal.js";

const router = Router();
router.use(paypalMarketplaceRoutes);

function fail(res, e, fallback = 400) { return res.status(e?.code || e?.status || fallback).json({ ok: false, error: e?.message || "Erreur Marketplace" }); }
function publicSeller(seller) {
  if (!seller) return null;
  return { id: seller.id, displayName: seller.displayName, sellerType: seller.sellerType, verified: seller.verified, avatar: seller.avatar || "", bio: seller.bio || "", ratingAvg: seller.ratingAvg, ratingCount: seller.ratingCount, salesCount: seller.salesCount, satisfactionRate: seller.satisfactionRate, createdAt: seller.createdAt };
}

router.get("/v1/stats", (req, res) => res.json({ ok: true, stats: getMarketplaceStats() }));
router.get("/v1/search", (req, res) => {
  try { const started = Date.now(); const result = searchListings(req.query || {}); res.json({ ok: true, ...result, ms: Date.now() - started }); }
  catch (e) { fail(res, e); }
});
router.get("/v1/sellers/:id/public", (req, res) => {
  const seller = getSeller(req.params.id);
  if (!seller) return res.status(404).json({ ok: false, error: "Vendeur introuvable" });
  const listings = searchListings({ sellerId: seller.id, page: 1, limit: 100, sort: "recent" }).listings;
  const reviews = getSellerReviews(seller.id, 20).map((review) => ({ rating: review.rating, comment: review.comment || "", createdAt: review.createdAt }));
  res.json({ ok: true, seller: publicSeller(seller), listings, reviews });
});
router.get("/v1/sitemap/listings", (req, res) => res.json({ ok: true, entries: getListingsSitemapEntries(Number(req.query.limit) || 5000) }));
router.get("/v1/sitemap.xml", (req, res) => {
  const base = (process.env.MARKETPLACE_FRONTEND_URL || process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const entries = getListingsSitemapEntries(Number(req.query.limit) || 5000);
  const urls = entries.map((e) => `  <url><loc>${base}${e.url}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}<changefreq>daily</changefreq><priority>0.7</priority></url>`).join("\n");
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
});
router.get("/v1/listings/slug/:slug", (req, res) => { const listing = getListingV1BySlug(req.params.slug, { trackView: true }); if (!listing) return res.status(404).json({ ok: false, error: "Annonce introuvable" }); res.json({ ok: true, listing }); });
router.get("/v1/listings/:id", (req, res) => { const listing = getListingV1(req.params.id, { trackView: true }); if (!listing) return res.status(404).json({ ok: false, error: "Annonce introuvable" }); res.json({ ok: true, listing }); });

router.post("/v1/listings", (req, res) => {
  try {
    const seller = assertSellerSession(req, req.body?.sellerId || "");
    if (req.body?.status !== "draft" && !seller.paypalReady && !isMarketplaceDemoMode()) throw new MarketplaceAuthError("Activez d'abord votre compte vendeur PayPal avant de publier une annonce.", 409);
    const listing = createListingV1({ ...(req.body || {}), sellerId: seller.id, sellerEmail: seller.email });
    res.status(201).json({ ok: true, listing, seller, demoMode: isMarketplaceDemoMode() });
  } catch (e) { fail(res, e); }
});
router.put("/v1/listings/:id", (req, res) => {
  try {
    const { seller } = assertSellerOwnsListing(req, req.params.id);
    if (req.body?.status === "active" && !seller.paypalReady && !isMarketplaceDemoMode()) throw new MarketplaceAuthError("Activez d'abord votre compte vendeur PayPal avant de publier l'annonce.", 409);
    const listing = updateListingV1(req.params.id, seller.id, req.body || {});
    res.json({ ok: true, listing, demoMode: isMarketplaceDemoMode() });
  } catch (e) { fail(res, e); }
});
router.delete("/v1/listings/:id", (req, res) => {
  try { const { seller } = assertSellerOwnsListing(req, req.params.id); deleteListingV1(req.params.id, seller.id); res.json({ ok: true }); }
  catch (e) { fail(res, e); }
});
router.get("/v1/sellers/:id/listings", (req, res) => {
  try { const seller = assertSellerSession(req, req.params.id); res.json({ ok: true, seller: { id: seller.id, displayName: seller.displayName, sellerType: seller.sellerType, paypalReady: seller.paypalReady }, listings: listSellerListings(seller.id, req.query) }); }
  catch (e) { fail(res, e, 403); }
});
router.get("/v1/sellers/:id/orders", (req, res) => {
  try { const seller = assertSellerSession(req, req.params.id); res.json({ ok: true, orders: getOrdersBySeller(seller.id) }); }
  catch (e) { fail(res, e, 403); }
});
router.put("/v1/sellers/:id/orders/:orderId/tracking", (req, res) => {
  try {
    assertSellerOwnsOrder(req, req.params.orderId, req.params.id);
    const allowed = new Set(["preparing", "shipped", "delivered"]);
    const status = allowed.has(req.body?.status) ? req.body.status : "shipped";
    const order = updateOrderStatus(req.params.orderId, status, { tracking: String(req.body?.tracking || "").slice(0, 120), labelUrl: String(req.body?.labelUrl || "").slice(0, 1000) });
    res.json({ ok: true, order });
  } catch (e) { fail(res, e); }
});

router.get("/v1/cart/:userId", (req, res) => res.json({ ok: true, cart: getCart(req.params.userId) }));
router.post("/v1/cart/add", (req, res) => { try { res.json({ ok: true, cart: addToCart(req.body?.userId, req.body?.listingId, req.body?.qty || 1) }); } catch (e) { fail(res, e); } });
router.put("/v1/cart/qty", (req, res) => { try { res.json({ ok: true, cart: updateCartQty(req.body?.userId, req.body?.listingId, req.body?.qty) }); } catch (e) { fail(res, e); } });
router.delete("/v1/cart/item", (req, res) => { try { res.json({ ok: true, cart: removeFromCart(req.body?.userId, req.body?.listingId) }); } catch (e) { fail(res, e); } });
router.delete("/v1/cart/:userId", (req, res) => res.json({ ok: true, cart: clearCart(req.params.userId) }));
router.post("/v1/cart/checkout", (req, res) => res.status(410).json({ ok: false, error: "Checkout Marketplace SumUp desactive. Utilisez PayPal Marketplace.", replacement: "/api/marketplace/v1/paypal/checkout" }));

router.get("/v1/orders", (req, res) => { try { const user = getMarketplaceUser(req); res.json({ ok: true, orders: getOrdersByBuyer(user.email, user.id) }); } catch (e) { fail(res, e); } });
router.get("/v1/orders/secure/:id", (req, res) => { try { const { order } = assertBuyerOwnsOrder(req, req.params.id); res.json({ ok: true, order }); } catch (e) { fail(res, e, 404); } });
router.get("/v1/orders/:id/invoice", (req, res) => {
  try { assertOrderParticipant(req, req.params.id); const html = getInvoiceHtmlByOrder(req.params.id); if (!html) return res.status(404).json({ ok: false, error: "Facture introuvable" }); res.type("text/html; charset=utf-8").send(html); }
  catch (e) { fail(res, e, 404); }
});
router.post("/v1/orders/:id/invoice", (req, res) => { try { assertOrderParticipant(req, req.params.id); res.json({ ok: true, invoice: createInvoiceForOrder(req.params.id, req.body?.vatRate) }); } catch (e) { fail(res, e); } });
router.post("/v1/disputes", (req, res) => {
  try { const orderId = String(req.body?.orderId || ""); const { user } = assertBuyerOwnsOrder(req, orderId); const dispute = createDispute({ ...(req.body || {}), orderId, buyerEmail: user.email }); res.status(201).json({ ok: true, dispute }); }
  catch (e) { fail(res, e); }
});

export default router;
export function marketplaceV1AdminRouter() { return Router(); }
