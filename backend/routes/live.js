/** Routes publiques et vendeur Live Cardoria. */
import { Router } from "express";
import { logAudit } from "../lib/audit.js";
import { ADMIN_ROLES } from "../lib/auth.js";
import { validateSession } from "../lib/auth/session.js";
import { MarketplaceAuthError, assertSellerSession } from "../lib/marketplace/v1/security.js";
import { PAYMENT_MATRIX } from "../lib/payments/routing.js";
import { createLiveCheckout, planLiveCheckout } from "../lib/live/checkout.js";
import liveRealtimeRoutes from "./live-realtime.js";
import liveActionRoutes from "./live-actions.js";
import liveAdminStudioRoutes from "./live-admin-studio.js";
import { isRealtimePublished } from "../lib/live/realtime-sessions.js";
import { createLiveSession, getLiveSession, listLiveCheckouts, listLiveSessions, publicLiveSession, resolveAdminLiveAccess, setLiveStatus, updateLiveSession } from "../lib/live/sessions.js";
import { archiveLiveSession, getLiveArchive, listLiveArchives } from "../lib/live/archive.js";

const router = Router();
router.use("/webrtc", liveRealtimeRoutes);
router.use("/actions", liveActionRoutes);
router.use("/admin-studio", liveAdminStudioRoutes);

function fail(res, error, fallback = 400) {
  return res.status(error?.status || error?.code || fallback).json({ ok: false, error: error?.message || "Erreur Live", provider: error?.provider || error?.expectedProvider, expectedProvider: error?.expectedProvider, requestedProvider: error?.requestedProvider });
}
function sellerActor(req) { const seller = assertSellerSession(req); return { role: "seller", sellerId: seller.id, id: seller.id, email: seller.email, seller }; }
function assertSellerLiveCanStart(actor, liveId) {
  const session = getLiveSession(liveId);
  if (!session) throw Object.assign(new Error("Live introuvable."), { status: 404 });
  if (session.ownerRole !== "seller" || String(session.ownerId) !== String(actor.sellerId)) {
    throw Object.assign(new Error("Ce Live appartient à un autre vendeur."), { status: 403 });
  }
  if (["ended", "cancelled"].includes(String(session.status || "").toLowerCase())) {
    throw Object.assign(new Error("Ce Live est fermé et ne peut pas être redémarré."), { status: 409 });
  }
  return session;
}
function safePublicText(value) { return String(value == null ? "" : value).replace(/[<>]/g, ""); }
function sanitizePublicValue(value) {
  if (typeof value === "string") return safePublicText(value);
  if (Array.isArray(value)) return value.map(sanitizePublicValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizePublicValue(item)]));
  return value;
}
function publicRealtimeSession(session) {
  const live = publicLiveSession(session);
  if (!live) return null;
  return sanitizePublicValue({ ...live, mimeType: "application/x-cloudflare-webrtc", streamPublished: isRealtimePublished(live.id) });
}
function getPublicLiveSession(id) {
  const session = getLiveSession(id);
  return session?.status === "live" ? session : null;
}

router.get("/matrix", (req, res) => res.json({ ok: true, matrix: PAYMENT_MATRIX, retired: ["revolut"] }));
router.get("/sessions", (req, res) => {
  res.json({ ok: true, sessions: listLiveSessions({ status: "live" }).map(publicRealtimeSession) });
});
router.get("/sessions/:id", (req, res) => {
  const session = getPublicLiveSession(req.params.id);
  if (!session) return res.status(404).json({ ok: false, error: "Live introuvable." });
  res.json({ ok: true, session: publicRealtimeSession(session) });
});
router.get("/sessions/:id/admin-access", (req, res) => {
  const session = getLiveSession(req.params.id); if (!session) return res.status(404).json({ ok: false, error: "Live introuvable." });
  const header = String(req.headers.authorization || ""); const sessionToken = header.replace(/^Bearer\s+/i, "") || String(req.headers["x-session-token"] || "");
  const user = validateSession(sessionToken); const actor = user && ADMIN_ROLES.includes(user.role) ? user : null;
  const access = resolveAdminLiveAccess({ liveId: session.id, grantToken: String(req.headers["x-live-admin-grant"] || ""), actor });
  if (!access) return res.status(401).json({ ok: false, error: "Accès admin Live refusé." });
  res.json({ ok: true, accessRole: access.accessRole, accessContext: access.accessContext, title: safePublicText(session.title), ownerRole: session.ownerRole, paymentProvider: session.paymentProvider, session: publicRealtimeSession(session) });
});
router.post("/checkout", async (req, res) => { try { const body = req.body || {}; const checkout = await createLiveCheckout({ liveId: body.liveId, productId: body.productId, qty: body.qty, spotLabel: body.spotLabel, customerEmail: body.customerEmail, customerName: body.customerName, shippingAddress: body.shippingAddress, requestedProvider: body.provider, requestedAmount: body.amount ?? body.total, successUrl: body.successUrl, cancelUrl: body.cancelUrl }); res.json({ ok: true, provider: checkout.provider, channel: checkout.channel, checkout }); } catch (error) { fail(res, error); } });
router.post("/checkout/plan", (req, res) => { try { const body = req.body || {}; const checkout = planLiveCheckout({ liveId: body.liveId, productId: body.productId, qty: body.qty, spotLabel: body.spotLabel, customerEmail: body.customerEmail, customerName: body.customerName, shippingAddress: body.shippingAddress, requestedProvider: body.provider, requestedAmount: body.amount ?? body.total }); res.json({ ok: true, provider: checkout.provider, channel: checkout.channel, checkout }); } catch (error) { fail(res, error); } });
router.get("/seller/sessions", (req, res) => { try { const actor = sellerActor(req); res.json({ ok: true, provider: "paypal", sessions: listLiveSessions({ ownerRole: "seller", ownerId: actor.sellerId }).map(publicLiveSession) }); } catch (error) { fail(res, error, error instanceof MarketplaceAuthError ? error.status : 401); } });
router.post("/seller/sessions", (req, res) => { try { const actor = sellerActor(req); const body = req.body || {}; const session = createLiveSession({ title: body.title, ownerRole: "seller", ownerId: actor.sellerId, ownerEmail: actor.email, products: body.products, scheduledAt: body.scheduledAt, actor }); logAudit({ type: "live", action: "seller_live_created", user: actor.email || actor.sellerId, detail: session.id }); res.json({ ok: true, provider: "paypal", session: publicLiveSession(session) }); } catch (error) { fail(res, error, error instanceof MarketplaceAuthError ? error.status : 400); } });
router.patch("/seller/sessions/:id", (req, res) => { try { const actor = sellerActor(req); const session = updateLiveSession(req.params.id, req.body || {}, actor); res.json({ ok: true, provider: "paypal", session: publicLiveSession(session) }); } catch (error) { fail(res, error, error instanceof MarketplaceAuthError ? error.status : 400); } });
router.post("/seller/sessions/:id/start", (req, res) => { try { const actor = sellerActor(req); assertSellerLiveCanStart(actor, req.params.id); const session = setLiveStatus(req.params.id, "live", actor); logAudit({ type: "live", action: "seller_live_started", user: actor.email || actor.sellerId, detail: session.id }); res.json({ ok: true, provider: "paypal", session: publicLiveSession(session) }); } catch (error) { fail(res, error, error instanceof MarketplaceAuthError ? error.status : 400); } });
router.post("/seller/sessions/:id/stop", (req, res) => { try { const actor = sellerActor(req); const session = setLiveStatus(req.params.id, "ended", actor); const archive=archiveLiveSession(session.id); logAudit({ type: "live", action: "seller_live_stopped", user: actor.email || actor.sellerId, detail: session.id }); res.json({ ok: true, provider: "paypal", session: publicLiveSession(session), archive }); } catch (error) { fail(res, error, error instanceof MarketplaceAuthError ? error.status : 400); } });
router.get("/seller/archives", (req, res) => { try { const actor=sellerActor(req); res.json({ok:true,provider:"paypal",archives:listLiveArchives({ownerId:actor.sellerId,ownerRole:"seller"})}); } catch(error){ fail(res,error,error instanceof MarketplaceAuthError?error.status:401); } });
router.get("/seller/archives/:id", (req,res)=>{ try { const actor=sellerActor(req),archive=getLiveArchive(req.params.id); if(!archive||archive.ownerRole!=="seller"||String(archive.ownerId)!==String(actor.sellerId))return res.status(404).json({ok:false,error:"Archive Live introuvable."}); res.json({ok:true,provider:"paypal",archive}); } catch(error){ fail(res,error,error instanceof MarketplaceAuthError?error.status:401); } });
router.get("/seller/checkouts", (req, res) => { try { const actor = sellerActor(req); res.json({ ok: true, provider: "paypal", checkouts: listLiveCheckouts({ ownerId: actor.sellerId }) }); } catch (error) { fail(res, error, error instanceof MarketplaceAuthError ? error.status : 401); } });
export default router;
