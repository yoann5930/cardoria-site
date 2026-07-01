/**
 * Expédition — Mondial Relay, Colissimo, Chronopost.
 * Génération d'étiquettes (API carrier ou modèle Cardoria si clés absentes).
 */
import { getOrder, updateOrderStatus } from "./orders.js";
import { logAudit } from "../audit.js";

const CARRIERS = {
  mondial_relay: { name: "Mondial Relay", baseCost: 4.95, days: "3-5 jours" },
  colissimo: { name: "Colissimo", baseCost: 6.5, days: "2-3 jours" },
  chronopost: { name: "Chronopost", baseCost: 9.9, days: "24-48h" }
};

export function getShippingOptions() {
  return Object.entries(CARRIERS).map(([id, c]) => ({
    id,
    name: c.name,
    price: c.baseCost,
    estimatedDays: c.days
  }));
}

export function calculateShipping(carrierId, weightKg = 0.05) {
  const carrier = CARRIERS[carrierId];
  if (!carrier) throw new Error("Transporteur inconnu");
  const extra = weightKg > 0.1 ? Math.ceil((weightKg - 0.1) / 0.1) * 0.5 : 0;
  return Math.round((carrier.baseCost + extra) * 100) / 100;
}

export async function generateShippingLabel(orderId, carrierId) {
  const order = getOrder(orderId);
  if (!order) throw new Error("Commande introuvable");
  const carrier = CARRIERS[carrierId || order.shippingCarrier];
  if (!carrier) throw new Error("Transporteur invalide");

  const tracking = "CRD" + Date.now().toString(36).toUpperCase();
  let labelUrl;

  if (process.env.MONDIAL_RELAY_API_KEY && carrierId === "mondial_relay") {
    labelUrl = await callCarrierApi("mondial_relay", order, tracking);
  } else if (process.env.COLISSIMO_API_KEY && carrierId === "colissimo") {
    labelUrl = await callCarrierApi("colissimo", order, tracking);
  } else if (process.env.CHRONOPOST_API_KEY && carrierId === "chronopost") {
    labelUrl = await callCarrierApi("chronopost", order, tracking);
  } else {
    labelUrl = generateMockLabel(order, carrier, tracking);
  }

  updateOrderStatus(orderId, "shipped", { tracking, labelUrl });
  logAudit({ type: "marketplace", action: "label_generated", user: "system", detail: `${orderId} — ${carrier.name}` });

  return { tracking, labelUrl, carrier: carrier.name };
}

async function callCarrierApi(carrier, order, tracking) {
  /* Brancher ici les SDK officiels Mondial Relay / Colissimo / Chronopost */
  console.log(`[Shipping] API ${carrier} — commande ${order.id}, suivi ${tracking}`);
  return generateMockLabel(order, CARRIERS[carrier], tracking);
}

function generateMockLabel(order, carrier, tracking) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Étiquette ${order.id}</title>
<style>body{font-family:Arial;padding:24px;border:2px dashed #333;max-width:400px}
.barcode{font-family:monospace;font-size:24px;letter-spacing:4px;background:#eee;padding:12px;text-align:center}
</style></head><body>
<h2>${carrier.name}</h2><p><strong>Commande :</strong> ${order.id}</p>
<p><strong>Destinataire :</strong> ${order.buyerName}<br>${order.shippingAddress}</p>
<div class="barcode">${tracking}</div>
<p style="font-size:11px">Étiquette Cardoria — configurer les clés API transporteur en production.</p>
</body></html>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

export { CARRIERS };
