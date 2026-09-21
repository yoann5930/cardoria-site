import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGenerateLabelRequest,
  colissimoLabelPurchasesEnabled,
  colissimoPublicStatus,
  createColissimoShipment,
  isColissimoConfigured,
  parseGenerateLabelResponse
} from "../lib/colissimo.js";
import { isLaPosteCarrier } from "../lib/laposte-order-labels.js";

const keys = [
  "COLISSIMO_CONTRACT_NUMBER",
  "COLISSIMO_PASSWORD",
  "COLISSIMO_LABELS_ENABLED",
  "CARDORIA_SENDER_NAME",
  "CARDORIA_SENDER_ADDRESS_LINE1",
  "CARDORIA_SENDER_POSTAL_CODE",
  "CARDORIA_SENDER_CITY",
  "CARDORIA_SENDER_COUNTRY"
];

function configure() {
  process.env.COLISSIMO_CONTRACT_NUMBER = "123456";
  process.env.COLISSIMO_PASSWORD = "test-password";
  process.env.COLISSIMO_LABELS_ENABLED = "false";
  process.env.CARDORIA_SENDER_NAME = "Cardoria";
  process.env.CARDORIA_SENDER_ADDRESS_LINE1 = "1 rue des Cartes";
  process.env.CARDORIA_SENDER_POSTAL_CODE = "59330";
  process.env.CARDORIA_SENDER_CITY = "Hautmont";
  process.env.CARDORIA_SENDER_COUNTRY = "FR";
}

test("Colissimo status stays closed until credentials exist", () => {
  for (const key of keys) delete process.env[key];
  assert.equal(isColissimoConfigured(), false);
  assert.equal(colissimoLabelPurchasesEnabled(), false);
  const status = colissimoPublicStatus();
  assert.equal(status.ok, true);
  assert.equal(status.provider, "colissimo");
  assert.equal(status.configured, false);
  assert.equal(status.labelPurchasesEnabled, false);
  assert.doesNotMatch(JSON.stringify(status), /password|123456|test-password/i);
});

test("generateLabel request uses Colissimo domicile and kilograms", () => {
  configure();
  const request = buildGenerateLabelRequest({
    orderId: "CMD-20260921-1001",
    weightGrams: 80,
    toAddress: {
      recipientName: "Jean Dupont",
      addressLine1: "17 Avenue Marcel Aime",
      postalCode: "59330",
      city: "Hautmont",
      countryCode: "FR",
      phone: "0612345678"
    },
    toEmail: "client@example.com"
  });
  assert.equal(request.letter.service.productCode, "DOM");
  assert.equal(request.letter.parcel.weight, 0.08);
  assert.equal(request.letter.addressee.address.zipCode, "59330");
  assert.equal(request.letter.addressee.address.city, "Hautmont");
  assert.equal(request.outputFormat.outputPrintingType, "PDF_A4_300dpi");
  assert.equal(request.password, process.env.COLISSIMO_PASSWORD);
});

test("real Colissimo label creation is disabled by default and does not touch the network", async () => {
  configure();
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network should not be used"); };
  try {
    await assert.rejects(createColissimoShipment({
      orderId: "CMD-20260921-1002",
      weightGrams: 80,
      toAddress: { recipientName: "Jean Dupont", addressLine1: "17 Avenue Marcel Aime", postalCode: "59330", city: "Hautmont", countryCode: "FR" }
    }), { code: "COLISSIMO_LABELS_NOT_ACTIVATED" });
  } finally { globalThis.fetch = original; }
});

test("Colissimo success returns a parcel number and PDF, errors never invent tracking", () => {
  const pdf = Buffer.from("%PDF-1.4 test").toString("base64");
  const ok = parseGenerateLabelResponse({
    messages: [{ id: "0", type: "INFOS", messageContent: "La requête a été traitée avec succès" }],
    labelV2Response: { parcelNumber: "6C12345678901", label: pdf }
  });
  assert.equal(ok.trackingNumber, "6C12345678901");
  assert.match(ok.trackingUrl, /laposte\.fr/);
  assert.ok(ok.pdf.length > 0);
  assert.throws(() => parseGenerateLabelResponse({
    messages: [{ id: "102", type: "ERROR", messageContent: "Mot de passe invalide" }],
    labelV2Response: { parcelNumber: "6C00000000000", label: pdf }
  }), { code: "COLISSIMO_CREATION_REJECTED" });
});

test("La Poste and Colissimo are the same paid-label carrier", () => {
  assert.equal(isLaPosteCarrier("La Poste"), true);
  assert.equal(isLaPosteCarrier("colissimo"), true);
  assert.equal(isLaPosteCarrier("Mondial Relay"), false);
});
