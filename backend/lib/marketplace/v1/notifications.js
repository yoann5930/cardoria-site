/**
 * Notifications email marketplace v1.
 */
import { sendEmail } from "../../email.js";
import { getSeller } from "../sellers.js";
import { createInvoiceForOrder } from "./invoices.js";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.MAIL_TO || "Cardoria59330@gmail.com";

function fmt(n) {
  return Number(n || 0).toFixed(2).replace(".", ",") + " €";
}

export async function notifyOrderCreated(order) {
  await sendEmail({
    to: order.buyerEmail,
    subject: `Cardoria — Commande ${order.id} enregistrée`,
    text: `Bonjour ${order.buyerName || ""},\n\nVotre commande ${order.id} est en attente de paiement.\nMontant : ${fmt(order.total)}\n\nFinalisez le paiement SumUp pour valider votre achat.\n\nCardoria Marketplace`
  });
  await notifyAdminNewOrder(order);
}

export async function notifyPaymentConfirmed(order) {
  await sendEmail({
    to: order.buyerEmail,
    subject: `Cardoria — Paiement confirmé ${order.id}`,
    text: `Paiement reçu pour la commande ${order.id}.\nMontant : ${fmt(order.total)}\nStatut : payé.\n\nMerci pour votre confiance.\nCardoria`
  });
  const seller = getSeller(order.sellerId);
  if (seller?.email) {
    await sendEmail({
      to: seller.email,
      subject: `Cardoria — Nouvelle vente ${order.id}`,
      text: `Vous avez une nouvelle commande payée : ${order.listingTitle}\nMontant : ${fmt(order.total)}\nPréparez l'expédition depuis votre espace vendeur.`
    });
  }
}

export async function notifyShipped(order) {
  await sendEmail({
    to: order.buyerEmail,
    subject: `Cardoria — Commande expédiée ${order.id}`,
    text: `Votre commande ${order.id} a été expédiée.\nTransporteur : ${order.shippingCarrier || "—"}\nSuivi : ${order.shippingTracking || "—"}\n\nCardoria Marketplace`
  });
}

export async function notifyDelivered(order) {
  await sendEmail({
    to: order.buyerEmail,
    subject: `Cardoria — Commande livrée ${order.id}`,
    text: `Votre commande ${order.id} est marquée comme livrée.\nMerci d'avoir choisi Cardoria !`
  });
}

export async function notifyCancelled(order, reason = "") {
  await sendEmail({
    to: order.buyerEmail,
    subject: `Cardoria — Commande annulée ${order.id}`,
    text: `Votre commande ${order.id} a été annulée.${reason ? "\nMotif : " + reason : ""}\n\nCardoria`
  });
}

export async function notifyAdminNewOrder(order) {
  await sendEmail({
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
