import { Router } from "express";
import { getColissimoStatus } from "../lib/colissimo.js";

const router = Router();

router.get("/status", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, ...getColissimoStatus() });
});

export default router;
