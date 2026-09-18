import { Router } from "express";
import { readJson, writeJson } from "../lib/storage.js";
import { isSendcloudConfigured, searchMondialRelayServicePoints } from "../lib/sendcloud.js";
import { applySendcloudWebhookToLiveShipment } from "../lib/live/shipments.js";

const router = Router();
const MAX_EVENTS = 100;

function clean(value, max = 500) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

router.get("/status", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, configured: isSendcloudConfigured(), apiVersion: "v3" });
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
  res.status(200).json({ ok: true, service: "sendcloud-webhook", status: "ready" });
});

router.post("/webhook", (req, res) => {
  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const events = readJson("sendcloud-webhooks", []);
    events.unshift({
      receivedAt: new Date().toISOString(),
      action: clean(payload.action || payload.event || payload.type || "unknown", 120),
      parcelId: clean(payload.parcel?.id || payload.id || "", 120),
      trackingNumber: clean(payload.parcel?.tracking_number || payload.tracking_number || "", 160),
      orderNumber: clean(payload.parcel?.order_number || payload.order_number || "", 160),
      payload
    });
    writeJson("sendcloud-webhooks", events.slice(0, MAX_EVENTS));
    try { applySendcloudWebhookToLiveShipment(payload); } catch {}
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[sendcloud] webhook_error", error?.message || error);
    res.status(200).json({ ok: true, stored: false });
  }
});

export default router;
