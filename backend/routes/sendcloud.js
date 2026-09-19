import { Router } from "express";
import { createHash } from "node:crypto";
import { readJson, writeJson } from "../lib/storage.js";
import { isSendcloudConfigured, searchMondialRelayServicePoints } from "../lib/sendcloud.js";
import { parseSendcloudWebhook } from "../lib/sendcloud-webhook-security.js";
import { applySendcloudWebhookToLiveShipment, liveLabelPurchasesEnabled } from "../lib/live/shipments.js";

const router = Router();
const MAX_EVENTS = 100;
function clean(value, max = 500) { return String(value == null ? "" : value).trim().slice(0, max); }
function signatureSecret() { return process.env.SENDCLOUD_WEBHOOK_SECRET || process.env.SENDCLOUD_SECRET_KEY || ""; }

router.get("/status", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, configured: isSendcloudConfigured(), signatureConfigured: Boolean(signatureSecret()), labelPurchasesEnabled: liveLabelPurchasesEnabled(), providerVerified: false, apiVersion: "v3" });
});

router.get("/service-points", async (req, res) => {
  try {
    const postalCode = clean(req.query.postalCode || req.query.postal_code, 24);
    const city = clean(req.query.city, 120);
    const address = clean(req.query.address, 240);
    if (!postalCode && !city && !address) return res.status(400).json({ ok: false, error: "Code postal, ville ou adresse requis." });
    const result = await searchMondialRelayServicePoints({
      countryCode: clean(req.query.countryCode || req.query.country || "FR", 2),
      postalCode, city, address,
      limit: Math.min(20, Math.max(1, Number(req.query.limit) || 10)),
      radius: Math.min(50000, Math.max(100, Number(req.query.radius) || 10000))
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, carrier: "mondial_relay", ...result });
  } catch (error) {
    res.status(error?.status || 502).json({ ok: false, error: error?.message || "Recherche Point Relais indisponible.", code: error?.code || "" });
  }
});

router.get("/webhook", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, service: "sendcloud-webhook", reachable: true, signatureConfigured: Boolean(signatureSecret()) });
});

function webhookRawBody(req) {
  if (Buffer.isBuffer(req.body) && req.body.length) return req.body;
  throw Object.assign(new Error("Corps Sendcloud brut requis."), { status: 400, code: "SENDCLOUD_RAW_BODY_REQUIRED" });
}
router.post("/webhook", (req, res) => {
  try {
    const rawBody = webhookRawBody(req);
    const payload = parseSendcloudWebhook(rawBody, req.headers["sendcloud-signature"], signatureSecret());
    const action = clean(payload.action, 120);
    if (action !== "parcel_status_changed") return res.status(200).json({ ok: true, ignored: true });
    if (!payload.parcel?.id) return res.status(400).json({ ok: false, code: "SENDCLOUD_PARCEL_REQUIRED", error: "Identifiant colis requis." });
    const eventHash = createHash("sha256").update(rawBody).digest("hex");
    const events = readJson("sendcloud-webhooks", []);
    if (!Array.isArray(events)) throw new Error("Invalid webhook receipt store");
    if (events.some(event => event.eventHash === eventHash)) return res.status(200).json({ ok: true, duplicate: true });
    const shipment = applySendcloudWebhookToLiveShipment(payload);
    if (!shipment) {
      // A callback can beat the synchronous announcement response. Request a retry
      // rather than permanently acknowledging and losing the first status update.
      return res.status(503).json({ ok: false, code: "SHIPMENT_NOT_READY", error: "Expédition non encore rapprochée." });
    }
    events.unshift({ eventHash, receivedAt: new Date().toISOString(), action, parcelId: String(payload.parcel.id), applied: shipment.eventApplied === true });
    writeJson("sendcloud-webhooks", events.slice(0, MAX_EVENTS));
    res.status(200).json({ ok: true, applied: shipment.eventApplied === true });
  } catch (error) {
    const status = Number(error?.status);
    const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
    // Do not log secrets, customer addresses, or complete carrier payloads.
    console.warn("[sendcloud] webhook rejected", error?.code || "PROCESSING_FAILED");
    res.status(safeStatus).json({ ok: false, code: error?.code || "SENDCLOUD_PROCESSING_FAILED", error: safeStatus >= 500 ? "Traitement Sendcloud indisponible." : error.message });
  }
});
export default router;
