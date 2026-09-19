/** Apply only after PayPal authenticated API response or verified webhook signature. */
import { applyLivePaymentStatus, getLiveCheckout, listLiveCheckouts, saveLiveCheckout } from "./sessions.js";
import { getSeller } from "../marketplace/sellers.js";
const invalid = message => Object.assign(new Error(message), { status: 409, code: "LIVE_PAYPAL_CAPTURE_MISMATCH" });
function amountCents(amount) {
  if (!amount || amount.currency_code !== "EUR" || !/^\d+\.\d{2}$/.test(String(amount.value))) throw invalid("Montant ou devise PayPal non conforme.");
  const cents = Math.round(Number(amount.value) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) throw invalid("Montant PayPal invalide.");
  return cents;
}
export function validateCompletedLiveCapture(checkout, capture, { paypalOrderId = "", merchantId = "" } = {}) {
  if (!checkout || (checkout.provider && checkout.provider !== "paypal") || checkout.ownerRole !== "seller") throw invalid("Paiement Live PayPal attendu.");
  if (!capture?.id || capture.status !== "COMPLETED" || capture.final_capture === false) throw invalid("Capture PayPal complète requise.");
  const orderId = paypalOrderId || capture.supplementary_data?.related_ids?.order_id;
  if (!orderId || String(orderId) !== String(checkout.paymentProviderOrderId)) throw invalid("Commande PayPal incohérente.");
  if (capture.custom_id && capture.custom_id !== checkout.id) throw invalid("Référence de commande PayPal incohérente.");
  if (checkout.paymentProviderTransactionId && checkout.paymentProviderTransactionId !== capture.id) throw invalid("Une autre capture existe pour ce paiement.");
  if (amountCents(capture.amount) !== Math.round(Number(checkout.amount) * 100)) throw invalid("Montant encaissé différent du montant dû.");
  if (capture.payee?.merchant_id && merchantId && capture.payee.merchant_id !== merchantId) throw invalid("Destinataire PayPal incorrect.");
  return { paymentProviderOrderId: String(orderId), paymentProviderTransactionId: String(capture.id) };
}
export function applyVerifiedLiveCapture(checkout, capture, context = {}) {
  const current = getLiveCheckout(checkout.id) || checkout;
  if (["refunded", "refund_reconciliation_required"].includes(current.status)) return { protected: true, checkoutId: current.id, status: current.status };
  const providerIds = validateCompletedLiveCapture(current, capture, context);
  const result = applyLivePaymentStatus(current.id, "paid", providerIds);
  return { checkoutId: current.id, status: result?.status, duplicate: Boolean(result?.duplicate || result?.alreadyPaid) };
}
function refundCaptureId(resource, reversed) {
  if (reversed) return String(resource.id || "");
  const related = resource.supplementary_data?.related_ids?.capture_id;
  if (related) return String(related);
  for (const link of resource.links || []) {
    try {
      const url = new URL(link.href);
      if (url.protocol !== "https:" || !["api.paypal.com", "api-m.paypal.com", "api.sandbox.paypal.com", "api-m.sandbox.paypal.com"].includes(url.hostname)) continue;
      const match = url.pathname.match(/^\/v2\/payments\/captures\/([A-Za-z0-9_-]+)$/);
      if (match) return match[1];
    } catch {}
  }
  return "";
}
export function handleVerifiedLiveFinancialEvent(type, resource = {}) {
  if (type === "PAYMENT.CAPTURE.COMPLETED") {
    const orderId = String(resource.supplementary_data?.related_ids?.order_id || "");
    const checkout = listLiveCheckouts().find(c => c.paymentProviderOrderId === orderId && orderId && (!c.provider || c.provider === "paypal"));
    if (!checkout) return null;
    const seller = getSeller(checkout.ownerId);
    return applyVerifiedLiveCapture(checkout, resource, { paypalOrderId: orderId, merchantId: seller?.paypalMerchantId || "" });
  }
  if (!["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"].includes(type)) return null;
  const reversed = type.endsWith("REVERSED"), captureId = refundCaptureId(resource, reversed);
  const checkout = listLiveCheckouts().find(c => captureId && c.paymentProviderTransactionId === captureId && (!c.provider || c.provider === "paypal"));
  if (!checkout) return null;
  if (!resource.id || (!reversed && resource.status !== "COMPLETED")) throw invalid("Remboursement PayPal non confirmé.");
  const existing = checkout.paypalRefundEvents || [];
  if (existing.some(e => e.id === resource.id && e.type === type)) return { checkoutId: checkout.id, duplicate: true, status: checkout.status };
  const cents = amountCents(resource.amount), total = Math.round(Number(checkout.amount) * 100);
  const already = existing.filter(e => e.type === "PAYMENT.CAPTURE.REFUNDED").reduce((n, e) => n + e.amountCents, 0);
  if (cents > total || (!reversed && cents + already > total)) throw invalid("Remboursement PayPal supérieur au paiement.");
  const complete = reversed ? cents === total : cents + already === total;
  // Partial refunds require explicit item/postage allocation. Never invent a split,
  // resell stock automatically, or leave an adjusted payment eligible for shipping.
  const status = complete ? "refunded" : "refund_reconciliation_required";
  saveLiveCheckout({ ...checkout, status, paypalRefundEvents: [...existing, { id: resource.id, type, amountCents: cents }], paymentRefundedAmount: (reversed ? cents : already + cents) / 100, updatedAt: new Date().toISOString() });
  return { checkoutId: checkout.id, status, updated: true, reconciliationRequired: !complete };
}
