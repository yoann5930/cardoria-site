import { createHmac, timingSafeEqual } from "node:crypto";

// Sendcloud API v3: HMAC-SHA256, hexadecimal Sendcloud-Signature header.
// Do not JSON.stringify(req.body): whitespace changes the signed bytes.
export function verifySendcloudSignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || !rawBody.length || typeof secret !== "string" || !secret) return false;
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function parseSendcloudWebhook(rawBody, signature, secret) {
  if (!secret) throw Object.assign(new Error("Clé de signature Sendcloud non configurée."), { status: 503, code: "SENDCLOUD_SIGNATURE_NOT_CONFIGURED" });
  if (!verifySendcloudSignature(rawBody, signature, secret)) throw Object.assign(new Error("Signature Sendcloud invalide."), { status: 401, code: "SENDCLOUD_SIGNATURE_INVALID" });
  let payload;
  try { payload = JSON.parse(rawBody.toString("utf8")); }
  catch { throw Object.assign(new Error("JSON Sendcloud invalide."), { status: 400, code: "SENDCLOUD_PAYLOAD_INVALID" }); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw Object.assign(new Error("Événement Sendcloud invalide."), { status: 400, code: "SENDCLOUD_PAYLOAD_INVALID" });
  return payload;
}
