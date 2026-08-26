/** Expedition Marketplace Cardoria. */
import { getOrder, updateOrderStatus } from "./orders.js";
import { logAudit } from "../audit.js";

const CARRIERS = {
  mondial_relay: { name: "Mondial Relay", baseCost: 4.95, days: "3-5 jours" },
  colissimo: { name: "Colissimo", baseCost: 6.5, days: "2-3 jours" },
  chronopost: { name: "Chronopost", baseCost: 9.9, days: "24-48h" }
};

export function getShippingOptions() {
  return Object.entries(CARRIERS).map(([id, c]) => ({ id, name: c.name, price: c.baseCost, estimatedDays: c.days }));
}

export function calculateShipping(carrierId, weightKg = 0.05) {
  const carrier = CARRIERS[carrierId];
  if (!carrier) throw Object.assign(new Error("Transporteur inconnu"), { status: 400 });
  const safeWeight = Math.max(0.01, Math.min(5, Number(weightKg) || 0.05));
  const extra = safeWeight > 0.1 ? Math.ceil((safeWeight - 0.1) / 0.1) * 0.5 : 0;
  return Math.round((carrier.baseCost + extra) * 100) / 100;
}

export async function generateShippingLabel(orderId, carrierId) {
  const order = getOrder(orderId);
  if (!order) throw Object.assign(new Error("Commande introuvable"), { status: 404 });
  const id = carrierId || order.shippingCarrier;
  const carrier = CARRIERS[id];
  if (!carrier) throw Object.assign(new Error("Transporteur invalide"), { status: 400 });

  // Aucun faux bordereau n'est autorise en production. Tant que les SDK officiels
  // ne sont pas branches, le vendeur saisit le suivi reel dans son espace vendeur.
  if (process.env.NODE_ENV === "production") {
    throw Object.assign(new Error(`Etiquette ${carrier.name} indisponible: integration transporteur officielle requise.`), { status: 501 });
  }

  const tracking = "DEMO-" + Date.now().toString(36).toUpperCase();
  const labelUrl = generateDemoLabel(order, carrier, tracking);
  updateOrderStatus(orderId, "preparing", { tracking: "", labelUrl: "" });
  logAudit({ type: "marketplace", action: "demo_label_generated", user: "system", detail: `${orderId} — ${carrier.name}` });
  return { tracking, labelUrl, carrier: carrier.name, demo: true };
}

function generateDemoLabel(order, carrier, tracking) {
  const safe = (v) => String(v || "").replace(/[&<>"']/g, "");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DEMO ${safe(order.id)}</title></head><body><h2>DEMO — ${safe(carrier.name)}</h2><p>Commande ${safe(order.id)}</p><p>${safe(order.buyerName)}</p><p>${safe(order.shippingAddress)}</p><strong>${safe(tracking)}</strong><p>Document de demonstration — non valable pour expedition.</p></body></html>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

export { CARRIERS };
