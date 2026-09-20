/** Isolated one-shot Mondial Relay sandbox label. Independent of MONDIAL_RELAY_LIVE_LABELS_ENABLED. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createMondialRelayShipment,
  downloadMondialRelayLabel,
  mondialRelayApiEnvironment,
  mondialRelayLabelPurchasesEnabled,
  searchMondialRelayServicePoints
} from "../lib/mondial-relay.js";

function env(name) {
  return String(process.env[name] || "").trim();
}

const reportPath = process.env.MONDIAL_RELAY_TEST_REPORT || path.join(os.tmpdir(), "mondial-relay-sandbox-label-test.json");
function writeReport(payload) {
  const report = { ...payload, productionLabelsFlag: mondialRelayLabelPurchasesEnabled() };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

if (env("MONDIAL_RELAY_ALLOW_SANDBOX_TEST_LABEL") !== "true") {
  writeReport({ status: "blocked", reason: "MONDIAL_RELAY_ALLOW_SANDBOX_TEST_LABEL_REQUIRED", realLabelCreated: false });
  process.exit(2);
}
if (mondialRelayApiEnvironment() !== "sandbox") {
  writeReport({ status: "blocked", reason: "MONDIAL_RELAY_SANDBOX_ENV_REQUIRED", realLabelCreated: false });
  process.exit(2);
}

const phone = env("MONDIAL_RELAY_TEST_MOBILE");
const sender = {
  recipientName: env("CARDORIA_SENDER_NAME") || "Cardoria",
  addressLine1: env("CARDORIA_SENDER_ADDRESS_LINE1"),
  addressLine2: env("CARDORIA_SENDER_ADDRESS_LINE2"),
  postalCode: env("CARDORIA_SENDER_POSTAL_CODE"),
  city: env("CARDORIA_SENDER_CITY"),
  countryCode: env("CARDORIA_SENDER_COUNTRY") || "FR",
  phone: env("CARDORIA_SENDER_PHONE")
};
const missing = [
  !env("MONDIAL_RELAY_ENSEIGNE") && "MONDIAL_RELAY_ENSEIGNE",
  !env("MONDIAL_RELAY_PRIVATE_KEY") && "MONDIAL_RELAY_PRIVATE_KEY",
  !env("MONDIAL_RELAY_API_V2_LOGIN") && "MONDIAL_RELAY_API_V2_LOGIN",
  !env("MONDIAL_RELAY_API_V2_PASSWORD") && "MONDIAL_RELAY_API_V2_PASSWORD",
  !env("MONDIAL_RELAY_API_V2_CUSTOMER_ID") && "MONDIAL_RELAY_API_V2_CUSTOMER_ID",
  !phone && "MONDIAL_RELAY_TEST_MOBILE",
  !sender.addressLine1 && "CARDORIA_SENDER_ADDRESS_LINE1",
  !sender.postalCode && "CARDORIA_SENDER_POSTAL_CODE",
  !sender.city && "CARDORIA_SENDER_CITY"
].filter(Boolean);
if (missing.length) {
  writeReport({ status: "blocked", reason: "MONDIAL_RELAY_NOT_CONFIGURED", missing, realLabelCreated: false });
  process.exit(2);
}

const search = await searchMondialRelayServicePoints({ countryCode: "FR", postalCode: "59330", city: "Hautmont", radius: 15000, limit: 10 });
const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const matches = search.points.filter(point => normalize(point.name).includes("allvaps") && point.postalCode === "59330" && point.countryCode === "FR");
if (matches.length !== 1) {
  writeReport({
    status: "blocked",
    reason: "ALL_VAPS_SERVICE_POINT_NOT_UNIQUE",
    count: matches.length,
    realLabelCreated: false
  });
  process.exit(2);
}
const point = matches[0];
console.log("READY_TO_CREATE_ONE_SANDBOX_TEST_LABEL");

let created;
try {
  created = await createMondialRelayShipment({
    orderNumber: "CRD-SANDBOX-" + Date.now().toString(36).toUpperCase(),
    reference: "SANDBOX",
    fromAddress: sender,
    fromEmail: env("CARDORIA_SENDER_EMAIL") || "cardoria-test@cardoriashop.fr",
    fromCompanyName: "Cardoria",
    toAddress: {
      recipientName: env("MONDIAL_RELAY_TEST_TO_NAME") || "Yoann Thivet",
      addressLine1: [point.street, point.houseNumber].filter(Boolean).join(" ") || sender.addressLine1,
      postalCode: point.postalCode,
      city: point.city,
      countryCode: "FR",
      phone
    },
    toEmail: "cardoria-test@cardoriashop.fr",
    weightGrams: 560,
    totalOrderValue: 13,
    servicePointId: point.id,
    content: "CARTES TCG"
  });
} catch (error) {
  writeReport({
    status: "failed",
    reason: error.code || "MONDIAL_RELAY_API_ERROR",
    providerStat: error.providerStat || "",
    realLabelCreated: false,
    shipmentNumber: null
  });
  process.exit(2);
}

if (!created?.shipmentNumber || !created.labelUrl) {
  writeReport({ status: "failed", reason: "MONDIAL_RELAY_CREATION_INVALID", realLabelCreated: false, shipmentNumber: created?.shipmentNumber || null });
  process.exit(2);
}

const pdf = await downloadMondialRelayLabel(created.labelUrl);
const pdfPath = process.env.MONDIAL_RELAY_TEST_PDF || path.join(os.tmpdir(), "mondial-relay-sandbox-label-test.pdf");
fs.writeFileSync(pdfPath, pdf);
writeReport({
  status: "created",
  realLabelCreated: true,
  servicePoint: { id: point.id, name: point.name, postalCode: point.postalCode, city: point.city },
  shipmentNumber: created.shipmentNumber,
  trackingNumber: created.trackingNumber,
  trackingUrl: created.trackingUrl,
  pdfVerified: pdf.subarray(0, 5).toString() === "%PDF-" && pdf.length > 500,
  pdfBytes: pdf.length
});
