/**
 * Routes PayPal Marketplace Cardoria — vendeurs particuliers/pro et checkout C2C.
 */
import { Router } from "express";
import { getSeller, getSellerByEmail, registerSeller } from "../lib/marketplace/sellers.js";
import { getCart, createOrdersFromCart, clearCart } from "../lib/marketplace/v1/cart.js";
import { updateOrderStatus } from "../lib/marketplace/orders.js";
import {
  getPayPalMarketplaceConfig,
  createSellerOnboarding,
  syncSellerPayPalStatus,
  createMarketplacePayPalOrder,
  captureMarketplacePayPalOrder
} from "../lib/marketplace/paypal.js";

const router = Router();

function assertSellerIdentity(seller, email) {
  if (!seller) throw new Error("Vendeur introuvable.");
  if (!email || seller.email.toLowerCase() !== String(email).toLowerCase()) {
    const error = new Error("Session vendeur invalide.");
    error.status = 403;
    throw error;
  }
  return seller;
}

router.get("/v1/paypal/config", (req, res) => {
  const cfg = getPayPalMarketplaceConfig();
  res.json({
    ok: true,
    provider: cfg.provider,
    environment: cfg.environment,
    configured: cfg.configured,
    commissionConfigured: cfg.commissionPercent != null,
    commissionPercent: cfg.commissionPercent,
    delayedDisbursement: cfg.delayedDisbursement
  });
});

router.post("/v1/paypal/sellers/register", (req, res) => {
  try {
    const { email, displayName, sellerType } = req.body || {};
    if (!email || !String(email).includes("@")) {
      return res.status(400).json({ ok: false, error: "Email vendeur valide requis." });
    }
    let seller = getSellerByEmail(String(email).trim().toLowerCase());
    if (!seller) {
      seller = registerSeller({
        email: String(email).trim().toLowerCase(),
        displayName: String(displayName || "").trim(),
        sellerType: sellerType === "professional" ? "professional" : "individual"
      });
    }
    res.json({ ok: true, seller });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

router.post("/v1/paypal/sellers/:id/onboard", async (req, res) => {
  try {
    const seller = assertSellerIdentity(getSeller(req.params.id), req.body?.sellerEmail);
    const base = (process.env.FRONTEND_URL || process.env.MARKETPLACE_FRONTEND_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const returnUrl = `${base}/vendre.html?paypal=return&seller=${encodeURIComponent(seller.id)}`;
    const result = await createSellerOnboarding({ sellerId: seller.id, returnUrl });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.status || 400).json({ ok: false, error: error.message });
  }
});

router.get("/v1/paypal/sellers/:id/status", async (req, res) => {
  try {
    const seller = assertSellerIdentity(getSeller(req.params.id), req.query.sellerEmail);
    const synced = await syncSellerPayPalStatus(seller.id, req.query.merchantId || "");
    res.json({ ok: true, seller: synced });
  } catch (error) {
    res.status(error.status || 400).json({ ok: false, error: error.message });
  }
});

router.post("/v1/paypal/checkout", async (req, res) => {
  let orders = [];
  try {
    const body = req.body || {};
    if (!body.userId) return res.status(400).json({ ok: false, error: "Panier client invalide." });
    if (!body.buyerEmail || !String(body.buyerEmail).includes("@")) {
      return res.status(400).json({ ok: false, error: "Email acheteur valide requis." });
    }

    const cart = getCart(body.userId);
    if (!cart.items.length) return res.status(400).json({ ok: false, error: "Panier vide." });

    const sellerIds = [...new Set(cart.items.map((item) => item.sellerId))];
    for (const sellerId of sellerIds) {
      const seller = getSeller(sellerId);
      if (!seller?.paypalReady) {
        return res.status(409).json({
          ok: false,
          error: `Le vendeur ${seller?.displayName || sellerId} n'a pas encore terminé son activation PayPal.`,
          sellerId
        });
      }
    }

    orders = createOrdersFromCart(body.userId, {
      buyerEmail: body.buyerEmail,
      buyerName: body.buyerName,
      buyerId: body.buyerId || body.userId,
      shippingCarrier: body.shippingCarrier,
      shippingCost: body.shippingCost,
      shippingAddress: body.shippingAddress,
      clearAfterCreate: false
    });

    const base = (process.env.FRONTEND_URL || process.env.MARKETPLACE_FRONTEND_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const successBase = body.successUrl || `${base}/marketplace-paiement-succes.html`;
    const cancelUrl = body.cancelUrl || `${base}/marketplace-paiement-echec.html`;
    const separator = successBase.includes("?") ? "&" : "?";
    const successUrl = `${successBase}${separator}provider=paypal`;

    const payment = await createMarketplacePayPalOrder(orders, { successUrl, cancelUrl });
    clearCart(body.userId);
    res.json({ ok: true, provider: "paypal", orders, checkout: payment });
  } catch (error) {
    for (const order of orders) {
      try { updateOrderStatus(order.id, "cancelled", { paymentStatus: "failed", paymentMethod: "paypal" }); } catch { /* ignore */ }
    }
    res.status(error.status || 400).json({ ok: false, error: error.message });
  }
});

router.post("/v1/paypal/orders/:paypalOrderId/capture", async (req, res) => {
  try {
    const result = await captureMarketplacePayPalOrder(req.params.paypalOrderId);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.status || 400).json({ ok: false, error: error.message });
  }
});

export default router;
