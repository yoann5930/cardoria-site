/**
 * PayPal Marketplace Cardoria — onboarding vendeurs, commissions et checkout multi-vendeurs.
 * Les secrets PayPal restent exclusivement côté serveur via variables d'environnement.
 */
import { getDb } from "../engine/database.js";
import { getSeller, updateSellerPayPal } from "./sellers.js";
import { getOrder, updateOrderStatus } from "./orders.js";

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

function environment() {
  return String(process.env.PAYPAL_ENV || "sandbox").toLowerCase() === "live" ? "live" : "sandbox";
}

function apiBase() {
  return environment() === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

function commissionPercent() {
  if (process.env.MARKETPLACE_COMMISSION_PERCENT == null || process.env.MARKETPLACE_COMMISSION_PERCENT === "") return null;
  const value = Number(process.env.MARKETPLACE_COMMISSION_PERCENT);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function delayedDisbursementEnabled() {
  return String(process.env.PAYPAL_DISBURSEMENT_MODE || "INSTANT").toUpperCase() === "DELAYED";
}

export function getPayPalMarketplaceConfig() {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || "").trim();
  const secret = String(process.env.PAYPAL_CLIENT_SECRET || "").trim();
  const partnerMerchantId = String(process.env.PAYPAL_PARTNER_MERCHANT_ID || "").trim();
  const attributionId = String(process.env.PAYPAL_PARTNER_ATTRIBUTION_ID || "").trim();
  return {
    provider: "paypal",
    environment: environment(),
    configured: !!(clientId && secret && partnerMerchantId && attributionId),
    commissionPercent: commissionPercent(),
    delayedDisbursement: delayedDisbursementEnabled()
  };
}

function assertConfigured() {
  const cfg = getPayPalMarketplaceConfig();
  if (!cfg.configured) {
    throw new Error("PayPal Marketplace non configuré côté serveur.");
  }
  return cfg;
}

function base64Url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value))
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function authAssertion(merchantId) {
  const payerId = String(merchantId || "").trim();
  if (!payerId) return "";
  const header = base64Url({ alg: "none" });
  const payload = base64Url({ iss: String(process.env.PAYPAL_CLIENT_ID || "").trim(), payer_id: payerId });
  return `${header}.${payload}.`;
}

async function getAccessToken() {
  assertConfigured();
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Authentification PayPal impossible.");
  }
  return data.access_token;
}

async function paypalRequest(path, { method = "GET", body, requestId, authMerchantId = "" } = {}) {
  const token = await getAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "PayPal-Partner-Attribution-Id": String(process.env.PAYPAL_PARTNER_ATTRIBUTION_ID || "").trim()
  };
  if (authMerchantId) headers["PayPal-Auth-Assertion"] = authAssertion(authMerchantId);
  if (requestId) headers["PayPal-Request-Id"] = requestId;

  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.details?.[0]?.description || data?.message || data?.error_description || data?.error;
    const error = new Error(detail || `Erreur PayPal (${response.status}).`);
    error.status = response.status;
    error.paypal = data;
    throw error;
  }
  return data;
}

function getActionUrl(response) {
  return response?.links?.find((link) => link.rel === "action_url")?.href ||
    response?.links?.find((link) => link.rel === "approve")?.href ||
    response?.links?.find((link) => link.rel === "payer-action")?.href || "";
}

export async function createSellerOnboarding({ sellerId, returnUrl }) {
  const cfg = assertConfigured();
  const seller = getSeller(sellerId);
  if (!seller) throw new Error("Vendeur introuvable.");
  if (!returnUrl) throw new Error("URL de retour vendeur requise.");

  const features = ["PAYMENT", "REFUND", "PARTNER_FEE"];
  if (cfg.delayedDisbursement) features.push("DELAY_FUNDS_DISBURSEMENT");

  const payload = {
    tracking_id: seller.id,
    operations: [{
      operation: "API_INTEGRATION",
      api_integration_preference: {
        rest_api_integration: {
          integration_method: "PAYPAL",
          integration_type: "THIRD_PARTY",
          third_party_details: { features }
        }
      }
    }],
    products: ["EXPRESS_CHECKOUT"],
    partner_config_override: {
      return_url: returnUrl,
      return_url_description: "Retour vers Cardoria Marketplace"
    },
    legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }]
  };

  const result = await paypalRequest("/v2/customer/partner-referrals", {
    method: "POST",
    body: payload,
    requestId: `onboard-${seller.id}-${Date.now()}`,
    authMerchantId: process.env.PAYPAL_PARTNER_MERCHANT_ID
  });
  const url = getActionUrl(result);
  if (!url) throw new Error("Lien d'activation vendeur PayPal introuvable.");

  updateSellerPayPal(seller.id, {
    onboardingStatus: "pending",
    trackingId: seller.id
  });

  return { url, seller: getSeller(seller.id) };
}

function normalizeMerchantIntegration(payload) {
  if (!payload) return null;
  if (payload.merchant_id) return payload;
  const integrations = payload.merchant_integrations || payload.merchantIntegrations || [];
  return integrations[0] || null;
}

export async function syncSellerPayPalStatus(sellerId, paypalMerchantId = "") {
  assertConfigured();
  const seller = getSeller(sellerId);
  if (!seller) throw new Error("Vendeur introuvable.");

  const partnerMerchantIdRaw = String(process.env.PAYPAL_PARTNER_MERCHANT_ID || "").trim();
  const partnerMerchantId = encodeURIComponent(partnerMerchantIdRaw);
  const knownMerchantId = String(paypalMerchantId || seller.paypalMerchantId || "").trim();
  let payload;

  if (knownMerchantId) {
    payload = await paypalRequest(`/v1/customer/partners/${partnerMerchantId}/merchant-integrations/${encodeURIComponent(knownMerchantId)}`, {
      authMerchantId: partnerMerchantIdRaw
    });
  } else {
    payload = await paypalRequest(`/v1/customer/partners/${partnerMerchantId}/merchant-integrations?tracking_id=${encodeURIComponent(seller.id)}`, {
      authMerchantId: partnerMerchantIdRaw
    });
  }

  const integration = normalizeMerchantIntegration(payload);
  if (!integration) {
    updateSellerPayPal(seller.id, { onboardingStatus: "pending" });
    return getSeller(seller.id);
  }

  const oauthThirdParty = integration.oauth_third_party || integration.oauthThirdParty || integration.oauth_integrations || [];
  const permissionsGranted = Boolean(
    integration.permissions_granted ||
    (Array.isArray(oauthThirdParty) && oauthThirdParty.length) ||
    integration.products?.some?.((product) => product.vetting_status === "SUBSCRIBED")
  );
  const emailConfirmed = Boolean(integration.primary_email_confirmed);
  const paymentsReceivable = Boolean(integration.payments_receivable);
  const ready = permissionsGranted && emailConfirmed && paymentsReceivable;

  return updateSellerPayPal(seller.id, {
    merchantId: integration.merchant_id || knownMerchantId,
    onboardingStatus: ready ? "ready" : "pending",
    paymentsReceivable,
    emailConfirmed,
    permissionsGranted,
    connectedAt: ready ? new Date().toISOString() : seller.paypalConnectedAt
  });
}

function platformFeeFor(order) {
  const pct = commissionPercent();
  if (pct == null) {
    throw new Error("Commission Marketplace non configurée. Définir MARKETPLACE_COMMISSION_PERCENT.");
  }
  const includeShipping = String(process.env.MARKETPLACE_COMMISSION_INCLUDE_SHIPPING || "false").toLowerCase() === "true";
  const base = includeShipping ? Number(order.total) : Math.max(0, Number(order.total) - Number(order.shippingCost || 0));
  return round2(base * pct / 100);
}

function ensureSellerCanReceive(order) {
  const seller = getSeller(order.sellerId);
  if (!seller) throw new Error(`Vendeur ${order.sellerId} introuvable.`);
  if (!seller.paypalMerchantId || !seller.paypalPaymentsReceivable || seller.paypalOnboardingStatus !== "ready") {
    throw new Error(`Le vendeur ${seller.displayName || seller.id} doit terminer l'activation PayPal avant la vente.`);
  }
  return seller;
}

export async function createMarketplacePayPalOrder(orders, { successUrl, cancelUrl } = {}) {
  const cfg = assertConfigured();
  if (!Array.isArray(orders) || !orders.length) throw new Error("Aucune commande Marketplace à payer.");
  if (orders.length > 10) throw new Error("Le panier contient trop de vendeurs pour un paiement PayPal unique.");

  const fees = [];
  const purchaseUnits = orders.map((order) => {
    const seller = ensureSellerCanReceive(order);
    const fee = platformFeeFor(order);
    fees.push({ orderId: order.id, platformFee: fee, sellerNet: round2(Number(order.total) - fee) });
    return {
      reference_id: order.id,
      custom_id: order.id,
      description: `Cardoria Marketplace - ${String(order.listingTitle || "Achat de carte").slice(0, 110)}`,
      payee: { merchant_id: seller.paypalMerchantId },
      amount: {
        currency_code: "EUR",
        value: Number(order.total).toFixed(2)
      },
      payment_instruction: {
        disbursement_mode: cfg.delayedDisbursement ? "DELAYED" : "INSTANT",
        platform_fees: [{
          amount: { currency_code: "EUR", value: fee.toFixed(2) }
        }]
      }
    };
  });

  const payload = {
    intent: "CAPTURE",
    purchase_units: purchaseUnits,
    payment_source: {
      paypal: {
        experience_context: {
          return_url: successUrl,
          cancel_url: cancelUrl,
          user_action: "PAY_NOW"
        }
      }
    }
  };

  const result = await paypalRequest("/v2/checkout/orders", {
    method: "POST",
    body: payload,
    requestId: `cardoria-${orders.map((o) => o.id).join("-")}`.slice(0, 100)
  });
  const url = getActionUrl(result);
  if (!url) throw new Error("Lien de paiement PayPal introuvable.");

  const db = getDb();
  fees.forEach((fee) => {
    db.prepare(`
      UPDATE mk_orders SET
        payment_provider = 'paypal', paypal_order_id = ?, platform_fee = ?,
        seller_amount_after_platform_fee = ?, payment_status = 'pending', updated_at = ?
      WHERE id = ?
    `).run(result.id, fee.platformFee, fee.sellerNet, new Date().toISOString(), fee.orderId);
  });

  return {
    provider: "paypal",
    id: result.id,
    status: result.status,
    url,
    commissionPercent: cfg.commissionPercent,
    fees
  };
}

export async function captureMarketplacePayPalOrder(paypalOrderId) {
  if (!paypalOrderId) throw new Error("Identifiant de paiement PayPal requis.");
  const result = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: "POST",
    body: {},
    requestId: `capture-${paypalOrderId}`
  });

  const db = getDb();
  const captures = [];

  for (const unit of result.purchase_units || []) {
    const internalOrderId = unit.reference_id || unit.custom_id;
    if (!internalOrderId) continue;
    const order = getOrder(internalOrderId);
    if (!order || order.paypalOrderId !== paypalOrderId) continue;

    const capture = unit.payments?.captures?.[0];
    const captureStatus = capture?.status || "";
    const captureId = capture?.id || "";

    db.prepare(`
      UPDATE mk_orders SET paypal_capture_id = ?, payment_provider = 'paypal', updated_at = ? WHERE id = ?
    `).run(captureId, new Date().toISOString(), internalOrderId);

    if (captureStatus === "COMPLETED") {
      updateOrderStatus(internalOrderId, "paid", {
        paymentStatus: "paid",
        paymentMethod: "paypal"
      });
    }

    captures.push({ orderId: internalOrderId, captureId, status: captureStatus });
  }

  const completed = captures.filter((item) => item.status === "COMPLETED").length;
  return {
    provider: "paypal",
    id: result.id,
    status: result.status,
    captures,
    completed,
    total: captures.length,
    paid: captures.length > 0 && completed === captures.length
  };
}
