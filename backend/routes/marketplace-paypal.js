/**
 * Routes PayPal Marketplace Cardoria — authentification serveur obligatoire.
 */
import { Router } from "express";
import { getSeller, getSellerByEmail, registerSeller } from "../lib/marketplace/sellers.js";
import { getCart, createOrdersFromCart } from "../lib/marketplace/v1/cart.js";
import { updateOrderStatus } from "../lib/marketplace/orders.js";
import { getMarketplacePersistenceStatus } from "../lib/marketplace/persistence.js";
import { isMarketplaceDemoMode } from "../lib/marketplace/demo-mode.js";
import { getMarketplaceUser, assertSellerSession, assertBuyerOwnsOrder } from "../lib/marketplace/v1/security.js";
import { calculateShipping } from "../lib/marketplace/shipping.js";
import { getDb } from "../lib/engine/database.js";
import {
  getPayPalMarketplaceConfig,
  createSellerOnboarding,
  syncSellerPayPalStatus,
  createMarketplacePayPalOrder,
  captureMarketplacePayPalOrder
} from "../lib/marketplace/paypal.js";

const router = Router();

function fail(res, error, fallback = 400) {
  res.status(error?.status || error?.code || fallback).json({ ok: false, error: error?.message || "Erreur PayPal" });
}

router.get("/v1/persistence/status", (req, res) => {
  const p = getMarketplacePersistenceStatus();
  res.json({ ok: true, persistence: { configured: !!p.configured, healthy: p.ok !== false, restored: !!p.restored } });
});

// Le diagnostic de connexion detaille n'est jamais public.
router.get("/v1/persistence/probe", (req, res) => res.status(404).json({ ok: false, error: "Not found" }));

router.get("/v1/paypal/config", (req, res) => {
  const cfg = getPayPalMarketplaceConfig();
  res.json({ ok: true, provider: cfg.provider, environment: cfg.environment, configured: cfg.configured, commissionConfigured: cfg.commissionPercent != null, commissionPercent: cfg.commissionPercent, delayedDisbursement: cfg.delayedDisbursement, demoMode: isMarketplaceDemoMode() });
});

router.post("/v1/paypal/sellers/register", (req, res) => {
  try {
    const user = getMarketplaceUser(req);
    let seller = getSellerByEmail(user.email);
    if (!seller) {
      seller = registerSeller({
        email: user.email,
        displayName: String(req.body?.displayName || user.name || user.email.split("@")[0]).trim().slice(0, 120),
        sellerType: req.body?.sellerType === "professional" ? "professional" : "individual"
      });
    }
    res.json({ ok: true, seller });
  } catch (error) { fail(res, error); }
});

router.post("/v1/paypal/sellers/:id/onboard", async (req, res) => {
  try {
    const seller = assertSellerSession(req, req.params.id);
    const base = (process.env.FRONTEND_URL || process.env.MARKETPLACE_FRONTEND_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const returnUrl = `${base}/vendre.html?paypal=return&seller=${encodeURIComponent(seller.id)}`;
    const result = await createSellerOnboarding({ sellerId: seller.id, returnUrl });
    res.json({ ok: true, ...result });
  } catch (error) { fail(res, error); }
});

router.get("/v1/paypal/sellers/:id/status", async (req, res) => {
  try {
    const seller = assertSellerSession(req, req.params.id);
    const synced = await syncSellerPayPalStatus(seller.id, req.query.merchantId || "");
    res.json({ ok: true, seller: synced });
  } catch (error) { fail(res, error); }
});

router.post("/v1/paypal/checkout", async (req, res) => {
  let orders = [];
  try {
    const user = getMarketplaceUser(req);
    const body = req.body || {};
    const cartUserId = String(body.userId || "").trim();
    if (!cartUserId) return res.status(400).json({ ok: false, error: "Panier client invalide." });
    const cart = getCart(cartUserId);
    if (!cart.items.length) return res.status(400).json({ ok: false, error: "Panier vide." });

    for (const sellerId of [...new Set(cart.items.map((item) => item.sellerId))]) {
      const seller = getSeller(sellerId);
      if (!seller?.paypalReady) return res.status(409).json({ ok: false, error: `Le vendeur ${seller?.displayName || sellerId} n'a pas termine son activation PayPal.`, sellerId });
    }

    const carrier = String(body.shippingCarrier || "mondial_relay");
    const serverShippingCost = calculateShipping(carrier, Math.max(0.05, cart.items.reduce((sum, item) => sum + Number(item.qty || 1) * 0.05, 0)));
    orders = createOrdersFromCart(cartUserId, {
      buyerEmail: user.email,
      buyerName: user.name || String(body.buyerName || "").slice(0, 120),
      buyerId: user.id,
      shippingCarrier: carrier,
      shippingCost: serverShippingCost,
      shippingAddress: String(body.shippingAddress || "").trim().slice(0, 500),
      clearAfterCreate: false
    });

    const base = (process.env.FRONTEND_URL || process.env.MARKETPLACE_FRONTEND_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const successBase = String(body.successUrl || `${base}/marketplace-paiement-succes.html`);
    const cancelUrl = String(body.cancelUrl || `${base}/marketplace-paiement-echec.html`);
    const successUrl = `${successBase}${successBase.includes("?") ? "&" : "?"}provider=paypal`;
    const payment = await createMarketplacePayPalOrder(orders, { successUrl, cancelUrl });
    res.json({ ok: true, provider: "paypal", orders, shippingCost: serverShippingCost, checkout: payment });
  } catch (error) {
    for (const order of orders) {
      try { updateOrderStatus(order.id, "cancelled", { paymentStatus: "failed", paymentMethod: "paypal" }); } catch { /* ignore */ }
    }
    fail(res, error);
  }
});

router.post("/v1/paypal/orders/:paypalOrderId/capture", async (req, res) => {
  try {
    getMarketplaceUser(req);
    const rows = getDb().prepare("SELECT id FROM mk_orders WHERE paypal_order_id = ?").all(req.params.paypalOrderId);
    if (!rows.length) return res.status(404).json({ ok: false, error: "Commande PayPal introuvable." });
    rows.forEach((row) => assertBuyerOwnsOrder(req, row.id));
    const result = await captureMarketplacePayPalOrder(req.params.paypalOrderId);
    res.json({ ok: true, ...result });
  } catch (error) { fail(res, error); }
});

export default router;
