import { Router } from "express";
import { ADMIN_ROLES } from "../lib/auth.js";
import { validateSession } from "../lib/auth/session.js";
import { getLiveSession, listLiveCheckouts, publicLiveSession, resolveAdminLiveAccess, setLiveStatus } from "../lib/live/sessions.js";
import { drawGiveaway, getLiveActionState, pinLiveProduct, startAuction, startBreak, startFlashSale, startGiveaway, stopAuction, unpinLiveProduct } from "../lib/live/actions.js";

const router = Router();
function token(req){return String(req.headers.authorization||"").replace(/^Bearer\s+/i,"")||String(req.headers["x-session-token"]||"");}
function actorFor(req, liveId){
  const live=getLiveSession(liveId); if(!live) throw Object.assign(new Error("Live introuvable."),{status:404});
  const user=validateSession(token(req));
  if(user&&ADMIN_ROLES.includes(user.role)) return {actor:user,live};
  const access=resolveAdminLiveAccess({liveId,grantToken:String(req.headers["x-live-admin-grant"]||""),actor:null});
  if(!access||access.accessRole!=="admin"||access.accessContext!=="cardoria") throw Object.assign(new Error("Accès admin Live refusé."),{status:401});
  return {actor:{role:"admin",id:"cardoria-live-grant",email:""},live};
}
function fail(res,error){const raw=Number(error?.status||error?.code),status=Number.isInteger(raw)&&raw>=400&&raw<=599?raw:400;res.status(status).json({ok:false,error:error?.message||"Erreur Studio Live admin"});}
function snapshot(liveId){const live=getLiveSession(liveId);return{session:publicLiveSession(live),checkouts:listLiveCheckouts({liveId}),actions:getLiveActionState(liveId)};}
router.get("/:liveId",(req,res)=>{try{actorFor(req,req.params.liveId);res.json({ok:true,...snapshot(req.params.liveId)});}catch(error){fail(res,error);}});
router.post("/:liveId/start",(req,res)=>{try{const {actor}=actorFor(req,req.params.liveId);const session=setLiveStatus(req.params.liveId,"live",actor,{adminOverride:true});res.json({ok:true,session:publicLiveSession(session)});}catch(error){fail(res,error);}});
router.post("/:liveId/stop",(req,res)=>{try{const {actor}=actorFor(req,req.params.liveId);const session=setLiveStatus(req.params.liveId,"ended",actor,{adminOverride:true});res.json({ok:true,session:publicLiveSession(session)});}catch(error){fail(res,error);}});
router.post("/:liveId/actions/pin",(req,res)=>{try{actorFor(req,req.params.liveId);res.json({ok:true,state:pinLiveProduct(req.params.liveId,req.body?.productId)});}catch(error){fail(res,error);}});
router.post("/:liveId/actions/unpin",(req,res)=>{try{actorFor(req,req.params.liveId);res.json({ok:true,state:unpinLiveProduct(req.params.liveId)});}catch(error){fail(res,error);}});
router.post("/:liveId/actions/auction/start",(req,res)=>{try{actorFor(req,req.params.liveId);res.json({ok:true,auction:startAuction(req.params.liveId,req.body||{})});}catch(error){fail(res,error);}});
router.post("/:liveId/actions/auction/stop",(req,res)=>{try{actorFor(req,req.params.liveId);res.json({ok:true,auction:stopAuction(req.params.liveId)});}catch(error){fail(res,error);}});
router.post("/:liveId/actions/flash/start",(req,res)=>{try{actorFor(req,req.params.liveId);res.json({ok:true,flash:startFlashSale(req.params.liveId,req.body||{})});}catch(error){fail(res,error);}});
router.post("/:liveId/actions/giveaway/start",(req,res)=>{try{actorFor(req,req.params.liveId);res.json({ok:true,giveaway:startGiveaway(req.params.liveId,req.body||{})});}catch(error){fail(res,error);}});
router.post("/:liveId/actions/giveaway/draw",(req,res)=>{try{actorFor(req,req.params.liveId);res.json({ok:true,...drawGiveaway(req.params.liveId)});}catch(error){fail(res,error);}});
router.post("/:liveId/actions/break/start",(req,res)=>{try{actorFor(req,req.params.liveId);res.json({ok:true,break:startBreak(req.params.liveId,req.body||{})});}catch(error){fail(res,error);}});
export default router;
