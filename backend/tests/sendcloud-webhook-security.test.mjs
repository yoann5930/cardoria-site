import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifySendcloudSignature, parseSendcloudWebhook } from "../lib/sendcloud-webhook-security.js";
import { updateShipmentFromSendcloud } from "../lib/sendcloud-tracking.js";

const secret = "unit-test-secret-not-a-real-credential";
const sign = raw => createHmac("sha256", secret).update(raw).digest("hex");
const event = (timestamp = 1000) => ({ action: "parcel_status_changed", timestamp, parcel: { id: 12345, tracking_number: "TEST-TRACKING", status: { id: 1000, message: "Test status" } } });
const shipment = { id: "test-shipment", sendcloudParcelId: "12345", status: "created", trackingNumber: "" };

test("exact signed bytes are accepted; tampered or reserialized bytes are rejected", () => {
  const raw = Buffer.from('{ "action": "integration_connected" }');
  assert.equal(verifySendcloudSignature(raw, sign(raw), secret), true);
  assert.equal(verifySendcloudSignature(Buffer.from('{"action":"integration_connected"}'), sign(raw), secret), false);
  assert.equal(verifySendcloudSignature(raw, sign(raw), "wrong secret"), false);
  assert.deepEqual(parseSendcloudWebhook(raw, sign(raw), secret), { action: "integration_connected" });
});

test("missing, malformed and mismatched signatures fail closed", () => {
  const raw = Buffer.from("{}");
  for (const value of [undefined, "", "abc", "g".repeat(64), "0".repeat(64), [sign(raw)]]) {
    assert.equal(verifySendcloudSignature(raw, value, secret), false);
  }
  assert.equal(verifySendcloudSignature({}, sign(raw), secret), false);
  assert.throws(() => parseSendcloudWebhook(raw, sign(raw), ""), { code: "SENDCLOUD_SIGNATURE_NOT_CONFIGURED", status: 503 });
  assert.throws(() => parseSendcloudWebhook(raw, "0".repeat(64), secret), { status: 401 });
});

test("signed malformed JSON, null and arrays are not accepted as events", () => {
  for (const text of ["{", "null", "[]", '"string"']) {
    const raw = Buffer.from(text);
    assert.throws(() => parseSendcloudWebhook(raw, sign(raw), secret), { status: 400, code: "SENDCLOUD_PAYLOAD_INVALID" });
  }
});

test("new tracking event only updates its own parcel", () => {
  const applied = updateShipmentFromSendcloud(shipment, event(), "2026-01-01T00:00:00Z");
  assert.equal(applied.changed, true);
  assert.equal(applied.shipment.trackingNumber, "TEST-TRACKING");
  assert.equal(applied.shipment.lastSendcloudEventTimestamp, 1000);
  assert.equal(shipment.status, "created");
  assert.equal(updateShipmentFromSendcloud({ ...shipment, sendcloudParcelId: "other" }, event()).changed, false);
});

test("replayed and older signed events do not regress tracking", () => {
  const latest = updateShipmentFromSendcloud(shipment, event(2000)).shipment;
  assert.equal(updateShipmentFromSendcloud(latest, event(1000)).changed, false);
  assert.equal(updateShipmentFromSendcloud(latest, event(2000)).changed, false);
  assert.equal(updateShipmentFromSendcloud(latest, event(2001)).changed, true);
});

test("unrelated actions and invalid status events cannot mutate shipments", () => {
  assert.equal(updateShipmentFromSendcloud(shipment, { ...event(), action: "integration_connected" }).changed, false);
  assert.throws(() => updateShipmentFromSendcloud(shipment, event(0)), { code: "SENDCLOUD_TIMESTAMP_INVALID" });
  assert.throws(() => updateShipmentFromSendcloud(shipment, { ...event(), parcel: { id: 12345 } }), { code: "SENDCLOUD_STATUS_INVALID" });
});

test("real Express route verifies raw bytes and rejects forged updates without external API calls", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cardoria-webhook-test-"));
  const cwd = process.cwd(), oldSecret = process.env.SENDCLOUD_WEBHOOK_SECRET, oldKey = process.env.SENDCLOUD_SECRET_KEY;
  let server;
  process.chdir(directory);
  process.env.SENDCLOUD_WEBHOOK_SECRET = secret;
  delete process.env.SENDCLOUD_SECRET_KEY;
  try {
    const { default: express } = await import("express");
    const { applySecurityMiddleware } = await import("../lib/security/index.js");
    const { default: router } = await import("../routes/sendcloud.js");
    const { writeJson, readJson } = await import("../lib/storage.js");
    const app = express();
    applySecurityMiddleware(app);
    app.use(express.json());
    app.use("/api/sendcloud", router);
    server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}/api/sendcloud`;
    writeJson("live-shipments", [{ ...shipment, groupKey: "test-group" }]);
    writeJson("sendcloud-webhooks", []);
    const raw = Buffer.from(JSON.stringify(event(), null, 2));
    async function post(body, signature) {
      return fetch(base + "/webhook", { method: "POST", headers: { "Content-Type": "application/json", "Sendcloud-Signature": signature }, body });
    }
    const invalid = await post(raw, "0".repeat(64));
    assert.equal(invalid.status, 401);
    assert.equal(readJson("live-shipments", [])[0].status, "created");
    const valid = await post(raw, sign(raw));
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).applied, true);
    assert.equal(readJson("live-shipments", [])[0].lastSendcloudEventTimestamp, 1000);
    const duplicate = await post(raw, sign(raw));
    assert.equal((await duplicate.json()).duplicate, true);
    const receipts = readJson("sendcloud-webhooks", []);
    assert.equal(receipts.length, 1);
    assert.equal("payload" in receipts[0], false);
    assert.equal("trackingNumber" in receipts[0], false);
    const old = Buffer.from(JSON.stringify(event(999)));
    const stale = await post(old, sign(old));
    assert.equal((await stale.json()).applied, false);
    delete process.env.SENDCLOUD_WEBHOOK_SECRET;
    const noConfig = await post(raw, sign(raw));
    assert.equal(noConfig.status, 503);
    const reachable = await fetch(base + "/webhook");
    assert.equal(reachable.status, 200);
    assert.equal((await reachable.json()).signatureConfigured, false);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (oldSecret === undefined) delete process.env.SENDCLOUD_WEBHOOK_SECRET; else process.env.SENDCLOUD_WEBHOOK_SECRET = oldSecret;
    if (oldKey === undefined) delete process.env.SENDCLOUD_SECRET_KEY; else process.env.SENDCLOUD_SECRET_KEY = oldKey;
    process.chdir(cwd);
    await rm(directory, { recursive: true, force: true });
  }
});
