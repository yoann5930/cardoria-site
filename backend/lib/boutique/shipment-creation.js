import crypto from "node:crypto";
import { readJson, writeJson } from "../storage.js";
import { withBoutiqueOrderLock } from "./order-lock.js";
import { isMondialRelayOrder, resolveBoutiqueOrderWeight, shipmentStatusOf } from "./shipping.js";
import {
  createSendcloudShipment,
  findSendcloudShipmentByOrderNumber,
  isSendcloudConfigured,
  searchMondialRelayServicePoints
} from "../sendcloud.js";
import { createColissimoLabel, getColissimoStatus } from "../colissimo.js";

const STORE = "orders";
const PENDING_MAX_MS = 10 * 60 * 1000;
const clean = (value, max = 500) => String(value == null ? "" : value).trim().slice(0, max);
const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });

function normalizeCountryCode(value) {
  const raw = clean(value || "FR", 40).toUpperCase();
  return /^[A-Z]{2}$/.test(raw) ? raw : "FR";
}

function providerFor(order) {
  return isMondialRelayOrder(order) ? "sendcloud" : "colissimo_direct";
}

function senderAddress() {
  const address = {
    recipientName: clean(process.env.CARDORIA_SENDER_NAME || "Cardoria", 120),
    addressLine1: clean(process.env.CARDORIA_SENDER_ADDRESS_LINE1, 160),
    addressLine2: clean(process.env.CARDORIA_SENDER_ADDRESS_LINE2, 160),
    postalCode: clean(process.env.CARDORIA_SENDER_POSTAL_CODE, 24),
    city: clean(process.env.CARDORIA_SENDER_CITY, 120),
    countryCode: normalizeCountryCode(process.env.CARDORIA_SENDER_COUNTRY || "FR"),
    phone: clean(process.env.CARDORIA_SENDER_PHONE, 32)
  };
  if (!address.recipientName || !address.addressLine1 || !address.postalCode || !address.city) {
    throw fail("CARDORIA_SENDER_NOT_CONFIGURED", "Adresse expéditeur Cardoria incomplète.", 503);
  }
  return {
    address,
    email: clean(process.env.CARDORIA_SENDER_EMAIL, 254),
    companyName: clean(process.env.CARDORIA_SENDER_NAME || "Cardoria", 160)
  };
}

function recipientAddress(order) {
  const shipping = order?.shippingAddress && typeof order.shippingAddress === "object" ? order.shippingAddress : {};
  const address = {
    recipientName: clean(order?.client || shipping.recipientName || shipping.name, 120),
    addressLine1: clean(shipping.address || shipping.addressLine1, 160),
    addressLine2: clean(shipping.addressLine2, 160),
    postalCode: clean(shipping.postalCode || shipping.zipCode, 24),
    city: clean(shipping.city, 120),
    countryCode: normalizeCountryCode(shipping.countryCode || shipping.country || "FR"),
    phone: clean(order?.phone || shipping.phone, 32)
  };
  if (!address.recipientName || !address.addressLine1 || !address.postalCode || !address.city) {
    throw fail("RECIPIENT_ADDRESS_REQUIRED", "Adresse de livraison complète requise avant la mise en préparation.", 409);
  }
  return address;
}

function relayCarrierId(value) {
  return clean(value, 40).replace(/^0+(?=\d)/, "");
}

async function resolveSendcloudServicePointId(order, searchPoints = searchMondialRelayServicePoints) {
  const pickup = order?.pickupPoint || {};
  const requested = relayCarrierId(pickup.carrierServicePointId || pickup.id);
  if (!requested || !pickup.postalCode || !pickup.city) {
    throw fail("SERVICE_POINT_REQUIRED", "Point Relais Mondial Relay incomplet.", 409);
  }

  const searches = [
    { postalCode: pickup.postalCode, city: pickup.city, limit: 30, radius: 15000 },
    { address: [pickup.address, pickup.postalCode, pickup.city].filter(Boolean).join(", "), limit: 30, radius: 50000 }
  ];

  for (const query of searches) {
    if (!query.address && (!query.postalCode || !query.city)) continue;
    const result = await searchPoints({ countryCode: normalizeCountryCode(pickup.countryCode || "FR"), ...query });
    const point = (result.points || []).find((item) => {
      const carrierId = relayCarrierId(item.carrierServicePointId);
      return carrierId === requested;
    });
    if (point?.id) return Number(point.id);
  }
  throw fail("SERVICE_POINT_NOT_FOUND", "Le Point Relais sélectionné n'a pas pu être rapproché chez Sendcloud.", 409);
}

function readOrder(orderId) {
  return readJson(STORE, []).find((row) => String(row.id) === String(orderId)) || null;
}

function safeTrackingUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function shouldReconcile(error) {
  const code = clean(error?.code, 100);
  if (code === "COLISSIMO_RECONCILIATION_REQUIRED") return true;
  if ([
    "SENDCLOUD_NETWORK_ERROR",
    "SENDCLOUD_TIMEOUT",
    "SENDCLOUD_RESPONSE_INVALID",
    "SENDCLOUD_RESPONSE_TOO_LARGE",
    "SENDCLOUD_ANNOUNCEMENT_FAILED",
    "SENDCLOUD_LABEL_INVALID"
  ].includes(code)) return true;
  if (code === "SENDCLOUD_API_ERROR" && Number(error?.sendcloudStatus || 0) >= 500) return true;
  return false;
}

async function persistFailure(orderId, claimId, provider, error) {
  const reconciliation = shouldReconcile(error);
  await withBoutiqueOrderLock(() => {
    const orders = readJson(STORE, []);
    const index = orders.findIndex((row) => String(row.id) === String(orderId));
    if (index < 0) return;
    const current = orders[index];
    if (claimId && current.shipmentCreation?.claimId !== claimId) return;
    const now = new Date().toISOString();
    current.shipmentCreation = {
      ...(current.shipmentCreation || {}),
      status: reconciliation ? "reconciliation_required" : "failed",
      provider,
      failedAt: now,
      code: clean(error?.code || "SHIPMENT_CREATION_FAILED", 100)
    };
    current.updatedAt = now;
    orders[index] = current;
    writeJson(STORE, orders);
  });
}

async function finalize(orderId, claimId, provider, shipment) {
  return withBoutiqueOrderLock(() => {
    const orders = readJson(STORE, []);
    const index = orders.findIndex((row) => String(row.id) === String(orderId));
    if (index < 0) throw fail("ORDER_NOT_FOUND", "Commande Boutique introuvable.", 404);
    const current = orders[index];
    if (claimId && current.shipmentCreation?.claimId !== claimId && !current.tracking) {
      throw fail("SHIPMENT_CLAIM_MISMATCH", "La tentative d'expédition a changé. Vérification requise.", 409);
    }
    const now = new Date().toISOString();
    const previousStatus = current.status;

    if (provider === "sendcloud") {
      current.carrier = "Mondial Relay";
      current.sendcloudShipmentId = clean(shipment.shipmentId, 180);
      current.sendcloudParcelId = clean(shipment.parcelId, 80);
      current.sendcloudStatus = clean(shipment.status, 80);
      current.shippingOptionCode = clean(shipment.shippingOptionCode, 240);
      current.tracking = clean(shipment.trackingNumber, 180);
      current.trackingUrl = safeTrackingUrl(shipment.trackingUrl);
      current.shippingLabelProvider = "sendcloud";
    } else {
      current.carrier = "Colissimo (La Poste)";
      current.colissimoParcelNumber = clean(shipment.parcelNumber, 40);
      current.colissimoProductCode = clean(shipment.productCode, 40);
      current.colissimoLabelFormat = clean(shipment.labelFormat, 80);
      current.colissimoPdfUrl = clean(shipment.pdfUrl, 1000);
      current.tracking = clean(shipment.trackingNumber || shipment.parcelNumber, 180);
      current.trackingUrl = safeTrackingUrl(shipment.trackingUrl);
      current.shippingLabelProvider = "colissimo_direct";
    }

    current.status = "En préparation";
    current.preparingAt = current.preparingAt || now;
    if (previousStatus !== "En préparation") current.statusChangedAt = now;
    current.shipmentStatus = shipmentStatusOf(current);
    current.shipmentCreation = {
      status: current.tracking ? "created" : "tracking_pending",
      provider,
      claimId: claimId || clean(current.shipmentCreation?.claimId, 80),
      createdAt: now
    };
    current.updatedAt = now;
    orders[index] = current;
    writeJson(STORE, orders);
    return { ...current };
  });
}

async function reconcileSendcloud(orderId, claimId, deps) {
  const remote = await deps.findSendcloudShipmentByOrderNumber(orderId);
  if (!remote?.shipmentId || !remote?.parcelId) {
    throw fail(
      "SHIPMENT_RECONCILIATION_REQUIRED",
      "Une tentative Sendcloud existe déjà mais n'est pas rapprochée. Vérifiez Sendcloud avant tout nouvel essai.",
      409
    );
  }
  return finalize(orderId, claimId, "sendcloud", remote);
}

export async function createBoutiqueShipmentForPreparation(orderId, options = {}) {
  const deps = {
    createSendcloudShipment: options.createSendcloudShipment || createSendcloudShipment,
    findSendcloudShipmentByOrderNumber: options.findSendcloudShipmentByOrderNumber || findSendcloudShipmentByOrderNumber,
    searchMondialRelayServicePoints: options.searchMondialRelayServicePoints || searchMondialRelayServicePoints,
    createColissimoLabel: options.createColissimoLabel || createColissimoLabel
  };

  const intent = await withBoutiqueOrderLock(() => {
    const orders = readJson(STORE, []);
    const index = orders.findIndex((row) => String(row.id) === String(orderId));
    if (index < 0) throw fail("ORDER_NOT_FOUND", "Commande Boutique introuvable.", 404);
    const current = orders[index];

    if (current.paymentStatus !== "paid") {
      throw fail("PAYMENT_NOT_PAID", "Le paiement doit être confirmé avant la mise en préparation.", 409);
    }
    if (current.status === "Annulée") throw fail("ORDER_CANCELLED", "Une commande annulée ne peut pas être préparée.", 409);

    const provider = providerFor(current);
    if (current.tracking) {
      return { mode: "existing", provider, order: { ...current } };
    }
    if (provider === "colissimo_direct" && current.colissimoParcelNumber) {
      return { mode: "existing_colissimo", provider, order: { ...current } };
    }
    if (provider === "sendcloud" && current.sendcloudShipmentId) {
      return { mode: "reconcile_sendcloud", provider, claimId: clean(current.shipmentCreation?.claimId, 80), order: { ...current } };
    }

    const attempt = current.shipmentCreation || {};
    if (attempt.status === "reconciliation_required") {
      if (provider === "sendcloud") {
        return { mode: "reconcile_sendcloud", provider, claimId: clean(attempt.claimId, 80), order: { ...current } };
      }
      throw fail("SHIPMENT_RECONCILIATION_REQUIRED", "Une tentative Colissimo doit être rapprochée avant tout nouvel essai.", 409);
    }
    if (attempt.status === "creation_pending") {
      const age = Date.now() - Date.parse(attempt.startedAt || 0);
      if (Number.isFinite(age) && age >= 0 && age < PENDING_MAX_MS) {
        throw fail("SHIPMENT_CREATION_IN_PROGRESS", "La création de l'étiquette est déjà en cours.", 409);
      }
      if (provider === "sendcloud") {
        return { mode: "reconcile_sendcloud", provider, claimId: clean(attempt.claimId, 80), order: { ...current } };
      }
      throw fail("SHIPMENT_RECONCILIATION_REQUIRED", "Une tentative Colissimo ancienne doit être rapprochée avant tout nouvel essai.", 409);
    }

    const weight = resolveBoutiqueOrderWeight(current);
    if (!weight.known) {
      throw fail("SHIPMENT_WEIGHT_REQUIRED", "Poids du colis requis avant la mise en préparation.", 400);
    }

    if (provider === "sendcloud" && !isSendcloudConfigured()) {
      throw fail("SENDCLOUD_NOT_CONFIGURED", "Sendcloud n'est pas configuré côté serveur.", 503);
    }
    if (provider === "colissimo_direct") {
      const status = getColissimoStatus();
      if (!status.configured || !status.senderConfigured || !status.labelPurchasesEnabled) {
        throw fail("COLISSIMO_NOT_READY", "Colissimo n'est pas entièrement configuré pour créer une étiquette réelle.", 503);
      }
    }

    const claimId = crypto.randomUUID();
    const now = new Date().toISOString();
    current.shippingWeightGrams = weight.grams;
    current.weightSource = weight.source;
    current.shipmentCreation = {
      status: "creation_pending",
      provider,
      claimId,
      startedAt: now
    };
    current.updatedAt = now;
    orders[index] = current;
    writeJson(STORE, orders);
    return { mode: "create", provider, claimId, order: { ...current }, weightGrams: weight.grams };
  });

  if (intent.mode === "existing") {
    return finalize(orderId, "", intent.provider, intent.provider === "sendcloud"
      ? {
          shipmentId: intent.order.sendcloudShipmentId,
          parcelId: intent.order.sendcloudParcelId,
          trackingNumber: intent.order.tracking,
          trackingUrl: intent.order.trackingUrl,
          status: intent.order.sendcloudStatus,
          shippingOptionCode: intent.order.shippingOptionCode
        }
      : {
          parcelNumber: intent.order.colissimoParcelNumber || intent.order.tracking,
          trackingNumber: intent.order.tracking,
          trackingUrl: intent.order.trackingUrl,
          pdfUrl: intent.order.colissimoPdfUrl,
          productCode: intent.order.colissimoProductCode,
          labelFormat: intent.order.colissimoLabelFormat
        });
  }

  if (intent.mode === "existing_colissimo") {
    return finalize(orderId, "", "colissimo_direct", {
      parcelNumber: intent.order.colissimoParcelNumber,
      trackingNumber: intent.order.colissimoParcelNumber,
      trackingUrl: intent.order.trackingUrl,
      pdfUrl: intent.order.colissimoPdfUrl,
      productCode: intent.order.colissimoProductCode,
      labelFormat: intent.order.colissimoLabelFormat
    });
  }

  if (intent.mode === "reconcile_sendcloud") {
    return reconcileSendcloud(orderId, intent.claimId, deps);
  }

  try {
    if (intent.provider === "sendcloud") {
      const recipient = recipientAddress(intent.order);
      const sender = senderAddress();
      const servicePointId = await resolveSendcloudServicePointId(intent.order, deps.searchMondialRelayServicePoints);
      let shipment = await deps.createSendcloudShipment({
        orderNumber: intent.order.id,
        reference: intent.order.id,
        toAddress: recipient,
        toEmail: clean(intent.order.email, 254),
        fromAddress: sender.address,
        fromEmail: sender.email,
        fromCompanyName: sender.companyName,
        weightGrams: intent.weightGrams,
        totalOrderValue: Number(intent.order.total || 0),
        carrierCode: "mondial_relay",
        servicePointId
      });
      if (!shipment.trackingNumber) {
        const reconciled = await deps.findSendcloudShipmentByOrderNumber(intent.order.id);
        if (reconciled?.shipmentId && reconciled?.parcelId) shipment = { ...shipment, ...reconciled };
      }
      return finalize(orderId, intent.claimId, "sendcloud", shipment);
    }

    const shipment = await deps.createColissimoLabel({ order: intent.order, weightGrams: intent.weightGrams });
    return finalize(orderId, intent.claimId, "colissimo_direct", shipment);
  } catch (error) {
    if (intent.provider === "sendcloud" && shouldReconcile(error)) {
      try {
        const reconciled = await deps.findSendcloudShipmentByOrderNumber(intent.order.id);
        if (reconciled?.shipmentId && reconciled?.parcelId) {
          return finalize(orderId, intent.claimId, "sendcloud", reconciled);
        }
      } catch {}
    }
    await persistFailure(orderId, intent.claimId, intent.provider, error);
    throw error;
  }
}
