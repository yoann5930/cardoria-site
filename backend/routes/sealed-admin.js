import { Router } from "express";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import {
  SEALED_PACKAGING_TYPES,
  listSealedProducts,
  createSealedProduct,
  updateSealedProduct,
  deleteSealedProduct,
  getSealedCatalogStatus,
  syncCardmarketSealedCatalog
} from "../lib/engine/sealed-products.js";
import { logAudit } from "../lib/audit.js";

const router = Router();
const WRITE_ADMIN = requireAuth({ roles: ["super_admin", "admin", "employee"], action: "write" });
const DELETE_ADMIN = requireAuth({ roles: ["super_admin", "admin"], action: "delete" });
router.use(requireAdmin);

router.get("/", (req, res) => {
  const references = listSealedProducts({ q: req.query.q || "", packaging: req.query.packaging || "", limit: req.query.limit || 10000 });
  res.json({ ok: true, references, packagingTypes: SEALED_PACKAGING_TYPES, status: getSealedCatalogStatus() });
});

router.get("/status", (req, res) => res.json({ ok: true, ...getSealedCatalogStatus() }));

router.post("/sync", WRITE_ADMIN, async (req, res) => {
  try {
    const result = await syncCardmarketSealedCatalog({ force: Boolean(req.body?.force) });
    logAudit({ type: "engine", action: "sealed_catalog_sync", user: req.authUser?.email || "admin", detail: `${result.products || result.active || 0} scelles · ${result.priced || 0} prix` });
    res.json({ ok: true, ...result, status: getSealedCatalogStatus() });
  } catch (error) {
    res.status(502).json({ ok: false, error: error?.message || "Synchronisation des scelles impossible." });
  }
});

router.post("/", WRITE_ADMIN, (req, res) => {
  try {
    const reference = createSealedProduct(req.body || {});
    logAudit({ type: "engine", action: "sealed_create", user: req.authUser?.email || "admin", detail: reference.id });
    res.status(201).json({ ok: true, reference });
  } catch (error) {
    res.status(error.status || 400).json({ ok: false, error: error.message });
  }
});

router.put("/:id", WRITE_ADMIN, (req, res) => {
  try {
    const reference = updateSealedProduct(req.params.id, req.body || {});
    if (!reference) return res.status(404).json({ ok: false, error: "Reference scellee introuvable." });
    logAudit({ type: "engine", action: "sealed_update", user: req.authUser?.email || "admin", detail: reference.id });
    res.json({ ok: true, reference });
  } catch (error) {
    res.status(error.status || 400).json({ ok: false, error: error.message });
  }
});

router.delete("/:id", DELETE_ADMIN, (req, res) => {
  if (!deleteSealedProduct(req.params.id)) return res.status(404).json({ ok: false, error: "Reference scellee introuvable." });
  logAudit({ type: "engine", action: "sealed_delete", user: req.authUser?.email || "admin", detail: req.params.id });
  res.json({ ok: true, deletedId: req.params.id });
});

export default router;
