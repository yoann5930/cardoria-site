import { Router } from "express";
import { readJson, writeJson } from "../lib/storage.js";

const router = Router();
const MAX_EVENTS = 100;

function clean(value, max = 500) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

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
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[sendcloud] webhook_error", error?.message || error);
    res.status(200).json({ ok: true, stored: false });
  }
});

export default router;
