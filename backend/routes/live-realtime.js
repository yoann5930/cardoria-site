import { Router } from "express";
import { ADMIN_ROLES } from "../lib/auth.js";
import { validateSession } from "../lib/auth/session.js";
import { assertSellerSession } from "../lib/marketplace/v1/security.js";
import { getLiveSession } from "../lib/live/sessions.js";
import { isCloudflareRealtimeConfigured } from "../lib/live/cloudflare-realtime.js";
import { answerRealtimeViewer, heartbeatRealtimeViewer, realtimeStatus, realtimeStatusForLive, startRealtimePublisher, startRealtimeViewer, stopRealtimePublisher, stopRealtimeViewer, createPublisherPair, claimPublisherPair } from "../lib/live/realtime-sessions.js";

const router=Router();
function token(req){return String(req.headers.authorization||"").replace(/^Bearer\s+/i,"")||String(req.headers["x-session-token"]||"");}
function publisherActor(req,liveId){const live=getLiveSession(liveId);if(!live)throw Object.assign(new Error("Live introuvable."),{status:404});const user=validateSession(token(req));if(user&&ADMIN_ROLES.includes(user.role))return user;const seller=assertSellerSession(req);return{role:"seller",id:seller.id,sellerId:seller.id,email:seller.email};}
function fail(res,error){const raw=Number(error?.status||error?.code),status=Number.isInteger(raw)&&raw>=400&&raw<=599?raw:400;res.status(status).json({ok:false,error:error?.message||"Erreur Live WebRTC",code:error?.code||"LIVE_WEBRTC_ERROR"});}
router.get("/status",(req,res)=>res.json({ok:true,provider:"cloudflare-realtime",configured:isCloudflareRealtimeConfigured(),...realtimeStatus()}));
router.get("/status/:liveId",(req,res)=>{const live=getLiveSession(req.params.liveId);if(!live)return res.status(404).json({ok:false,error:"Live introuvable."});res.json({ok:true,provider:"cloudflare-realtime",configured:isCloudflareRealtimeConfigured(),...realtimeStatusForLive(req.params.liveId)});});
router.post("/publisher/pair",(req,res)=>{try{const liveId=String(req.body?.liveSessionId||req.body?.liveId||""),actor=publisherActor(req,liveId),pair=createPublisherPair({liveId,actor,sourceId:req.body?.sourceId||"secondary"});res.json({ok:true,...pair,url:`/live-camera.html#pair=${encodeURIComponent(pair.token)}`});}catch(error){fail(res,error);}});
router.post("/publisher/start",async(req,res)=>{try{const body=req.body||{};let liveId=String(body.liveSessionId||body.liveId||""),sourceId=String(body.sourceId||"primary"),actor;if(body.pairToken){const pair=claimPublisherPair(String(body.pairToken));liveId=pair.liveId;sourceId=pair.sourceId;actor=pair.actor;}else actor=publisherActor(req,liveId);const offer=body.offer,tracks=Array.isArray(body.tracks)?body.tracks:[];if(!liveId||offer?.type!=="offer"||!offer.sdp||!tracks.length)return res.status(400).json({ok:false,error:"Offre WebRTC ou pistes invalides."});res.json({ok:true,...(await startRealtimePublisher({liveId,actor,offer,tracks,sourceId}))});}catch(error){fail(res,error);}});
router.post("/publisher/stop",(req,res)=>{try{const liveId=String(req.body?.liveSessionId||req.body?.liveId||""),actor=publisherActor(req,liveId);res.json(stopRealtimePublisher({liveId,actor,sourceId:req.body?.sourceId}));}catch(error){fail(res,error);}});
router.post("/viewer/start",async(req,res)=>{try{const liveId=String(req.body?.liveSessionId||req.body?.liveId||"");res.json({ok:true,...(await startRealtimeViewer(liveId))});}catch(error){fail(res,error);}});
router.post("/viewer/answer",async(req,res)=>{try{const{viewerId,answer}=req.body||{};if(!viewerId||answer?.type!=="answer"||!answer.sdp)return res.status(400).json({ok:false,error:"Réponse WebRTC invalide."});res.json(await answerRealtimeViewer({viewerId:String(viewerId),answer}));}catch(error){fail(res,error);}});
router.post("/viewer/heartbeat",(req,res)=>res.json(heartbeatRealtimeViewer(String(req.body?.viewerId||""))));
router.post("/viewer/stop",(req,res)=>res.json(stopRealtimeViewer(String(req.body?.viewerId||""))));
export default router;
