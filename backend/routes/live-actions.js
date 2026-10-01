import { Router } from "express";
import { assertSellerSession } from "../lib/marketplace/v1/security.js";
import { validateSession } from "../lib/auth/session.js";
import { followSeller, isFollowingSeller } from "../lib/live/follows.js";
import { getLiveSession, listLiveCheckouts } from "../lib/live/sessions.js";
import { resolveEnergyItems, searchEnergyCatalog } from "../lib/live/energy-catalog.js";
import { classifySealedPackaging, inferSealedUnits, listSealedProducts } from "../lib/engine/sealed-products.js";
import { addLiveChatMessage, drawGiveaway, enterGiveaway, getLiveActionState, listLiveChat, pinLiveProduct, placeAuctionBid, prepareLiveGame, launchPreparedGame, setLiveProductEnergyTypes, startAuction, startBreak, startEnergyGame, startFlashSale, startGiveaway, startBuyerGiveaway, startNextBoosterAuction, stopAuction, unpinLiveProduct } from "../lib/live/actions.js";

const router=Router(),rateBuckets=new Map();
function fail(res,error,fallback=400){res.status(error?.status||fallback).json({ok:false,error:error?.message||"Erreur action Live",code:error?.code||"",minimum:error?.minimum});}
function sellerActor(req){const seller=assertSellerSession(req);return{id:seller.id,sellerId:seller.id,role:"seller",email:seller.email};}
function clientActor(req){
  const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"")||String(req.headers["x-session-token"]||"");
  const user=validateSession(token);
  if(!user||user.role!=="client")throw Object.assign(new Error("Connexion client requise."),{status:401,code:"CLIENT_LOGIN_REQUIRED"});
  return user;
}
function liveSeller(liveId){const live=assertPublicLive(liveId);if(live.ownerRole!=="seller"||!live.ownerId)throw Object.assign(new Error("Ce Live n'appartient pas à un vendeur."),{status:409,code:"LIVE_SELLER_REQUIRED"});return live;}
function assertSellerOwner(req,liveId){const actor=sellerActor(req),live=getLiveSession(liveId);if(!live)throw Object.assign(new Error("Live introuvable."),{status:404});if(live.ownerRole!=="seller"||String(live.ownerId)!==String(actor.sellerId))throw Object.assign(new Error("Ce Live appartient a un autre vendeur."),{status:403});return actor;}
function assertPublicLive(liveId){const live=getLiveSession(liveId);if(!live||live.status!=="live")throw Object.assign(new Error("Live introuvable."),{status:404});return live;}
function publicState(state){
  const copy=structuredClone(state||{});
  // This is a private fulfillment ledger, not public spectator data.
  delete copy.giveawayAwards;
  if(copy.auction){copy.auction.bids=(copy.auction.bids||[]).map(({bidderEmail,...bid})=>bid);if(copy.auction.highestBidder)delete copy.auction.highestBidder.email;}
  if(copy.giveaway){copy.giveaway.entries=(copy.giveaway.entries||[]).map(({email,...entry})=>entry);if(copy.giveaway.winner)delete copy.giveaway.winner.email;}
  if(copy.break&&Array.isArray(copy.break.completedBoosters)){
    copy.break.completedBoosters=copy.break.completedBoosters.map((item)=>{
      const next={...item,winner:item.winner?{...item.winner}:null};
      if(next.winner)delete next.winner.email;
      return next;
    });
  }
  return copy;
}
function requireBidderEmail(body){const email=String(body?.bidderEmail||"").trim().toLowerCase();if(!/^\S+@\S+\.\S+$/.test(email))throw Object.assign(new Error("Email acheteur obligatoire pour pouvoir payer l'enchere gagnee."),{status:400});return{...body,bidderEmail:email};}
function rateLimit(req,kind,limit,windowMs){const key=[kind,req.params.liveId,String(req.ip||req.socket?.remoteAddress||"unknown")].join(":");const now=Date.now(),entry=rateBuckets.get(key);if(!entry||now-entry.startedAt>=windowMs){rateBuckets.set(key,{startedAt:now,count:1});return;}entry.count++;if(entry.count>limit)throw Object.assign(new Error("Trop de requetes Live. Reessayez dans quelques secondes."),{status:429});if(rateBuckets.size>5000){for(const[k,v]of rateBuckets)if(now-v.startedAt>60_000)rateBuckets.delete(k);}}
router.get("/sealed-units/resolve",(req,res)=>{try{
  const name=String(req.query.name||"").trim().slice(0,240),extension=String(req.query.extension||"").trim().slice(0,180);
  if(!name)return res.status(400).json({ok:false,error:"Nom d’item requis."});
  const packaging=classifySealedPackaging(name,"");
  const inferred=Math.max(1,Number(inferSealedUnits(name,packaging))||1);
  const candidates=listSealedProducts({q:name,limit:20,activeOnly:true});
  const norm=(v)=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const target=norm(name),targetExt=norm(extension);
  const ranked=candidates.map((x)=>{
    const n=norm(x.name),e=norm(x.extension);
    let score=0;if(n===target)score+=100;if(n.includes(target)||target.includes(n))score+=30;if(targetExt&&e===targetExt)score+=40;if(targetExt&&e.includes(targetExt))score+=15;
    return{x,score};
  }).sort((a,b)=>b.score-a.score);
  const best=ranked[0]&&ranked[0].score>0?ranked[0].x:null;
  res.json({ok:true,packaging:best?.packaging||packaging,unitsPerPackage:Math.max(1,Number(best?.unitsPerPackage||inferred)||1),source:best?"catalog":"inferred",reference:best?{id:best.id,name:best.name,extension:best.extension}:null});
}catch(e){fail(res,e,400);}});
router.get("/energy-catalog/search",async(req,res)=>{try{res.json({ok:true,items:await searchEnergyCatalog(req.query.q||"",req.query.limit)});}catch(e){fail(res,e,502);}});
router.get("/energy-catalog/resolve",async(req,res)=>{try{const items=String(req.query.items||"").split(/[+,;\n]/).map(x=>x.trim()).filter(Boolean);res.json({ok:true,...await resolveEnergyItems(items)});}catch(e){fail(res,e,502);}});
router.get("/:liveId/state",(req,res)=>{try{assertPublicLive(req.params.liveId);res.json({ok:true,state:publicState(getLiveActionState(req.params.liveId))});}catch(e){fail(res,e,404);}});
router.get("/seller/:liveId/state",(req,res)=>{try{assertSellerOwner(req,req.params.liveId);res.json({ok:true,state:getLiveActionState(req.params.liveId)});}catch(e){fail(res,e,401);}});
router.get("/:liveId/chat",(req,res)=>{try{assertPublicLive(req.params.liveId);res.json({ok:true,messages:listLiveChat(req.params.liveId,req.query.limit)});}catch(e){fail(res,e,404);}});
router.get("/:liveId/my-wins",(req,res)=>{try{
  assertPublicLive(req.params.liveId);
  const user=clientActor(req),email=String(user.email||"").trim().toLowerCase(),state=getLiveActionState(req.params.liveId);
  const wins=[];
  const add=(item)=>{
    if(!item||String(item.winner?.email||"").trim().toLowerCase()!==email)return;
    if(wins.some((x)=>x.actionId===String(item.auctionId||item.id||"")))return;
    const actionId=String(item.auctionId||item.id||"");
    const checkout=listLiveCheckouts({liveId:req.params.liveId})
      .filter((c)=>String(c.actionId||"")===actionId&&(String(c.customerId||"")===String(user.id)||String(c.customerEmail||"").trim().toLowerCase()===email))
      .sort((a,b)=>String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||"")))[0]||null;
    wins.push({
      actionId,
      productId:String(item.productId||state.break?.productId||""),
      label:String(item.productName||item.saleLabel||(`#${item.boosterNumber||""} Booster ${state.break?.productName||""}`)).trim(),
      spotLabel:String(item.boosterLabel||item.spotLabel||""),
      boosterNumber:Number(item.boosterNumber||0),
      amount:Number(item.amount??item.currentPrice??0),
      checkoutStatus:String(checkout?.status||"unpaid"),
      paymentUrl:String(checkout?.url||"")
    });
  };
  for(const item of state.break?.completedBoosters||[])add(item);
  if(state.auction?.status==="ended"&&state.auction.highestBidder)add({
    auctionId:state.auction.id,productId:state.auction.productId,productName:state.auction.productName,
    boosterNumber:state.auction.boosterNumber,boosterLabel:state.auction.spotLabel,
    winner:state.auction.highestBidder,amount:state.auction.currentPrice
  });
  wins.sort((a,b)=>(a.boosterNumber||9999)-(b.boosterNumber||9999));
  res.json({ok:true,wins});
}catch(e){fail(res,e,401);}});
router.post("/:liveId/chat",(req,res)=>{try{rateLimit(req,"chat",5,10_000);assertPublicLive(req.params.liveId);const user=clientActor(req),name=String(user.name||"").trim();if(!name)throw Object.assign(new Error("Ajoutez un pseudo dans votre compte Cardoria avant d’écrire dans le chat."),{status:409,code:"CLIENT_PSEUDO_REQUIRED"});res.json({ok:true,message:addLiveChatMessage(req.params.liveId,{name,message:req.body?.message})});}catch(e){fail(res,e,401);}});
router.post("/:liveId/bids",(req,res)=>{try{rateLimit(req,"bid",20,10_000);const result=placeAuctionBid(req.params.liveId,requireBidderEmail(req.body||{}));res.json({ok:true,auction:publicState({auction:result.auction}).auction,bid:{id:result.bid.id,amount:result.bid.amount,bidderName:result.bid.bidderName,createdAt:result.bid.createdAt}});}catch(e){fail(res,e);}});
router.get("/:liveId/follow",(req,res)=>{try{const live=liveSeller(req.params.liveId),user=clientActor(req);res.json({ok:true,sellerId:live.ownerId,following:isFollowingSeller({sellerId:live.ownerId,userId:user.id})});}catch(e){fail(res,e,401);}});
router.post("/:liveId/follow",(req,res)=>{try{rateLimit(req,"follow",10,60_000);const live=liveSeller(req.params.liveId),user=clientActor(req),follow=followSeller({sellerId:live.ownerId,userId:user.id,email:user.email,name:user.name});res.json({ok:true,sellerId:live.ownerId,following:true,duplicate:Boolean(follow.duplicate)});}catch(e){fail(res,e,401);}});
router.post("/:liveId/giveaway/enter",(req,res)=>{try{
  rateLimit(req,"giveaway",10,60_000);
  const live=assertPublicLive(req.params.liveId),g=getLiveActionState(req.params.liveId)?.giveaway;
  let payload=req.body||{};
  if(g?.eligibility==="subscriber"||g?.eligibility==="buyer"){
    const user=clientActor(req);
    if(g.eligibility==="subscriber"){
      if(live.ownerRole!=="seller"||!live.ownerId)throw Object.assign(new Error("Giveaway Abonné indisponible sur ce Live."),{status:409,code:"LIVE_SELLER_REQUIRED"});
      if(!isFollowingSeller({sellerId:live.ownerId,userId:user.id}))throw Object.assign(new Error("Suivez le vendeur pour participer à ce Giveaway Abonné."),{status:403,code:"FOLLOW_REQUIRED"});
    }
    // The body cannot impersonate a paying buyer or an existing follower.
    payload={name:user.name||"Participant",email:user.email};
  }
  const result=enterGiveaway(req.params.liveId,payload);
  res.json({ok:true,duplicate:Boolean(result.duplicate),entry:result.entry?{id:result.entry.id,name:result.entry.name,createdAt:result.entry.createdAt}:null,giveaway:publicState({giveaway:result.giveaway}).giveaway});
}catch(e){fail(res,e);}});
router.post("/seller/:liveId/energy-config",(req,res)=>{try{assertSellerOwner(req,req.params.liveId);res.json({ok:true,energyConfig:setLiveProductEnergyTypes(req.params.liveId,req.body?.productId,req.body?.energyTypes)});}catch(e){fail(res,e,401);}});
router.post("/seller/:liveId/pin",(req,res)=>{try{assertSellerOwner(req,req.params.liveId);res.json({ok:true,state:pinLiveProduct(req.params.liveId,req.body?.productId)});}catch(e){fail(res,e,401);}});
router.post("/seller/:liveId/game/prepare",(req,res)=>{try{assertSellerOwner(req,req.params.liveId);res.json({ok:true,preparedGame:prepareLiveGame(req.params.liveId,req.body||{})});}catch(e){fail(res,e,401);}});
router.post("/seller/:liveId/game/launch",async(req,res)=>{try{assertSellerOwner(req,req.params.liveId);res.json({ok:true,...await launchPreparedGame(req.params.liveId)});}catch(e){fail(res,e,401);}});
router.post("/seller/:liveId/unpin",(req,res)=>{try{assertSellerOwner(req,req.params.liveId);res.json({ok:true,state:unpinLiveProduct(req.params.liveId)});}catch(e){fail(res,e,401);}});
router.post("/seller/:liveId/auction/start",(req,res)=>{try{assertSellerOwner(req,req.params.liveId);res.json({ok:true,auction:startAuction(req.params.liveId,req.body||{})});}catch(e){fail(res,e,401);}});
router.post("/seller/:liveId/booster-auction/next",(req,res)=>{try{assertSellerOwner(req,req.params.liveId);res.json({ok:true,auction:startNextBoosterAuction(req.params.liveId,req.body||{})});}catch(e){fail(res,e,401);}});
router.post("/seller/:liveId/auction/stop",(req,res)=>{try{assertSellerOwner(req,req.params.liveId);res.json({ok:true,auction:stopAuction(req.params.liveId)});}catch(e){fail(res,e,401);}});
router.post("/seller/:liveId/flash/start",(req,res)=>{try{assertSellerOwner(req,req.params.liveId);res.json({ok:true,flash:startFlashSale(req.params.liveId,req.body||{})});}catch(e){fail(res,e,401);}});
router.post("/seller/:liveId/giveaway/start",(req,res)=>{try{assertSellerOwner(req,req.params.liveId);const body=req.body||{};const giveaway=body.eligibility==="buyer"?startBuyerGiveaway(req.params.liveId,body):startGiveaway(req.params.liveId,body);res.json({ok:true,giveaway});}catch(e){fail(res,e,401);}});
router.post("/seller/:liveId/giveaway/buyer/start",(req,res)=>{try{assertSellerOwner(req,req.params.liveId);res.json({ok:true,giveaway:startBuyerGiveaway(req.params.liveId,req.body||{})});}catch(e){fail(res,e,401);}});
router.post("/seller/:liveId/giveaway/draw",(req,res)=>{try{assertSellerOwner(req,req.params.liveId);res.json({ok:true,...drawGiveaway(req.params.liveId)});}catch(e){fail(res,e,401);}});
router.post("/seller/:liveId/break/start",async(req,res)=>{try{assertSellerOwner(req,req.params.liveId);const body=req.body||{},result=String(body.breakType||"").toLowerCase()==="energy_game"?await startEnergyGame(req.params.liveId,body):startBreak(req.params.liveId,body);res.json({ok:true,break:result});}catch(e){fail(res,e,401);}});
export default router;
