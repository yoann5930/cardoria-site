/** Isolated manual Sendcloud Mondial Relay label. Independent of SENDCLOUD_LIVE_LABELS_ENABLED. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  searchMondialRelayServicePoints,
  getServicePoint,
  resolveShippingOption,
  createSendcloudShipment,
  downloadSendcloudLabel,
  getSendcloudTracking,
  cancelSendcloudShipment
} from "../lib/sendcloud.js";

const reportPath = process.env.SENDCLOUD_TEST_REPORT || path.join(os.tmpdir(), "sendcloud-real-label-test.json");
const pdfPath = process.env.SENDCLOUD_TEST_PDF || path.join(os.tmpdir(), "sendcloud-real-label-test.pdf");
let announceAttempted = false;

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}
function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function writeReport(report) {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

if (env("SENDCLOUD_ALLOW_REAL_TEST_LABEL") !== "true") {
  writeReport({
    status: "blocked",
    reason: "SENDCLOUD_ALLOW_REAL_TEST_LABEL_REQUIRED",
    realLabelCreated: false,
    productionLabelsFlag: env("SENDCLOUD_LIVE_LABELS_ENABLED") === "true"
  });
  process.exit(2);
}
if (!env("SENDCLOUD_PUBLIC_KEY") || !env("SENDCLOUD_SECRET_KEY")) {
  writeReport({ status: "blocked", reason: "SENDCLOUD_CREDENTIALS_MISSING", realLabelCreated: false });
  process.exit(2);
}
const phone = env("SENDCLOUD_TEST_MOBILE");
if (!phone) {
  writeReport({ status: "blocked", reason: "SENDCLOUD_TEST_MOBILE_MISSING", realLabelCreated: false });
  process.exit(2);
}

const expectedPostal = env("SENDCLOUD_TEST_POSTAL", "59330");
const expectedCity = env("SENDCLOUD_TEST_CITY", "Hautmont");
const search = await searchMondialRelayServicePoints({
  countryCode: "FR",
  postalCode: expectedPostal,
  city: expectedCity,
  limit: 30,
  radius: 20000
});
const matches = search.points.filter((point) => {
  const name = normalize(point.name);
  return name.includes("allvaps") && String(point.postalCode || "").replace(/\s+/g, "") === expectedPostal && normalize(point.city) === normalize(expectedCity);
});
if (matches.length !== 1) {
  writeReport({
    status: "blocked",
    reason: "ALL_VAPS_SERVICE_POINT_NOT_UNIQUE",
    realLabelCreated: false,
    matches: matches.map((point) => ({ id: point.id, name: point.name, city: point.city, postalCode: point.postalCode }))
  });
  process.exit(2);
}

const listed = matches[0];
if (!listed.active || listed.carrierCode !== "mondial_relay" || listed.countryCode !== "FR") {
  writeReport({ status: "blocked", reason: "SERVICE_POINT_NOT_MONDIAL_RELAY", realLabelCreated: false, servicePoint: { id: listed.id, name: listed.name } });
  process.exit(2);
}

const point = await getServicePoint(listed.id);
if (
  point.id !== listed.id
  || !point.active
  || point.carrierCode !== "mondial_relay"
  || point.countryCode !== "FR"
  || String(point.postalCode || "").replace(/\s+/g, "") !== expectedPostal
) {
  writeReport({ status: "blocked", reason: "SERVICE_POINT_MISMATCH", realLabelCreated: false, servicePoint: { id: point.id, name: point.name } });
  process.exit(2);
}

const fromAddress = {
  recipientName: env("SENDCLOUD_TEST_FROM_NAME", "Cardoria Test Expediteur"),
  addressLine1: env("SENDCLOUD_TEST_FROM_LINE1", "10 Rue Leon Gambetta"),
  houseNumber: env("SENDCLOUD_TEST_FROM_HOUSE", "10"),
  postalCode: env("SENDCLOUD_TEST_FROM_POSTAL", "59530"),
  city: env("SENDCLOUD_TEST_FROM_CITY", "Le Quesnoy"),
  countryCode: "FR",
  phone
};
const toAddress = {
  recipientName: env("SENDCLOUD_TEST_TO_NAME", "Yoann Thivet"),
  addressLine1: env("SENDCLOUD_TEST_TO_LINE1", point.street),
  houseNumber: env("SENDCLOUD_TEST_TO_HOUSE", point.houseNumber || ""),
  postalCode: point.postalCode,
  city: point.city,
  countryCode: "FR",
  phone
};
const weightGrams = 560;

let option;
try {
  option = await resolveShippingOption({
    carrierCode: "mondial_relay",
    fromAddress: {
      country_code: "FR",
      postal_code: fromAddress.postalCode,
      city: fromAddress.city,
      address_line_1: fromAddress.addressLine1
    },
    toAddress: {
      country_code: "FR",
      postal_code: toAddress.postalCode,
      city: toAddress.city,
      address_line_1: toAddress.addressLine1
    },
    weightGrams,
    servicePointId: point.id,
    calculateQuotes: true
  });
} catch (error) {
  writeReport({
    status: error.code === "ACCOUNT_PAYMENT_METHOD_REQUIRED" ? "ACCOUNT_PAYMENT_METHOD_REQUIRED" : "failed",
    reason: error.code || "SHIPPING_OPTION_FAILED",
    realLabelCreated: false,
    servicePoint: { id: point.id, name: point.name }
  });
  process.exit(error.code === "ACCOUNT_PAYMENT_METHOD_REQUIRED" ? 0 : 2);
}

if (option.carrierCode !== "mondial_relay" || option.lastMile !== "service_point") {
  writeReport({
    status: "blocked",
    reason: "SHIPPING_OPTION_NOT_MONDIAL_RELAY_SERVICE_POINT",
    realLabelCreated: false,
    optionCode: option.code,
    optionName: option.name
  });
  process.exit(2);
}

const quoteReport = {
  servicePoint: { id: point.id, name: point.name, postalCode: point.postalCode, city: point.city, carrierCode: point.carrierCode, active: point.active },
  optionCode: option.code,
  optionName: option.name,
  lastMile: option.lastMile,
  weightGrams,
  quote: option.quote,
  contractIdPresent: Boolean(option.contractId)
};

console.log("READY_TO_CREATE_ONE_REAL_TEST_LABEL");

let shipment = null;
let cancellation = null;
let pdfVerified = false;
let pdfBytes = 0;
let tracking = null;
try {
  if (announceAttempted) throw Object.assign(new Error("Announce already attempted"), { code: "SENDCLOUD_ANNOUNCE_ALREADY_ATTEMPTED" });
  announceAttempted = true;
  shipment = await createSendcloudShipment({
    orderNumber: `CARDORIA-MANUAL-TEST-${Date.now()}`,
    reference: "Cardoria manual Mondial Relay test",
    toAddress,
    toEmail: env("SENDCLOUD_TEST_EMAIL", "cardoria-test@cardoriashop.fr"),
    fromAddress,
    fromEmail: env("SENDCLOUD_TEST_EMAIL", "cardoria-test@cardoriashop.fr"),
    fromCompanyName: "Cardoria",
    weightGrams,
    totalOrderValue: 13,
    carrierCode: "mondial_relay",
    servicePointId: point.id
  });
  const pdf = await downloadSendcloudLabel(shipment.parcelId);
  pdfBytes = pdf.length;
  pdfVerified = Buffer.isBuffer(pdf) && pdf.subarray(0, 5).toString() === "%PDF-" && pdfBytes > 500 && pdfBytes <= 10000000;
  if (!pdfVerified) throw Object.assign(new Error("Downloaded label is not a coherent PDF"), { code: "SENDCLOUD_LABEL_INVALID" });
  fs.writeFileSync(pdfPath, pdf);
  tracking = await getSendcloudTracking(shipment.shipmentId);
} catch (error) {
  if (error.code === "ACCOUNT_PAYMENT_METHOD_REQUIRED") {
    writeReport({
      ...quoteReport,
      status: "ACCOUNT_PAYMENT_METHOD_REQUIRED",
      reason: "SENDCLOUD_BILLING_PAYMENT_METHOD_REQUIRED",
      sendcloudStatus: error.sendcloudStatus || 402,
      sendcloudErrorCode: error.sendcloudErrorCode || "no_valid_payment_method",
      realLabelCreated: false
    });
    process.exit(0);
  }
  writeReport({
    ...quoteReport,
    status: error.code === "SENDCLOUD_ANNOUNCEMENT_FAILED" && shipment?.shipmentId ? "MANUAL_CANCELLATION_REQUIRED" : "failed",
    reason: error.code || "LABEL_CREATE_FAILED",
    sendcloudStatus: error.sendcloudStatus || null,
    sendcloudErrorCode: error.sendcloudErrorCode || "",
    realLabelCreated: Boolean(shipment?.shipmentId),
    shipmentId: shipment?.shipmentId || null,
    parcelId: shipment?.parcelId || null
  });
  process.exit(2);
} finally {
  if (shipment?.shipmentId) {
    try { cancellation = await cancelSendcloudShipment(shipment.shipmentId); }
    catch { cancellation = { confirmed: false, status: "cancel_failed" }; }
  }
}

if (!cancellation?.confirmed) {
  writeReport({
    ...quoteReport,
    status: "MANUAL_CANCELLATION_REQUIRED",
    reason: "SENDCLOUD_CANCEL_UNCONFIRMED",
    realLabelCreated: Boolean(shipment?.shipmentId),
    shipmentId: shipment?.shipmentId || null,
    parcelId: shipment?.parcelId || null,
    trackingNumber: tracking?.trackingNumber || shipment?.trackingNumber || null,
    labelPdfVerified: pdfVerified,
    pdfBytes,
    cancellation,
    physicalParcelSent: false
  });
  process.exit(4);
}

writeReport({
  ...quoteReport,
  status: "label_created_verified_then_cancelled",
  realLabelCreated: true,
  shipmentId: shipment.shipmentId,
  parcelId: shipment.parcelId,
  trackingNumber: tracking?.trackingNumber || shipment.trackingNumber || null,
  labelPdfVerified: pdfVerified,
  pdfBytes,
  cancellation,
  physicalParcelSent: false
});
