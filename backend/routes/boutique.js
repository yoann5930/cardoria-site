import { Router } from "express";
import { listBoutiqueProducts } from "../lib/boutique/catalog.js";

const router = Router();

router.get("/products", (req, res) => {
  const products = listBoutiqueProducts({ includeDisabled: false });
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, products });
});

export default router;
