/** Administration des Lives Cardoria. */
import { Router } from "express";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import {
  createLiveSession,
  getLiveSession,
  grantAdminLiveAccess,
  listLiveCheckouts,
  listLiveSessions,
  publicLiveSession,
  setLiveStatus,
  updateLiveSession
} from "../lib/live/sessions.js";

const WRITE_ADMIN = requireAuth({ roles: ["super_admin", "admin", "employee"], action: "write" });
const router = Router();
router.use(requireAdmin);

function fail(res, error, fallback = 400) {
  return res.status(error?.status || error?.code || fallback).json({
    ok: false,
    error: error?.message || "Erreur Live admin"
  });
}

function actor(req) {
  return req.authUser || { role: "admin", id: "admin" };
}

router.get("/sessions", (req, res) => {
  const ownerRole = String(req.query.ownerRole || "").trim();
  const status = String(req.query.status || "").trim();
  const sessions = listLiveSessions({
    ownerRole: ownerRole || undefined,
    status: status || undefined
  }).map(publicLiveSession);
  res.json({ ok: true, sessions });
});

router.get("/sessions/:id", (req, res) => {
  const session = getLiveSession(req.params.id);
  if (!session) return res.status(404).json({ ok: false, error: "Live introuvable." });
  res.json({
    ok: true,
    session: publicLiveSession(session),
    checkouts: listLiveCheckouts({ liveId: session.id })
  });
});

router.post("/sessions", WRITE_ADMIN, (req, res) => {
  try {
    const body = req.body || {};
    const ownerRole = String(body.ownerRole || "admin").toLowerCase() === "seller" ? "seller" : "admin";
    if (ownerRole === "seller" && !body.ownerId) {
      return res.status(400).json({ ok: false, error: "ownerId vendeur obligatoire." });
    }
    const session = createLiveSession({
      title: body.title,
      ownerRole,
      ownerId: ownerRole === "admin" ? (body.ownerId || "cardoria") : body.ownerId,
      ownerEmail: req.authUser?.email || "",
      products: body.products,
      scheduledAt: body.scheduledAt,
      actor: actor(req)
    });
    logAudit({ type: "live", action: "admin_live_created", user: req.authUser?.email || "admin", detail: `${session.id} ${session.paymentProvider}` });
    res.json({ ok: true, provider: session.paymentProvider, session: publicLiveSession(session) });
  } catch (error) {
    fail(res, error);
  }
});

router.patch("/sessions/:id", WRITE_ADMIN, (req, res) => {
  try {
    const session = updateLiveSession(req.params.id, req.body || {}, actor(req), { adminOverride: true });
    res.json({ ok: true, provider: session.paymentProvider, session: publicLiveSession(session) });
  } catch (error) {
    fail(res, error);
  }
});

router.post("/sessions/:id/enter", (req, res) => {
  try {
    const user = req.authUser;
    if (!user) return res.status(401).json({ ok: false, error: "Authentification requise." });
    const result = grantAdminLiveAccess(req.params.id, user);
    logAudit({
      type: "live",
      action: "admin_live_entered",
      user: user.email || "admin",
      detail: `${result.session.id} ${result.session.title} access=admin/cardoria payment=none`
    });
    res.json({
      ok: true,
      access: {
        role: result.accessRole,
        context: result.accessContext,
        liveId: result.session.id,
        title: result.session.title,
        status: result.session.status,
        ownerRole: result.session.ownerRole,
        paymentProvider: result.session.paymentProvider,
        url: result.url,
        grantToken: result.grantToken,
        grantId: result.grantId,
        expiresAt: result.expiresAt
      },
      session: result.session,
      paymentCreated: false,
      checkoutCreated: false,
      commissionCreated: false
    });
  } catch (error) {
    fail(res, error);
  }
});

router.post("/sessions/:id/start", WRITE_ADMIN, (req, res) => {
  try {
    const session = setLiveStatus(req.params.id, "live", actor(req), { adminOverride: true });
    logAudit({ type: "live", action: "admin_live_started", user: req.authUser?.email || "admin", detail: session.id });
    res.json({ ok: true, provider: session.paymentProvider, session: publicLiveSession(session) });
  } catch (error) {
    fail(res, error);
  }
});

router.post("/sessions/:id/stop", WRITE_ADMIN, (req, res) => {
  try {
    const session = setLiveStatus(req.params.id, "ended", actor(req), { adminOverride: true });
    logAudit({ type: "live", action: "admin_live_stopped", user: req.authUser?.email || "admin", detail: session.id });
    res.json({ ok: true, provider: session.paymentProvider, session: publicLiveSession(session) });
  } catch (error) {
    fail(res, error);
  }
});

router.post("/sessions/:id/cancel", WRITE_ADMIN, (req, res) => {
  try {
    const session = setLiveStatus(req.params.id, "cancelled", actor(req), { adminOverride: true });
    logAudit({ type: "live", action: "admin_live_cancelled", user: req.authUser?.email || "admin", detail: session.id });
    res.json({ ok: true, provider: session.paymentProvider, session: publicLiveSession(session) });
  } catch (error) {
    fail(res, error);
  }
});

router.get("/checkouts", (req, res) => {
  res.json({ ok: true, checkouts: listLiveCheckouts({ liveId: req.query.liveId }) });
});

export default router;
