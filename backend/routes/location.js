import { Router } from "express";
import { listFrenchCommunesByPostalCode } from "../lib/france-communes.js";

const router = Router();

router.get("/communes", async (req, res) => {
  try {
    const result = await listFrenchCommunesByPostalCode(req.query.postalCode || req.query.postal_code || "");
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.json({ ok: true, ...result });
  } catch (error) {
    const status = Number(error?.status);
    const body = {
      ok: false,
      code: error?.code || "FRENCH_COMMUNES_FAILED",
      error: error?.message || "Recherche des communes indisponible."
    };
    if (error?.providerStatus) body.providerStatus = error.providerStatus;
    res.status(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502).json(body);
  }
});

export default router;
