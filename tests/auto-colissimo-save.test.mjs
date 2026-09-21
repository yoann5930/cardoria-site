import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("js/admin/admin-orders.js", "utf8");
const runtime = fs.readFileSync("backend/public/js/admin/admin-orders.js", "utf8");

test("saving an Expédiée Colissimo order auto-creates a label when tracking is empty", () => {
  assert.match(source, /data\.status==="Expédiée" && data\.carrier==="Colissimo \(La Poste\)" && !String\(data\.tracking\|\|""\)\.trim\(\)/);
  assert.match(source, /\/colissimo-label/);
  assert.match(source, /weightGrams:Math\.trunc\(weight\)/);
});

test("Colissimo tracking number is injected in the tracking input before the order update", () => {
  assert.match(source, /data\.tracking=String\(label\.trackingNumber\|\|label\.parcelNumber\|\|""\)\.trim\(\)/);
  assert.match(source, /trackingInput\.value=data\.tracking/);
  const createIndex = source.indexOf('/colissimo-label');
  const putIndex = source.indexOf('method:"PUT",body:JSON.stringify(data)');
  assert.ok(createIndex >= 0 && putIndex > createIndex, "label creation must happen before the order PUT");
});

test("an existing Colissimo parcel number is displayed as a tracking fallback", () => {
  assert.match(source, /o\.tracking\|\|o\.colissimoParcelNumber\|\|""/);
});

test("automatic label purchase remains gated by Colissimo production readiness", () => {
  assert.match(source, /colissimo\.configured && colissimo\.senderConfigured && colissimo\.labelPurchasesEnabled/);
  assert.match(source, /Colissimo n’est pas encore prêt pour créer une étiquette réelle/);
});

test("saving keeps the existing tracking email flow after shipment", () => {
  assert.match(source, /d\.emailNotification\.sent/);
  assert.match(source, /Mail de suivi envoyé/);
  assert.match(source, /Commande expédiée · suivi/);
});

test("source and OVH runtime stay identical", () => {
  assert.equal(runtime, source);
});
