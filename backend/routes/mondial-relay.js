import { Router } from "express";
import {
  mondialRelayPublicStatus,
  searchMondialRelayServicePoints
} from "../lib/mondial-relay.js";

const router = Router();
const clean = (value, max = 200) => String(value == null ? "" : value).trim().slice(0, max);

router.get("/status", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(mondialRelayPublicStatus());
});

router.get("/service-points", async (req, res) => {
  try {
    const postalCode = clean(req.query.postalCode || req.query.postal_code, 10);
    const city = clean(req.query.city, 30);
    const relayId = clean(req.query.relayId || req.query.id, 6);
    if (!postalCode && !city && !relayId) return res.status(400).json({ ok: false, code: "MONDIAL_RELAY_SEARCH_INPUT_REQUIRED", error: "Code postal, ville ou Point Relais requis." });
    const result = await searchMondialRelayServicePoints({
      countryCode: clean(req.query.countryCode || req.query.country || "FR", 2),
      postalCode,
      city,
      relayId,
      weightGrams: clean(req.query.weightGrams, 10),
      radius: Math.min(50000, Math.max(100, Number(req.query.radius) || 15000)),
      limit: Math.min(30, Math.max(1, Number(req.query.limit) || 10))
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, provider: "mondial_relay_direct", carrier: "mondial_relay", ...result });
  } catch (error) {
    const status = Number(error?.status);
    const body = {
      ok: false,
      code: error?.code || "MONDIAL_RELAY_SEARCH_FAILED",
      error: error?.message || "Recherche Point Relais indisponible."
    };
    if (error?.missing) body.missing = error.missing;
    res.status(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502).json(body);
  }
});

export default router;
