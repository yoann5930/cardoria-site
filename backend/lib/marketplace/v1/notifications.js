/**
 * Notifications email marketplace v1.
 */
import { publicSiteOrigin, sendEmail } from "../../email.js";
import { getSeller } from "../sellers.js";
import { createInvoiceForOrder } from "./invoices.js";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.MAIL_TO || "Cardoria59330@gmail.com";

function fmt(n) {
  return Number(n || 0).toFixed(2).replace(".", ",") + " €";
}

function ordersUrl() {
  return `${publicSiteOrigin()}/client-orders.html`;
}

export async function notifyOrderCreated(order) {
  await sendEmail({
    kind: "marketplace_order_created",
    to: order.buyerEmail,
    subject: `Cardoria — Commande ${order.id} enregistrée`,
    text: `Bonjour ${order.buyerName || ""},\n\nVotre commande ${order.id} est en attente de paiement.\nMontant : ${fmt(order.total)}\n\nFinalisez le paiement pour valider votre achat.`,
    actionUrl: ordersUrl(),
    actionLabel: "Voir ma commande",
    details: [
      { label: "Commande", value: order.id },
      { label: "Montant", value: fmt(order.total) }
    ]
  });
  await notifyAdminNewOrder(order);
}

export async function notifyPaymentConfirmed(order) {
  await sendEmail({
    kind: "marketplace_payment_confirmed",
    to: order.buyerEmail,
    subject: `Cardoria — Paiement confirmé ${order.id}`,
    text: `Paiement reçu pour la commande ${order.id}.\nMontant : ${fmt(order.total)}\nStatut : payé.\n\nMerci pour votre confiance.`,
    actionUrl: ordersUrl(),
    actionLabel: "Suivre ma commande",
    details: [
      { label: "Commande", value: order.id },
      { label: "Montant", value: fmt(order.total) }
    ]
  });
  const seller = getSeller(order.sellerId);
  if (seller?.email) {
    await sendEmail({
      kind: "marketplace_seller_sale",
      to: seller.email,
      subject: `Cardoria — Nouvelle vente ${order.id}`,
      text: `Vous avez une nouvelle commande payée : ${order.listingTitle}\nMontant : ${fmt(order.total)}\nPréparez l'expédition depuis votre espace vendeur.`,
      actionUrl: `${publicSiteOrigin()}/marketplace.html`,
      actionLabel: "Ouvrir la marketplace",
      details: [
        { label: "Commande", value: order.id },
        { label: "Montant", value: fmt(order.total) }
      ]
    });
  }
}

export async function notifyShipped(order) {
  const tracking = order.shippingTracking || "—";
  await sendEmail({
    kind: "marketplace_shipped",
    to: order.buyerEmail,
    subject: `Cardoria — Commande expédiée ${order.id}`,
    text: `Votre commande ${order.id} a été expédiée.\nTransporteur : ${order.shippingCarrier || "—"}\nSuivi : ${tracking}`,
    actionUrl: ordersUrl(),
    actionLabel: "Voir le suivi",
    details: [
      { label: "Commande", value: order.id },
      { label: "Transporteur", value: order.shippingCarrier || "—" },
      { label: "Numéro de suivi", value: tracking }
    ]
  });
}

export async function notifyDelivered(order) {
  await sendEmail({
    kind: "marketplace_delivered",
    to: order.buyerEmail,
    subject: `Cardoria — Commande livrée ${order.id}`,
    text: `Votre commande ${order.id} est marquée comme livrée.\nMerci d'avoir choisi Cardoria !`,
    actionUrl: ordersUrl(),
    actionLabel: "Voir mes commandes",
    details: [{ label: "Commande", value: order.id }]
  });
}

export async function notifyCancelled(order, reason = "") {
  await sendEmail({
    kind: reason ? "marketplace_refunded" : "marketplace_cancelled",
    to: order.buyerEmail,
    subject: `Cardoria — Commande ${reason ? "remboursée" : "annulée"} ${order.id}`,
    text: `Votre commande ${order.id} a été ${reason ? "remboursée" : "annulée"}.${reason ? "\nMotif : " + reason : ""}`,
    actionUrl: ordersUrl(),
    actionLabel: "Voir mes commandes",
    details: [
      { label: "Commande", value: order.id },
      ...(reason ? [{ label: "Motif", value: reason }] : [])
    ]
  });
}

export async function notifyAdminNewOrder(order) {
  await sendEmail({
    kind: "marketplace_admin_order",
    to: ADMIN_EMAIL,
    subject: `[Admin] Nouvelle commande marketplace ${order.id}`,
    text: `Commande : ${order.id}\nClient : ${order.buyerEmail}\nTotal : ${fmt(order.total)}\nStatut : ${order.status}`
  });
}

export async function onOrderStatusChange(order, newStatus, prevStatus) {
  if (!order) return;
  try {
    if (newStatus === "paid" && prevStatus !== "paid") {
      createInvoiceForOrder(order.id);
      await notifyPaymentConfirmed(order);
      return;
    }
    if (newStatus === "pending" && prevStatus == null) await notifyOrderCreated(order);
    if (newStatus === "shipped" && prevStatus !== "shipped") await notifyShipped(order);
    if (newStatus === "delivered" && prevStatus !== "delivered") await notifyDelivered(order);
    if (newStatus === "cancelled" && prevStatus !== "cancelled") await notifyCancelled(order);
    if (newStatus === "refunded" && prevStatus !== "refunded") await notifyCancelled(order, "Remboursement effectué");
  } catch (e) {
    console.warn("[Marketplace] notification:", e.message);
  }
}
