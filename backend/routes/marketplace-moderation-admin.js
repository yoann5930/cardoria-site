import { Router } from "express";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { moderateListingAdmin } from "../lib/marketplace/v1/listings.js";
import { getDispute, updateDisputeAdmin } from "../lib/marketplace/v1/disputes.js";

const WRITE_ADMIN = requireAuth({ roles: ["super_admin", "admin", "employee"], action: "write" });
const router = Router();
router.use(requireAdmin);

router.put("/listings/:id/moderation", WRITE_ADMIN, (req, res) => {
  try {
    const actor = req.authUser?.email || "admin";
    const listing = moderateListingAdmin(req.params.id, { ...(req.body || {}), actor });
    logAudit({
      type: "marketplace",
      action: "listing_moderation",
      user: actor,
      detail: `${req.params.id} → ${listing.status}${listing.moderationReason ? ` · ${listing.moderationReason}` : ""}`
    });
    res.json({ ok: true, listing });
  } catch (error) {
    res.status(error.status || 400).json({ ok: false, error: error.message });
  }
});

router.get("/disputes/:id/detail", (req, res) => {
  const dispute = getDispute(req.params.id, { includeHistory: true });
  if (!dispute) return res.status(404).json({ ok: false, error: "Litige introuvable" });
  res.json({ ok: true, dispute });
});

router.put("/disputes/:id/manage", WRITE_ADMIN, (req, res) => {
  try {
    const actor = req.authUser?.email || "admin";
    const dispute = updateDisputeAdmin(req.params.id, req.body || {}, actor);
    logAudit({ type: "marketplace", action: "dispute_update", user: actor, detail: `${req.params.id} → ${dispute.status} · ${dispute.priority}` });
    res.json({ ok: true, dispute });
  } catch (error) {
    res.status(error.status || 400).json({ ok: false, error: error.message });
  }
});

export default router;
