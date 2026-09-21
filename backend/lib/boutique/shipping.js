/**
 * Expédition Boutique Cardoria — transporteurs, Point Relais, poids, suivi.
 * Ne crée jamais d'étiquette payante. Colissimo reste gated ailleurs.
 */
const clean = (value, max = 240) => String(value == null ? "" : value).trim().slice(0, max);

export const BOUTIQUE_STATUSES = ["À préparer", "En préparation", "Prête à expédier", "Expédiée", "Livrée", "Annulée"];
export const BOUTIQUE_CARRIERS = ["Colissimo (La Poste)", "La Poste", "Mondial Relay", "Relais Colis"];
export const LABEL_PENDING_MS = 2 * 60 * 1000;

export const SHIPPING_METHODS = {
  colissimo_home: {
    code: "colissimo_home",
    carrier: "Colissimo (La Poste)",
    method: "Domicile",
    shipping: "Colissimo domicile"
  },
  mondial_relay: {
    code: "mondial_relay",
    carrier: "Mondial Relay",
    method: "Point Relais",
    shipping: "Mondial Relay Point Relais"
  }
};

export function firstNameFromClient(client) {
  const full = clean(client, 120);
  return full.split(/\s+/).filter(Boolean)[0] || "client";
}

export function parseWeightGrams(value) {
  if (value == null || value === "") return null;
  const grams = Math.trunc(Number(value));
  if (!Number.isFinite(grams) || grams < 1 || grams > 30000) return null;
  return grams;
}

export function normalizePickupPoint(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = clean(raw.id || raw.carrierServicePointId, 20);
  const name = clean(raw.name, 160);
  const address = clean(raw.address || [raw.street, raw.houseNumber].filter(Boolean).join(" "), 200);
  const postalCode = clean(raw.postalCode, 12);
  const city = clean(raw.city, 80);
  if (!id || !name || !address || !postalCode || !city) return null;
  return {
    id,
    name,
    address,
    postalCode,
    city,
    countryCode: (clean(raw.countryCode || raw.country || "FR", 2).toUpperCase() || "FR"),
    carrierCode: "mondial_relay",
    carrierServicePointId: clean(raw.carrierServicePointId || id, 20)
  };
}

export function boutiqueTrackingUrl(carrier, tracking) {
  const number = clean(tracking, 180);
  if (!number) return "";
  const c = clean(carrier, 120).toLowerCase();
  if (c.includes("autre")) return "";
  const q = encodeURIComponent(number);
  if (c.includes("mondial")) return "https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=" + q;
  if (c.includes("relais colis")) return "https://www.relaiscolis.com/suivi-de-colis/?search=" + q;
  if (c.includes("chronopost")) return "https://www.chronopost.fr/fr/suivi-colis?listeNumerosLT=" + q;
  if (c.includes("colissimo") || c.includes("la poste") || c === "poste") {
    return "https://www.laposte.fr/outils/suivre-vos-envois?code=" + q;
  }
  if (c.includes("colis privé") || c.includes("colis prive")) return "https://www.colisprive.fr/moncolis/pages/detailColis.aspx?numColis=" + q;
  if (c === "dpd" || c.startsWith("dpd ")) return "https://trace.dpd.fr/fr/trace/" + q;
  if (c === "gls" || c.startsWith("gls ")) return "https://gls-group.com/FR/fr/suivi-colis/?match=" + q;
  if (c === "ups" || c.startsWith("ups ")) return "https://www.ups.com/track?loc=fr_FR&tracknum=" + q;
  if (c.includes("dhl")) return "https://www.dhl.com/fr-fr/home/tracking.html?tracking-id=" + q;
  if (c.includes("fedex") || c === "tnt" || c.startsWith("tnt ")) return "https://www.fedex.com/fedextrack/?trknbr=" + q;
  return "";
}

export function isMondialRelayOrder(order) {
  const method = clean(order?.shippingMethod || order?.shipping, 80).toLowerCase();
  const carrier = clean(order?.carrier, 80).toLowerCase();
  if (method.includes("mondial") || method === "mondial_relay") return true;
  if (carrier.includes("mondial")) return true;
  return Boolean(normalizePickupPoint(order?.pickupPoint));
}

export function resolveBoutiqueShippingSelection({ shippingMethod, carrier, shipping, pickupPoint } = {}) {
  const method = clean(shippingMethod || shipping, 80).toLowerCase().replace(/\s+/g, "_");
  const wantsRelay = method === "mondial_relay" || method.includes("mondial") || clean(carrier, 80).toLowerCase().includes("mondial");
  if (wantsRelay) {
    const pickup = normalizePickupPoint(pickupPoint);
    if (!pickup) {
      throw Object.assign(new Error("Point Relais Mondial Relay obligatoire (identifiant, nom, adresse, code postal, ville)."), {
        status: 400,
        code: "MONDIAL_RELAY_PICKUP_REQUIRED"
      });
    }
    return { ...SHIPPING_METHODS.mondial_relay, pickupPoint: pickup };
  }
  if (!method || method === "standard" || method.includes("colissimo") || method.includes("la_poste") || method.includes("domicile")) {
    return { ...SHIPPING_METHODS.colissimo_home, pickupPoint: null };
  }
  const named = clean(carrier, 120);
  return {
    code: "other",
    carrier: named || "La Poste",
    method: clean(shipping, 120) || "Livraison",
    shipping: clean(shipping, 120) || "Livraison",
    pickupPoint: normalizePickupPoint(pickupPoint)
  };
}

export function resolveBoutiqueOrderWeight(order, overrideGrams) {
  const override = parseWeightGrams(overrideGrams);
  if (override) return { grams: override, source: "admin", known: true, missing: [] };
  const stored = parseWeightGrams(order?.shippingWeightGrams);
  if (stored) return { grams: stored, source: order?.weightSource || "stored", known: true, missing: [] };
  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) return { grams: null, source: "unknown", known: false, missing: ["commande"] };
  let sum = 0;
  const missing = [];
  for (const item of items) {
    const unit = parseWeightGrams(item?.shippingWeightGrams);
    if (!unit) missing.push(clean(item?.name || item?.ref || "article", 80));
    else sum += unit * Math.max(1, Math.trunc(Number(item.qty) || 1));
  }
  if (missing.length) return { grams: null, source: "unknown", known: false, missing };
  return { grams: sum, source: "catalog", known: true, missing: [] };
}

export function colissimoAdminMessage(status = {}) {
  if (!status.configured) return "Clé API Colissimo non configurée";
  if (!status.senderConfigured) return "Adresse expéditeur Colissimo à renseigner";
  if (!status.labelPurchasesEnabled) return "Configuration Colissimo en attente";
  return "";
}

export function colissimoLabelBlock(order, now = Date.now()) {
  if (!order) return { code: "ORDER_NOT_FOUND", status: 404, error: "Commande Boutique introuvable." };
  if (order.paymentStatus !== "paid") {
    return { code: "PAYMENT_NOT_PAID", status: 409, error: "Le paiement SumUp doit être confirmé avant de créer une étiquette Colissimo." };
  }
  if (order.status === "Annulée") {
    return { code: "ORDER_CANCELLED", status: 409, error: "Une commande annulée ne peut pas être expédiée." };
  }
  if (isMondialRelayOrder(order)) {
    return { code: "COLISSIMO_WRONG_CARRIER", status: 409, error: "Cette commande Mondial Relay ne peut pas recevoir d’étiquette Colissimo." };
  }
  if (clean(order.colissimoParcelNumber, 40)) {
    return { code: "COLISSIMO_LABEL_ALREADY_CREATED", status: 409, error: "Une étiquette Colissimo existe déjà pour cette commande.", parcelNumber: order.colissimoParcelNumber };
  }
  const attempt = order.colissimoLabelAttempt || {};
  if (attempt.status === "reconciliation_required") {
    return { code: "COLISSIMO_RECONCILIATION_REQUIRED", status: 409, error: "Une tentative Colissimo doit être rapprochée dans la Cbox avant tout nouvel essai." };
  }
  if (attempt.status === "creation_pending") {
    const age = now - Date.parse(attempt.requestedAt || 0);
    if (Number.isFinite(age) && age >= 0 && age < LABEL_PENDING_MS) {
      return { code: "COLISSIMO_LABEL_IN_PROGRESS", status: 409, error: "Une création d’étiquette Colissimo est déjà en cours pour cette commande." };
    }
    return { code: "COLISSIMO_RECONCILIATION_REQUIRED", status: 409, error: "Une tentative Colissimo doit être rapprochée dans la Cbox avant tout nouvel essai.", stalePending: true };
  }
  const weight = resolveBoutiqueOrderWeight(order);
  if (!weight.known) {
    return { code: "COLISSIMO_WEIGHT_REQUIRED", status: 400, error: "Poids du colis requis. Une étiquette ne peut pas être créée tant que le poids est inconnu." };
  }
  return null;
}

export function shipmentStatusOf(order) {
  const payment = String(order?.paymentStatus || "").toLowerCase();
  const status = String(order?.status || "");
  if (payment === "refunded" || status === "Remboursée") return "remboursée";
  if (status === "Annulée" || status === "Paiement échoué") return "annulée";
  if (status === "Livrée") return "livrée";
  if (status === "Expédiée") return "expédiée";
  if (status === "Prête à expédier") return "prête à expédier";
  if (status === "En préparation") return "en préparation";
  if (payment === "paid" || status === "À préparer") return "à préparer";
  if (payment === "pending" || status === "En attente SumUp") return "paiement en attente";
  return "paiement en attente";
}

function publicDelivery(order) {
  const pickup = normalizePickupPoint(order?.pickupPoint);
  if (pickup) {
    return {
      type: "pickup",
      label: "Point Relais Mondial Relay",
      pickupPoint: {
        id: pickup.id,
        name: pickup.name,
        address: pickup.address,
        postalCode: pickup.postalCode,
        city: pickup.city
      },
      address: null
    };
  }
  const shipping = order?.shippingAddress && typeof order.shippingAddress === "object" ? order.shippingAddress : {};
  const street = clean(shipping.address, 200);
  const postalCode = clean(shipping.postalCode, 12);
  const city = clean(shipping.city, 80);
  if (!street && !postalCode && !city) {
    return { type: "home", label: "Adresse de livraison", pickupPoint: null, address: null };
  }
  return {
    type: "home",
    label: "Adresse de livraison",
    pickupPoint: null,
    address: {
      street,
      postalCode,
      city,
      country: clean(shipping.country, 80) || "France"
    }
  };
}

export function clientStatusLabel(status) {
  const value = String(status || "À préparer");
  if (value === "À préparer") return "Commande confirmée";
  if (value === "Expédiée") return "Commande expédiée";
  return value;
}

export function publicClientOrder(order) {
  const carrier = clean(order?.carrier, 120);
  const tracking = clean(order?.tracking || order?.colissimoParcelNumber, 180);
  return {
    id: order.id,
    date: order.date,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    items: Array.isArray(order.items) ? order.items.map((item) => ({
      ref: item.ref,
      name: item.name,
      qty: Number(item.qty || 1),
      price: Number(item.price || 0)
    })) : [],
    paymentStatus: order.paymentStatus || "pending",
    status: order.status || "À préparer",
    statusLabel: clientStatusLabel(order.status),
    shipping: order.shipping || "Standard",
    shippingMethod: order.shippingMethod || "",
    carrier,
    tracking,
    trackingUrl: boutiqueTrackingUrl(carrier, tracking),
    shippedAt: order.shippedAt || "",
    shipmentStatus: shipmentStatusOf(order),
    delivery: publicDelivery(order),
    total: Number(order.total || 0)
  };
}

export function formatPickupSummary(pickup) {
  const point = normalizePickupPoint(pickup);
  if (!point) return "";
  return [point.name, "n° " + point.id, point.address, point.postalCode, point.city].filter(Boolean).join(" — ");
}

export function formatAddressSummary(order) {
  const pickup = formatPickupSummary(order?.pickupPoint);
  if (pickup) return pickup;
  const shipping = order?.shippingAddress || {};
  const parts = [shipping.address, [shipping.postalCode, shipping.city].filter(Boolean).join(" "), shipping.country].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return clean(order?.address, 400);
}
