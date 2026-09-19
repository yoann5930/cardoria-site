/** Actions temps reel du Studio Live Cardoria (sans dependance Render). */
import crypto from "crypto";
import { readJson, writeJson } from "../storage.js";
import { decrementLiveStock, getLiveSession, listLiveCheckouts } from "./sessions.js";
import { resolveEnergyItems } from "./energy-catalog.js";
import { recordGiveawayAward, giveawayAwardsFromState } from "./giveaway-awards.js";

const STORE_KEY="live-actions.json";let testStore=null;
export const ENERGY_SPOTS=["Plante","Feu","Eau","Électrique","Psy","Combat","Obscurité","Métal","Dragon","Incolore","Dresseur / Supporter","Objet / Stade"];
const clean=(v,max=240)=>String(v==null?"":v).trim().slice(0,max),money=(v)=>Math.round((Number(v)||0)*100)/100,nowIso=()=>new Date().toISOString();
const energyKey=(v)=>clean(v,80).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ");
const ENERGY_BY_KEY=new Map(ENERGY_SPOTS.map(x=>[energyKey(x),x]));
function normalizeEnergyTypes(values){const out=[];for(const raw of Array.isArray(values)?values:[]){const canonical=ENERGY_BY_KEY.get(energyKey(raw));if(canonical&&!out.includes(canonical))out.push(canonical);}return out;}
function emptyStore(){return{states:{}};}
function load(){const d=testStore||readJson(STORE_KEY,emptyStore());if(!d.states||typeof d.states!=="object")d.states={};return d;}
function save(d){
  for(const state of Object.values(d.states||{}))recordGiveawayAward(state);
  if(testStore){Object.assign(testStore,d);return;}writeJson(STORE_KEY,d);
}
function stateFor(liveId,create=false){
  const d=load();let state=d.states[liveId];
  if(!state&&create){state={pinnedProductId:"",auction:null,flash:null,giveaway:null,giveawayAwards:[],break:null,energyTypesByProduct:{},chat:[],updatedAt:nowIso()};d.states[liveId]=state;save(d);}
  if(state&&!state.energyTypesByProduct)state.energyTypesByProduct={};
  // Preserve the current legacy winner BEFORE a new giveaway replaces it.
  if(state)recordGiveawayAward(state);
  return{d,state};
}
function requireSession(liveId){const live=getLiveSession(liveId);if(!live)throw Object.assign(new Error("Live introuvable."),{status:404});return live;}
function requireLive(liveId){const live=requireSession(liveId);if(live.status!=="live")throw Object.assign(new Error("Le Live doit etre demarre."),{status:409});return live;}
function productFor(live,productId){const product=(live.products||[]).find(p=>p.id===String(productId||""));if(!product)throw Object.assign(new Error("Produit Live introuvable."),{status:404});return product;}
function publicEmail(value){const e=clean(value,254).toLowerCase();if(e&&!/^\S+@\S+\.\S+$/.test(e))throw Object.assign(new Error("Adresse email invalide."),{status:400});return e;}
function closeExpired(state){const now=Date.now();if(state?.auction?.status==="running"&&new Date(state.auction.endsAt).getTime()<=now){state.auction.status="ended";state.auction.endedAt=state.auction.endedAt||nowIso();}if(state?.flash?.status==="running"&&new Date(state.flash.endsAt).getTime()<=now){state.flash.status="ended";state.flash.endedAt=state.flash.endedAt||nowIso();}if(state?.giveaway?.status==="running"&&new Date(state.giveaway.endsAt).getTime()<=now)state.giveaway.status="ready_to_draw";}
function refreshBreakProgress(liveId,state){if(!state?.break)return;if(state.break.breakType==="energy_game"){const active=new Set(["planned","creating","pending","paid","completed","authorized","authorised","reconciliation_required"]),used=new Set(listLiveCheckouts({liveId}).filter(c=>c.actionId===state.break.id&&active.has(String(c.status||"").toLowerCase())&&c.spotLabel).map(c=>String(c.spotLabel)));state.break.soldSpots=Math.min(Number(state.break.spots||0),used.size);state.break.remainingSpots=Math.max(0,Number(state.break.spots||0)-state.break.soldSpots);if(state.break.remainingSpots===0&&state.break.status==="running"){state.break.status="sold_out";state.break.endedAt=nowIso();}return;}const live=getLiveSession(liveId),product=(live?.products||[]).find(p=>p.id===state.break.productId);if(!product)return;const start=Number(state.break.stockAtStart??state.break.spots),remainingStock=Math.max(0,Number(product.stock||0)),sold=Math.max(0,Math.min(Number(state.break.spots||0),start-remainingStock));state.break.soldSpots=sold;state.break.remainingSpots=Math.max(0,Number(state.break.spots||0)-sold);if(state.break.remainingSpots===0&&state.break.status==="running"){state.break.status="sold_out";state.break.endedAt=nowIso();}}
export function __setLiveActionsStoreForTests(store){testStore=store||emptyStore();}
export function __resetLiveActionsStoreForTests(){testStore=null;}
export function getLiveActionState(liveId){const{d,state}=stateFor(String(liveId||""),true);closeExpired(state);refreshBreakProgress(liveId,state);state.updatedAt=nowIso();save(d);return structuredClone(state);}
export function getLiveGiveawayAwards(liveId,options={}){requireSession(liveId);const{d,state}=stateFor(String(liveId),true);save(d);return giveawayAwardsFromState(state,options);}
export function setLiveProductEnergyTypes(liveId,productId,energyTypes){const live=requireSession(liveId),product=productFor(live,productId),types=normalizeEnergyTypes(energyTypes);if(!types.length)throw Object.assign(new Error("Sélectionnez au moins une énergie présente dans cet item."),{status:400});const{d,state}=stateFor(live.id,true);state.energyTypesByProduct[product.id]=types;state.updatedAt=nowIso();save(d);return{productId:product.id,energyTypes:[...types]};}
export function pinLiveProduct(liveId,productId){const live=requireLive(liveId);productFor(live,productId);const{d,state}=stateFor(live.id,true);state.pinnedProductId=String(productId);state.updatedAt=nowIso();save(d);return structuredClone(state);}
export function unpinLiveProduct(liveId){requireLive(liveId);const{d,state}=stateFor(liveId,true);state.pinnedProductId="";state.updatedAt=nowIso();save(d);return structuredClone(state);}
export function startAuction(liveId,{productId,startPrice,durationSeconds=30,mode="standard"}={}){const live=requireLive(liveId),product=productFor(live,productId),start=money(startPrice||product.price);if(start<=0)throw Object.assign(new Error("Prix de depart invalide."),{status:400});const duration=Math.max(5,Math.min(3600,Math.trunc(Number(durationSeconds)||30))),auctionMode=String(mode).toLowerCase()==="sudden_death"?"sudden_death":"standard",{d,state}=stateFor(live.id,true);if(state.auction?.status==="running")throw Object.assign(new Error("Une enchere est deja en cours."),{status:409});const started=Date.now();state.pinnedProductId=product.id;state.auction={id:"AUC-"+crypto.randomUUID(),productId:product.id,productName:product.name,status:"running",mode:auctionMode,startPrice:start,currentPrice:start,highestBidder:null,bids:[],startedAt:new Date(started).toISOString(),endsAt:new Date(started+duration*1000).toISOString(),durationSeconds:duration};state.updatedAt=nowIso();save(d);return structuredClone(state.auction);}
export function placeAuctionBid(liveId,{amount,bidderName,bidderEmail}={}){requireLive(liveId);const{d,state}=stateFor(liveId,true);closeExpired(state);const a=state.auction;if(!a||a.status!=="running")throw Object.assign(new Error("Aucune enchere active."),{status:409});const bid=money(amount),minimum=a.bids.length?money(a.currentPrice+0.5):a.startPrice;if(bid<minimum)throw Object.assign(new Error(`Enchere minimale : ${minimum.toFixed(2)} EUR.`),{status:409,minimum});const name=clean(bidderName,80)||"Acheteur",email=publicEmail(bidderEmail),entry={id:"BID-"+crypto.randomUUID(),amount:bid,bidderName:name,bidderEmail:email,createdAt:nowIso()};a.bids.push(entry);a.currentPrice=bid;a.highestBidder={name,email};if(a.mode==="standard"){const remaining=new Date(a.endsAt).getTime()-Date.now();if(remaining<=10_000)a.endsAt=new Date(Date.now()+10_000).toISOString();}state.updatedAt=nowIso();save(d);return{auction:structuredClone(a),bid:entry};}
export function stopAuction(liveId){requireLive(liveId);const{d,state}=stateFor(liveId,true);if(!state.auction)throw Object.assign(new Error("Aucune enchere."),{status:404});closeExpired(state);if(state.auction.status==="running")state.auction.status="ended";state.auction.endedAt=state.auction.endedAt||nowIso();state.updatedAt=nowIso();save(d);return structuredClone(state.auction);}
export function startFlashSale(liveId,{productId,price,durationSeconds=60}={}){const live=requireLive(liveId),product=productFor(live,productId),flashPrice=money(price||product.price);if(flashPrice<=0)throw Object.assign(new Error("Prix flash invalide."),{status:400});const duration=Math.max(5,Math.min(3600,Math.trunc(Number(durationSeconds)||60))),started=Date.now(),{d,state}=stateFor(live.id,true);state.pinnedProductId=product.id;state.flash={id:"FLASH-"+crypto.randomUUID(),productId:product.id,productName:product.name,price:flashPrice,status:"running",startedAt:new Date(started).toISOString(),endsAt:new Date(started+duration*1000).toISOString()};state.updatedAt=nowIso();save(d);return structuredClone(state.flash);}
export function startGiveaway(liveId,{productId,durationSeconds=60,eligibility="public"}={}){
  const live=requireLive(liveId),product=productFor(live,productId);
  if(Number(product.stock||0)<1)throw Object.assign(new Error("Stock giveaway insuffisant."),{status:409});
  const duration=Math.max(5,Math.min(3600,Math.trunc(Number(durationSeconds)||60))),started=Date.now(),{d,state}=stateFor(live.id,true);
  state.pinnedProductId=product.id;
  const audience=String(eligibility||"public").toLowerCase()==="subscriber"?"subscriber":"public";
  state.giveaway={id:"GIV-"+crypto.randomUUID(),productId:product.id,productName:product.name,shippingWeightGrams:Number(product.shippingWeightGrams)||null,status:"running",eligibility:audience,entries:[],winner:null,stockConsumed:false,shippingCustomerAmount:0,shippingPayer:"streamer",shippingPolicy:"free_for_winner_bundle_if_purchase",startedAt:new Date(started).toISOString(),endsAt:new Date(started+duration*1000).toISOString()};
  state.updatedAt=nowIso();save(d);return structuredClone(state.giveaway);
}
function paidBuyerEmails(liveId){return new Set(listLiveCheckouts({liveId}).filter(c=>["paid","completed"].includes(String(c.status||"").toLowerCase())).map(c=>publicEmail(c.customerEmail||"")).filter(Boolean));}
export function startBuyerGiveaway(liveId,{productId,durationSeconds=60}={}){
  const live=requireLive(liveId),product=productFor(live,productId);
  if(Number(product.stock||0)<1)throw Object.assign(new Error("Stock giveaway insuffisant."),{status:409});
  const seen=new Set(),entries=[];
  for(const checkout of listLiveCheckouts({liveId:live.id})){
    if(!["paid","completed"].includes(String(checkout.status||"").toLowerCase()))continue;
    const email=publicEmail(checkout.customerEmail||"");
    if(!email||seen.has(email))continue;
    seen.add(email);
    entries.push({id:"ENT-"+crypto.randomUUID(),name:clean(checkout.customerName||checkout.pseudo||"Acheteur",80)||"Acheteur",email,source:"paid_checkout",createdAt:nowIso()});
  }
  if(!entries.length)throw Object.assign(new Error("Aucun acheteur payé n’est éligible à ce Giveaway Acheteur."),{status:409});
  const duration=Math.max(5,Math.min(3600,Math.trunc(Number(durationSeconds)||60))),started=Date.now(),{d,state}=stateFor(live.id,true);
  state.pinnedProductId=product.id;
  state.giveaway={id:"GIV-"+crypto.randomUUID(),productId:product.id,productName:product.name,shippingWeightGrams:Number(product.shippingWeightGrams)||null,status:"running",eligibility:"buyer",entries,winner:null,stockConsumed:false,shippingCustomerAmount:0,shippingPayer:"streamer",shippingPolicy:"free_for_winner_bundle_if_purchase",startedAt:new Date(started).toISOString(),endsAt:new Date(started+duration*1000).toISOString()};
  state.updatedAt=nowIso();save(d);return structuredClone(state.giveaway);
}
export function enterGiveaway(liveId,{name,email}={}){
  requireLive(liveId);const{d,state}=stateFor(liveId,true),g=state.giveaway;closeExpired(state);
  if(!g||g.status!=="running")throw Object.assign(new Error("Giveaway ferme."),{status:409});
  const e=publicEmail(email),n=clean(name,80)||"Participant";
  if(g.eligibility==="buyer"&&(!e||!paidBuyerEmails(liveId).has(e)))throw Object.assign(new Error("Un achat payé dans ce Live est requis pour participer."),{status:403,code:"LIVE_BUYER_PURCHASE_REQUIRED"});
  if(e&&g.entries.some(x=>x.email===e))return{duplicate:true,entry:g.entries.find(x=>x.email===e),giveaway:structuredClone(g)};
  const entry={id:"ENT-"+crypto.randomUUID(),name:n,email:e,createdAt:nowIso()};g.entries.push(entry);state.updatedAt=nowIso();save(d);return{entry,giveaway:structuredClone(g)};
}
export function drawGiveaway(liveId){
  requireLive(liveId);const{d,state}=stateFor(liveId,true),g=state.giveaway;
  if(!g)throw Object.assign(new Error("Aucun giveaway."),{status:404});
  if(g.winner){save(d);return{duplicate:true,giveaway:structuredClone(g)};}
  if(g.eligibility==="buyer"){
    const eligible=paidBuyerEmails(liveId);
    g.entries=g.entries.filter(entry=>eligible.has(entry.email));
    save(d);
  }
  if(!g.entries.length)throw Object.assign(new Error("Aucun participant éligible."),{status:409});
  const index=crypto.randomInt(g.entries.length);g.winner=g.entries[index];g.status="ended";g.endedAt=nowIso();
  if(!g.stockConsumed){decrementLiveStock(liveId,g.productId,1);g.stockConsumed=true;}
  state.updatedAt=nowIso();save(d);return{giveaway:structuredClone(g)};
}

export async function startEnergyGame(liveId,{gamesCount=1,energyGames=[],pricePerSpot}={}){const live=requireLive(liveId),count=Math.max(1,Math.min(100,Math.trunc(Number(gamesCount)||1))),price=money(pricePerSpot);if(price<=0)throw Object.assign(new Error("Prix du spot invalide."),{status:400});if(!Array.isArray(energyGames)||energyGames.length<count)throw Object.assign(new Error("Configure chaque jeu avant de démarrer."),{status:400});const allowed=new Set(["box_break","sealed","unit","other"]),games=[],labels=[];for(let i=0;i<count;i++){const raw=energyGames[i]||{},type=allowed.has(String(raw.type||"").toLowerCase())?String(raw.type).toLowerCase():"other",items=(Array.isArray(raw.items)?raw.items:String(raw.items||"").split(/[+,;\n]/)).map(x=>clean(x,120)).filter(Boolean).slice(0,12);if(!items.length)throw Object.assign(new Error(`Jeu ${i+1} : indique au moins un item / une extension Pokémon.`),{status:400});const resolved=await resolveEnergyItems(items);if(!resolved.spots.length)throw Object.assign(new Error(`Jeu ${i+1} : aucune énergie exploitable trouvée.`),{status:409});const game={number:i+1,type,format:type==="box_break"||type==="sealed"?(String(raw.format||"display").toLowerCase()==="case"?"case":"display"):"",units:type==="unit"?Math.max(1,Math.min(1000,Math.trunc(Number(raw.units)||1))):0,detail:type==="other"?clean(raw.detail,120):"",items:resolved.items,spots:[...resolved.spots]};games.push(game);for(const spot of resolved.spots)labels.push(`Jeu ${i+1} — ${spot}`);}const{d,state}=stateFor(live.id,true),id="BRK-"+crypto.randomUUID();state.pinnedProductId="";state.break={id,productId:"ENERGY-"+id,productName:"Jeu de l’énergie",status:"running",breakType:"energy_game",label:"Jeu de l’énergie",virtualProduct:true,shippingWeightGrams:20,gamesCount:count,energyGames:games,spots:labels.length,spotLabels:labels,energySourceProductIds:[],energySourceNames:[],pricePerSpot:price,stockAtStart:labels.length,soldSpots:0,remainingSpots:labels.length,startedAt:nowIso()};state.updatedAt=nowIso();save(d);return structuredClone(state.break);}
export function startBreak(liveId,{productId,spots=1,pricePerSpot,breakType="break",spotLabels,energySourceProductIds}={}){const live=requireLive(liveId),product=productFor(live,productId),type=["break","box_break","energy_game"].includes(String(breakType||"").toLowerCase())?String(breakType).toLowerCase():"break",{d,state}=stateFor(live.id,true);let sourceIds=[product.id];if(type==="energy_game"&&Array.isArray(energySourceProductIds)&&energySourceProductIds.length){sourceIds=[...new Set(energySourceProductIds.map(x=>clean(x,120)).filter(Boolean))].slice(0,2);sourceIds.forEach(id=>productFor(live,id));}let configured=[];if(type==="energy_game"){for(const id of sourceIds){const values=normalizeEnergyTypes(state.energyTypesByProduct?.[id]);if(!values.length)throw Object.assign(new Error("Toutes les énergies des items sélectionnés doivent être configurées avant de lancer le jeu."),{status:409,productId:id});for(const value of values)if(!configured.includes(value))configured.push(value);}}else configured=normalizeEnergyTypes(state.energyTypesByProduct?.[product.id]);const labels=type==="energy_game"?configured:(Array.isArray(spotLabels)?spotLabels.map(x=>clean(x,80)).filter(Boolean).slice(0,1000):[]);if(type==="energy_game"&&!labels.length)throw Object.assign(new Error("Aucune énergie n'est configurée pour cette composition."),{status:409});const requested=type==="energy_game"?labels.length:spots,count=Math.max(1,Math.min(1000,Math.trunc(Number(requested)||product.qty||1))),price=money(pricePerSpot||product.price);if(price<=0)throw Object.assign(new Error("Prix du spot invalide."),{status:400});if(labels.length&&labels.length!==count)throw Object.assign(new Error("Le nombre de noms de spots doit correspondre au nombre de spots."),{status:400});if(type!=="energy_game"&&Number(product.stock||0)<count)throw Object.assign(new Error(`Stock insuffisant : ${count} spots sont nécessaires pour ce break.`),{status:409});if(type==="energy_game"&&Number(product.stock||0)<1)throw Object.assign(new Error("Stock insuffisant pour lancer ce jeu de l’énergie."),{status:409});const sourceNames=sourceIds.map(id=>productFor(live,id).name);state.pinnedProductId=product.id;state.break={id:"BRK-"+crypto.randomUUID(),productId:product.id,productName:product.name,status:"running",breakType:type,label:type==="box_break"?"Box Break":type==="energy_game"?"Jeu de l’énergie":"Break",spots:count,spotLabels:labels,energySourceProductIds:type==="energy_game"?sourceIds:[],energySourceNames:type==="energy_game"?sourceNames:[],pricePerSpot:price,stockAtStart:Number(product.stock||0),soldSpots:0,remainingSpots:count,startedAt:nowIso()};state.updatedAt=nowIso();save(d);return structuredClone(state.break);}
export function addLiveChatMessage(liveId,{name,message}={}){requireLive(liveId);const text=clean(message,500);if(!text)throw Object.assign(new Error("Message vide."),{status:400});const{d,state}=stateFor(liveId,true),entry={id:"MSG-"+crypto.randomUUID(),name:clean(name,80)||"Spectateur",message:text,createdAt:nowIso()};state.chat.push(entry);state.chat=state.chat.slice(-200);state.updatedAt=nowIso();save(d);return entry;}
export function listLiveChat(liveId,limit=50){requireLive(liveId);const{state}=stateFor(liveId,true);return structuredClone((state.chat||[]).slice(-Math.max(1,Math.min(200,Number(limit)||50))));}
