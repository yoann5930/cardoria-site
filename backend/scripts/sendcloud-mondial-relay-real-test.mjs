/** Manual Mondial Relay / Sendcloud v3 probe. Never commit secrets or a real mobile number. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  searchMondialRelayServicePoints,
  resolveShippingOption,
  createSendcloudShipment,
  downloadSendcloudLabel,
  getSendcloudTracking,
  cancelSendcloudShipment
} from "../lib/sendcloud.js";

const CREATE = process.argv.includes("--create-label") || process.env.SENDCLOUD_CREATE_TEST_LABEL === "true";
const reportPath = process.env.SENDCLOUD_TEST_REPORT || path.join(os.tmpdir(), "sendcloud-mondial-relay-real-test.json");
const pdfPath = process.env.SENDCLOUD_TEST_PDF || path.join(os.tmpdir(), "sendcloud-mondial-relay-real-test.pdf");

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

const phone = env("SENDCLOUD_TEST_MOBILE");
if (!env("SENDCLOUD_PUBLIC_KEY") || !env("SENDCLOUD_SECRET_KEY")) {
  writeReport({ status: "blocked", reason: "SENDCLOUD_CREDENTIALS_MISSING", realLabelCreated: false });
  process.exit(2);
}
if (!phone) {
  writeReport({ status: "blocked", reason: "SENDCLOUD_TEST_MOBILE_MISSING", realLabelCreated: false });
  process.exit(2);
}

const search = await searchMondialRelayServicePoints({
  countryCode: "FR",
  postalCode: env("SENDCLOUD_TEST_POSTAL", "59330"),
  city: env("SENDCLOUD_TEST_CITY", "Hautmont"),
  limit: 30,
  radius: 20000
});
const expectedPostal = env("SENDCLOUD_TEST_POSTAL", "59330");
const matches = search.points.filter((point) => normalize(point.name).includes("allvaps") && String(point.postalCode || "").replace(/\s+/g, "") === expectedPostal);
if (matches.length !== 1) {
  writeReport({
    status: "blocked",
    reason: "ALL_VAPS_SERVICE_POINT_NOT_UNIQUE",
    realLabelCreated: false,
    matches: matches.map((point) => ({ id: point.id, name: point.name, city: point.city, postalCode: point.postalCode }))
  });
  process.exit(2);
}

const point = matches[0];
if (!point.active || point.carrierCode !== "mondial_relay" || point.countryCode !== "FR") {
  writeReport({ status: "blocked", reason: "SERVICE_POINT_NOT_MONDIAL_RELAY", realLabelCreated: false, servicePoint: { id: point.id, name: point.name } });
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
  addressLine1: env("SENDCLOUD_TEST_TO_LINE1", point.street || "Avenue Marcel Aime"),
  houseNumber: env("SENDCLOUD_TEST_TO_HOUSE", point.houseNumber || ""),
  postalCode: point.postalCode || "59330",
  city: point.city || "Hautmont",
  countryCode: "FR",
  phone
};
const weightGrams = Math.max(1, Number(env("SENDCLOUD_TEST_WEIGHT_GRAMS", "560")) || 560);

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

const quoteReport = {
  status: CREATE ? "creating_label" : "QUOTE_ONLY",
  realLabelCreated: false,
  servicePoint: { id: point.id, name: point.name },
  optionCode: option.code,
  optionName: option.name,
  weightGrams,
  quote: option.quote,
  contractIdPresent: Boolean(option.contractId)
};

if (!CREATE) {
  writeReport({ ...quoteReport, status: "QUOTE_ONLY", reason: "SENDCLOUD_CREATE_TEST_LABEL_NOT_SET" });
  process.exit(0);
}

let shipment = null;
let cancellation = null;
let pdfVerified = false;
let tracking = null;
try {
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
  pdfVerified = Buffer.isBuffer(pdf) && pdf.subarray(0, 4).toString() === "%PDF" && pdf.length > 500;
  if (!pdfVerified) throw Object.assign(new Error("Downloaded label is not a PDF"), { code: "SENDCLOUD_LABEL_INVALID" });
  fs.writeFileSync(pdfPath, pdf);
  tracking = await getSendcloudTracking(shipment.shipmentId);
} catch (error) {
  if (error.code === "ACCOUNT_PAYMENT_METHOD_REQUIRED") {
    writeReport({
      ...quoteReport,
      status: "ACCOUNT_PAYMENT_METHOD_REQUIRED",
      reason: "SENDCLOUD_BILLING_PAYMENT_METHOD_REQUIRED",
      realLabelCreated: false
    });
    process.exit(0);
  }
  writeReport({
    ...quoteReport,
    status: "failed",
    reason: error.code || "LABEL_CREATE_FAILED",
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

writeReport({
  ...quoteReport,
  status: pdfVerified && cancellation?.confirmed ? "label_created_verified_then_cancelled" : pdfVerified ? "label_created_cancel_unconfirmed" : "failed",
  realLabelCreated: Boolean(shipment?.shipmentId),
  shipmentId: shipment?.shipmentId || null,
  parcelId: shipment?.parcelId || null,
  trackingNumber: tracking?.trackingNumber || shipment?.trackingNumber || null,
  labelPdfVerified: pdfVerified,
  cancellation,
  physicalParcelSent: false
});
if (!pdfVerified) process.exit(3);
if (!cancellation?.confirmed) process.exit(4);
