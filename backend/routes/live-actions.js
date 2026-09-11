import { Router } from "express";
import { assertSellerSession } from "../lib/marketplace/v1/security.js";
import { getLiveSession } from "../lib/live/sessions.js";
import {
  addLiveChatMessage, drawGiveaway, enterGiveaway, getLiveActionState, listLiveChat,
  pinLiveProduct, placeAuctionBid, startAuction, startBreak, startFlashSale, startGiveaway,
  stopAuction, unpinLiveProduct
} from "../lib/live/actions.js";

const router = Router();
function fail(res, error, fallback = 400) { res.status(error?.status || fallback).json({ ok: false, error: error?.message || "Erreur action Live", minimum: error?.minimum }); }
function sellerActor(req) { const seller = assertSellerSession(req); return { id: seller.id, sellerId: seller.id, role: "seller", email: seller.email }; }
function assertSellerOwner(req, liveId) { const actor = sellerActor(req); const live = getLiveSession(liveId); if (!live) throw Object.assign(new Error("Live introuvable."), { status: 404 }); if (live.ownerRole !== "seller" || String(live.ownerId) !== String(actor.sellerId)) throw Object.assign(new Error("Ce Live appartient a un autre vendeur."), { status: 403 }); return actor; }

router.get("/:liveId/state", (req, res) => { try { res.json({ ok: true, state: getLiveActionState(req.params.liveId) }); } catch (e) { fail(res, e); } });
router.get("/:liveId/chat", (req, res) => { try { res.json({ ok: true, messages: listLiveChat(req.params.liveId, req.query.limit) }); } catch (e) { fail(res, e); } });
router.post("/:liveId/chat", (req, res) => { try { res.json({ ok: true, message: addLiveChatMessage(req.params.liveId, req.body || {}) }); } catch (e) { fail(res, e); } });
router.post("/:liveId/bids", (req, res) => { try { res.json({ ok: true, ...placeAuctionBid(req.params.liveId, req.body || {}) }); } catch (e) { fail(res, e); } });
router.post("/:liveId/giveaway/enter", (req, res) => { try { res.json({ ok: true, ...enterGiveaway(req.params.liveId, req.body || {}) }); } catch (e) { fail(res, e); } });

router.post("/seller/:liveId/pin", (req, res) => { try { assertSellerOwner(req, req.params.liveId); res.json({ ok: true, state: pinLiveProduct(req.params.liveId, req.body?.productId) }); } catch (e) { fail(res, e, 401); } });
router.post("/seller/:liveId/unpin", (req, res) => { try { assertSellerOwner(req, req.params.liveId); res.json({ ok: true, state: unpinLiveProduct(req.params.liveId) }); } catch (e) { fail(res, e, 401); } });
router.post("/seller/:liveId/auction/start", (req, res) => { try { assertSellerOwner(req, req.params.liveId); res.json({ ok: true, auction: startAuction(req.params.liveId, req.body || {}) }); } catch (e) { fail(res, e, 401); } });
router.post("/seller/:liveId/auction/stop", (req, res) => { try { assertSellerOwner(req, req.params.liveId); res.json({ ok: true, auction: stopAuction(req.params.liveId) }); } catch (e) { fail(res, e, 401); } });
router.post("/seller/:liveId/flash/start", (req, res) => { try { assertSellerOwner(req, req.params.liveId); res.json({ ok: true, flash: startFlashSale(req.params.liveId, req.body || {}) }); } catch (e) { fail(res, e, 401); } });
router.post("/seller/:liveId/giveaway/start", (req, res) => { try { assertSellerOwner(req, req.params.liveId); res.json({ ok: true, giveaway: startGiveaway(req.params.liveId, req.body || {}) }); } catch (e) { fail(res, e, 401); } });
router.post("/seller/:liveId/giveaway/draw", (req, res) => { try { assertSellerOwner(req, req.params.liveId); res.json({ ok: true, ...drawGiveaway(req.params.liveId) }); } catch (e) { fail(res, e, 401); } });
router.post("/seller/:liveId/break/start", (req, res) => { try { assertSellerOwner(req, req.params.liveId); res.json({ ok: true, break: startBreak(req.params.liveId, req.body || {}) }); } catch (e) { fail(res, e, 401); } });

export default router;
