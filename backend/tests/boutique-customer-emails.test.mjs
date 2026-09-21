import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildBoutiquePurchaseEmail,
  buildBoutiqueTrackingEmail,
  deliverBoutiquePurchaseEmail,
  deliverBoutiqueTrackingEmail
} from "../lib/boutique/customer-emails.js";

const order = {
  id: "CMD-20260921-3918",
  client: "Client Test",
  email: "client@example.test",
  total: 2.5,
  items: [
    { ref: "PKM-001", name: "Carte Pokémon Test", qty: 2, price: 1.25 }
  ],
  paymentStatus: "paid",
  status: "Expédiée",
  carrier: "Colissimo (La Poste)",
  tracking: "6A123456789"
};

test("purchase confirmation contains the real order, items and total", () => {
  const message = buildBoutiquePurchaseEmail(order);
  assert.equal(message.to, "client@example.test");
  assert.match(message.subject, /CMD-20260921-3918/);
  assert.match(message.text, /Carte Pokémon Test/);
  assert.match(message.text, /2,50 €/);
  assert.match(message.text, /https:\/\/www\.cardoriashop\.fr\/client-orders\.html/);
  assert.match(message.html, /Commande confirmée/);
});

test("tracking email contains carrier, tracking number and official La Poste link", () => {
  const message = buildBoutiqueTrackingEmail(order);
  assert.equal(message.to, "client@example.test");
  assert.match(message.subject, /a été expédiée/);
  assert.match(message.text, /Colissimo \(La Poste\)/);
  assert.match(message.text, /6A123456789/);
  assert.match(message.text, /laposte\.fr\/outils\/suivre-vos-envois\?code=6A123456789/);
  assert.match(message.html, /Suivre mon colis/);
});

test("purchase and tracking deliveries use the existing SMTP boundary", async () => {
  const previousEnv = process.env.NODE_ENV;
  const previousOutbox = process.env.CARDORIA_TEST_EMAIL_OUTBOX;
  const outbox = path.join(os.tmpdir(), "cardoria-email-" + process.pid + "-" + Date.now() + ".json");
  process.env.NODE_ENV = "test";
  process.env.CARDORIA_TEST_EMAIL_OUTBOX = outbox;
  try {
    assert.equal(await deliverBoutiquePurchaseEmail(order), true);
    let saved = JSON.parse(fs.readFileSync(outbox, "utf8"));
    assert.equal(saved.to, "client@example.test");
    assert.match(saved.subject, /Confirmation de votre commande/);

    assert.equal(await deliverBoutiqueTrackingEmail(order), true);
    saved = JSON.parse(fs.readFileSync(outbox, "utf8"));
    assert.equal(saved.to, "client@example.test");
    assert.match(saved.subject, /a été expédiée/);
  } finally {
    try { fs.unlinkSync(outbox); } catch {}
    if (previousEnv == null) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv;
    if (previousOutbox == null) delete process.env.CARDORIA_TEST_EMAIL_OUTBOX; else process.env.CARDORIA_TEST_EMAIL_OUTBOX = previousOutbox;
  }
});

test("customer email state prevents duplicate automatic notifications", () => {
  const source = fs.readFileSync("backend/lib/boutique/customer-emails.js", "utf8");
  assert.match(source, /state\.status === "sent" && state\.fingerprint === currentFingerprint/);
  assert.match(source, /reason: "already_sent"/);
  assert.match(source, /reason: "already_sending"/);
  assert.match(source, /status: sent \? "sent" : "failed"/);
  assert.match(source, /smtpMissingReason\(\)/);
});

test("paid SumUp Boutique confirmation triggers purchase email without blocking payment", () => {
  const source = fs.readFileSync("backend/lib/payments/sumup.js", "utf8");
  assert.match(source, /status === "paid"/);
  assert.match(source, /sendBoutiquePurchaseEmail\(orderId\)/);
  assert.match(source, /try \{ customerEmail = await sendBoutiquePurchaseEmail\(orderId\); \} catch/);
  assert.match(source, /return \{ checkout, status, transactionId, payment:/);
});

test("shipping update triggers tracking email and exposes manual retry endpoints", () => {
  const routes = fs.readFileSync("backend/routes/payments-admin.js", "utf8");
  assert.match(routes, /current\.status === "Expédiée" && current\.carrier && current\.tracking/);
  assert.match(routes, /await sendBoutiqueTrackingEmail\(current\.id\)/);
  assert.match(routes, /boutique-orders\/:id\/emails\/purchase/);
  assert.match(routes, /boutique-orders\/:id\/emails\/tracking/);
  assert.match(routes, /getBoutiqueEmailConfiguration\(\)/);
});

test("admin shows purchase and tracking email status and retry controls", () => {
  const source = fs.readFileSync("js/admin/admin-orders.js", "utf8");
  const runtime = fs.readFileSync("backend/public/js/admin/admin-orders.js", "utf8");
  assert.match(source, /Confirmation achat/);
  assert.match(source, /Suivi expédition/);
  assert.match(source, /data-mail-purchase/);
  assert.match(source, /data-mail-tracking/);
  assert.match(source, /Mail de suivi envoyé/);
  assert.equal(runtime, source);
});
