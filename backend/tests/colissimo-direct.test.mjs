import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.COLISSIMO_API_KEY = "test-api-key";
process.env.COLISSIMO_API_BASE = "https://ws.colissimo.fr/sls-ws/SlsServiceWSRest/3.1";
process.env.COLISSIMO_PRODUCT_CODE = "DOM";
process.env.COLISSIMO_LABEL_FORMAT = "PDF_10x15_300dpi";
process.env.CARDORIA_SENDER_NAME = "Cardoria";
process.env.CARDORIA_SENDER_ADDRESS_LINE1 = "17 avenue Marcel Aime";
process.env.CARDORIA_SENDER_ADDRESS_LINE2 = "";
process.env.CARDORIA_SENDER_POSTAL_CODE = "59330";
process.env.CARDORIA_SENDER_CITY = "Hautmont";
process.env.CARDORIA_SENDER_COUNTRY = "FR";
process.env.CARDORIA_SENDER_PHONE = "0955807522";
process.env.CARDORIA_SENDER_EMAIL = "contact@example.test";

const {
  buildColissimoLabelRequest,
  colissimoLabelPurchasesEnabled,
  createColissimoLabel,
  getColissimoStatus,
  isColissimoConfigured,
  isColissimoSenderConfigured,
  parseColissimoResponse
} = await import("../lib/colissimo.js");

const order = {
  id: "CMD-20260921-1234",
  client: "Client Test",
  email: "client@example.test",
  phone: "0612345678",
  shippingAddress: {
    address: "12 rue de Paris",
    postalCode: "75001",
    city: "Paris",
    country: "France"
  }
};

test("Colissimo status never exposes the API key", () => {
  const status = getColissimoStatus();
  assert.equal(isColissimoConfigured(), true);
  assert.equal(isColissimoSenderConfigured(), true);
  assert.equal(status.configured, true);
  assert.equal(status.senderConfigured, true);
  assert.equal(status.apiVersion, "3.1");
  assert.equal(status.productCode, "DOM");
  assert.equal(status.labelFormat, "PDF_10x15_300dpi");
  assert.equal("apiKey" in status, false);
  assert.equal(JSON.stringify(status).includes("test-api-key"), false);
});

test("Colissimo DOM request uses server order address and kilograms", () => {
  const request = buildColissimoLabelRequest({
    order,
    weightGrams: 250,
    depositDate: new Date("2026-09-21T10:00:00Z")
  });
  assert.equal(request.letter.service.productCode, "DOM");
  assert.equal(request.letter.service.depositDate, "2026-09-21");
  assert.equal(request.letter.service.orderNumber, order.id);
  assert.equal(request.letter.parcel.weight, 0.25);
  assert.equal(request.letter.sender.zipCode, "59330");
  assert.equal(request.letter.addressee.lastName, "Client Test");
  assert.equal(request.letter.addressee.line2, "12 rue de Paris");
  assert.equal(request.letter.addressee.zipCode, "75001");
  assert.equal(request.letter.addressee.city, "Paris");
  assert.equal(request.letter.addressee.countryCode, "FR");
  assert.equal(request.outputFormat.outputPrintingType, "PDF_10x15_300dpi");
  assert.equal("contractNumber" in request, false);
  assert.equal("password" in request, false);
});

test("Colissimo can rebuild a France address from the Boutique textarea fallback", () => {
  const request = buildColissimoLabelRequest({
    order: {
      id: "CMD-20260921-9999",
      client: "Client Fallback",
      email: "fallback@example.test",
      phone: "0612345678",
      address: "8 rue des Fleurs\n59330 Hautmont\nFrance"
    },
    weightGrams: 120,
    depositDate: "2026-09-21"
  });
  assert.equal(request.letter.addressee.line2, "8 rue des Fleurs");
  assert.equal(request.letter.addressee.zipCode, "59330");
  assert.equal(request.letter.addressee.city, "Hautmont");
  assert.equal(request.letter.addressee.countryCode, "FR");
});

test("Colissimo multipart parser extracts jsonInfos and PDF label", () => {
  const boundary = "cardoria-colissimo-test";
  const pdf = "%PDF-1.4\nTEST-LABEL\n%%EOF";
  const body = [
    "--" + boundary,
    'Content-Disposition: form-data; name="jsonInfos"',
    "Content-Type: application/json",
    "",
    JSON.stringify({ parcelNumber: "6A999999999", messages: [] }),
    "--" + boundary,
    'Content-Disposition: form-data; name="label"; filename="label.pdf"',
    "Content-Type: application/pdf",
    "",
    pdf,
    "--" + boundary + "--",
    ""
  ].join("\r\n");
  const parsed = parseColissimoResponse(Buffer.from(body, "latin1"), "multipart/mixed; boundary=" + boundary);
  assert.equal(parsed.json.parcelNumber, "6A999999999");
  assert.equal(parsed.label.toString("latin1"), pdf);
});

test("real Colissimo label creation stays locked until explicitly enabled", async () => {
  delete process.env.COLISSIMO_LIVE_LABELS_ENABLED;
  assert.equal(colissimoLabelPurchasesEnabled(), false);
  await assert.rejects(() => createColissimoLabel({ order, weightGrams: 250 }), (error) => {
    assert.equal(error.code, "COLISSIMO_LABELS_NOT_ACTIVATED");
    assert.equal(error.status, 503);
    return true;
  });
});

test("Boutique admin route protects duplicate labels and reconciliation ambiguity", () => {
  const routes = fs.readFileSync("backend/routes/payments-admin.js", "utf8");
  assert.match(routes, /boutique-orders\/:id\/colissimo-label/);
  assert.match(routes, /COLISSIMO_LABEL_ALREADY_CREATED/);
  assert.match(routes, /COLISSIMO_RECONCILIATION_REQUIRED/);
  assert.match(routes, /paymentStatus !== "paid"/);
  assert.match(routes, /shippingWeightGrams/);
  assert.match(routes, /downloadColissimoLabel/);
});

test("admin order UI exposes Colissimo weight, create and download controls", () => {
  const source = fs.readFileSync("js/admin/admin-orders.js", "utf8");
  const runtime = fs.readFileSync("backend/public/js/admin/admin-orders.js", "utf8");
  assert.match(source, /Poids du colis \(g\)/);
  assert.match(source, /data-colissimo-create/);
  assert.match(source, /data-colissimo-download/);
  assert.match(source, /rapprochement requis dans la Cbox/i);
  assert.equal(runtime, source);
});
