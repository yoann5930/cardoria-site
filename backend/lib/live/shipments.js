import crypto from "crypto";
import { readJson, writeJson } from "../storage.js";
import { getUserByEmail } from "../auth/users.js";
import { getSeller } from "../marketplace/sellers.js";
import { liveShipmentGroupKey } from "../subscriptions/plans.js";
import { getLiveActionState } from "./actions.js";
import { getLiveSession, listLiveCheckouts } from "./sessions.js";
import { productShippingWeight, shippingPackForWeight } from "./shipping.js";
import { createSendcloudShipment, isSendcloudConfigured } from "../sendcloud.js";

const STORE="live-shipments";
const PAID=new Set(["paid","completed","authorized","authorised"]);
const clean=(v,m=240)=>String(v==null?"":v).trim().slice(0,m);
const emailKey=(v)=>clean(v,254).toLowerCase();
const money=(v)=>Math.round((Number(v)||0)*100)/100;

function load(){const rows=readJson(STORE,[]);return Array.isArray(rows)?rows:[];}
function save(rows){writeJson(STORE,rows.slice(-20000));}
function profileAddress(user){
  if(!user?.addressLine1||!user?.postalCode||!user?.city)return null;
  return{
    recipientName:user.name||[user.firstName,user.lastName].filter(Boolean).join(" "),
    addressLine1:user.addressLine1,addressLine2:user.addressLine2||"",
    postalCode:user.postalCode,city:user.city,countryCode:user.country||"FR",phone:user.phone||""
  };
}
function profileRelay(user){
  const r=user?.relay;
  if(!r?.id)return null;
  return{
    id:String(r.id),name:r.name||"",address:r.address||"",postalCode:r.postalCode||"",
    city:r.city||"",countryCode:r.countryCode||"FR",carrierCode:r.carrierCode||"mondial_relay",
    carrierServicePointId:r.carrierServicePointId||""
  };
}
function checkoutRelay(checkout){
  const r=checkout?.servicePoint;
  if(!r?.id)return null;
  return{...r,id:String(r.id)};
}
function giveawayWinner(liveId){
  const state=getLiveActionState(liveId);
  const g=state?.giveaway;
  return g?.winner?.email?{email:emailKey(g.winner.email),name:clean(g.winner.name,120),productId:g.productId||"",giveawayId:g.id||""}:null;
}
function senderForLive(live){
  if(live.ownerRole==="seller"){
    const seller=getSeller(live.ownerId);
    if(!seller?.senderReady)throw Object.assign(new Error("Adresse expéditeur vendeur incomplète."),{status:409,code:"SELLER_SENDER_PROFILE_REQUIRED"});
    return{
      address:{...seller.sender,recipientName:seller.sender.name||seller.displayName},
      email:seller.email||"",
      companyName:seller.displayName||seller.sender.name||""
    };
  }
  const address={
    name:clean(process.env.CARDORIA_SENDER_NAME,120),
    recipientName:clean(process.env.CARDORIA_SENDER_NAME,120),
    addressLine1:clean(process.env.CARDORIA_SENDER_ADDRESS_LINE1,160),
    addressLine2:clean(process.env.CARDORIA_SENDER_ADDRESS_LINE2,160),
    postalCode:clean(process.env.CARDORIA_SENDER_POSTAL_CODE,24),
    city:clean(process.env.CARDORIA_SENDER_CITY,120),
    countryCode:clean(process.env.CARDORIA_SENDER_COUNTRY||"FR",2),
    phone:clean(process.env.CARDORIA_SENDER_PHONE,32)
  };
  if(!address.recipientName||!address.addressLine1||!address.postalCode||!address.city)throw Object.assign(new Error("Adresse expéditeur Cardoria non configurée."),{status:503,code:"CARDORIA_SENDER_NOT_CONFIGURED"});
  return{address,email:clean(process.env.CARDORIA_SENDER_EMAIL,254),companyName:"Cardoria"};
}
function groupData(live,email){
  const checkouts=listLiveCheckouts({liveId:live.id})
    .filter((c)=>emailKey(c.customerEmail)===email&&PAID.has(String(c.status||"").toLowerCase()))
    .sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||"")));
  const winner=giveawayWinner(live.id);
  const isWinner=winner?.email===email;
  if(!checkouts.length&&!isWinner)return null;
  const user=getUserByEmail(email);
  const lastWithAddress=[...checkouts].reverse().find((c)=>c.shippingAddress?.addressLine1);
  const recipient=lastWithAddress?.shippingAddress||profileAddress(user);
  if(!recipient)throw Object.assign(new Error(`Adresse destinataire manquante pour ${email}.`),{status:409,code:"RECIPIENT_ADDRESS_REQUIRED",buyerEmail:email});
  const lastRelay=[...checkouts].reverse().map(checkoutRelay).find(Boolean);
  const relay=lastRelay||profileRelay(user);
  let weight=0;
  for(const c of checkouts){
    const p=(live.products||[]).find((x)=>String(x.id)===String(c.productId));
    weight+=p?productShippingWeight(p,c.qty):Math.max(0,Number(c.shippingUnitWeightGrams)||0)*Math.max(1,Number(c.qty)||1);
  }
  if(isWinner){
    const p=(live.products||[]).find((x)=>String(x.id)===String(winner.productId));
    weight+=productShippingWeight(p,1);
  }
  weight=Math.max(20,Math.ceil(weight||0));
  const pack=shippingPackForWeight(weight);
  const carrierCode=pack?.carrier==="Mondial Relay"?"mondial_relay":"lettresuivie";
  if(carrierCode==="mondial_relay"&&!relay?.id)throw Object.assign(new Error(`Point Relais Mondial Relay manquant pour ${email}.`),{status:409,code:"SERVICE_POINT_REQUIRED",buyerEmail:email});
  const qualifies=checkouts.some((c)=>Number(c.itemAmount||0)>=10);
  const planCovered=checkouts.some((c)=>c.shippingCoveredBySellerPlan===true);
  const payer=planCovered?"cardoria":(isWinner&&!qualifies?"streamer":"buyer");
  return{
    live,checkouts,winner:isWinner?winner:null,user,recipient,relay,weight,pack,carrierCode,payer,
    totalOrderValue:money(checkouts.reduce((sum,c)=>sum+Number(c.itemAmount||0),0)),
    buyerName:clean(checkouts[0]?.customerName||winner?.name||user?.name||"Client Live",120)
  };
}
export function listLiveShipments({liveId="",sellerId="",buyerEmail=""}={}){
  let rows=load();
  if(liveId)rows=rows.filter((r)=>r.liveId===String(liveId));
  if(sellerId)rows=rows.filter((r)=>r.sellerId===String(sellerId));
  if(buyerEmail)rows=rows.filter((r)=>emailKey(r.buyerEmail)===emailKey(buyerEmail));
  return rows.map((r)=>({...r}));
}
export async function createLiveShipment({liveId,buyerEmail}={}){
  if(!isSendcloudConfigured())throw Object.assign(new Error("Sendcloud non configuré côté serveur."),{status:503,code:"SENDCLOUD_NOT_CONFIGURED"});
  const live=getLiveSession(liveId);
  if(!live)throw Object.assign(new Error("Live introuvable."),{status:404});
  if(!["ended","cancelled"].includes(String(live.status||"").toLowerCase()))throw Object.assign(new Error("Le Live doit être terminé avant de créer les étiquettes."),{status:409,code:"LIVE_NOT_CLOSED"});
  const email=emailKey(buyerEmail);
  const groupKey=liveShipmentGroupKey({liveId:live.id,sellerId:live.ownerId,buyerId:email});
  const existing=load().find((r)=>r.groupKey===groupKey&&r.sendcloudShipmentId);
  if(existing)return{...existing,duplicate:true};
  const data=groupData(live,email);
  if(!data)throw Object.assign(new Error("Aucun achat payé ni giveaway gagnant pour cet acheteur."),{status:404});
  const sender=senderForLive(live);
  const sc=await createSendcloudShipment({
    orderNumber:groupKey,reference:groupKey,
    toAddress:{...data.recipient,recipientName:data.buyerName},toEmail:email,
    fromAddress:sender.address,fromEmail:sender.email,fromCompanyName:sender.companyName,
    weightGrams:data.weight,totalOrderValue:data.totalOrderValue,carrierCode:data.carrierCode,
    servicePointId:data.carrierCode==="mondial_relay"?Number(data.relay.id):null
  });
  const row={
    id:"LSH-"+crypto.randomUUID(),groupKey,liveId:live.id,sellerId:live.ownerId,
    buyerEmail:email,buyerName:data.buyerName,payer:data.payer,
    estimatedShippingCost:money(data.pack?.price||0),weightGrams:data.weight,
    carrier:data.pack?.carrier||sc.carrierCode,carrierCode:sc.carrierCode,
    servicePoint:data.relay||null,recipientAddress:data.recipient,
    sendcloudShipmentId:sc.shipmentId,sendcloudParcelId:sc.parcelId,
    trackingNumber:sc.trackingNumber,trackingUrl:sc.trackingUrl,labelUrl:sc.labelUrl,
    status:sc.status||"READY_TO_SEND",shippingOptionCode:sc.shippingOptionCode,
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
  };
  const rows=load().filter((r)=>r.groupKey!==groupKey);rows.push(row);save(rows);return row;
}
export async function createLiveShipmentsForLive(liveId){
  const live=getLiveSession(liveId);if(!live)throw Object.assign(new Error("Live introuvable."),{status:404});
  const emails=new Set(listLiveCheckouts({liveId:live.id}).filter((c)=>PAID.has(String(c.status||"").toLowerCase())).map((c)=>emailKey(c.customerEmail)).filter(Boolean));
  const winner=giveawayWinner(live.id);if(winner?.email)emails.add(winner.email);
  const created=[],errors=[];
  for(const email of emails){
    try{created.push(await createLiveShipment({liveId:live.id,buyerEmail:email}));}
    catch(error){errors.push({buyerEmail:email,code:error?.code||"",error:error?.message||"Erreur expédition"});}
  }
  return{created,errors,total:emails.size};
}
export function applySendcloudWebhookToLiveShipment(payload={}){
  const parcelId=clean(payload?.parcel?.id||payload?.data?.parcel?.id||payload?.id,160);
  const trackingNumber=clean(payload?.parcel?.tracking_number||payload?.data?.parcel?.tracking_number||payload?.tracking_number,160);
  if(!parcelId&&!trackingNumber)return null;
  const rows=load();
  const index=rows.findIndex((r)=>(parcelId&&String(r.sendcloudParcelId)===parcelId)||(trackingNumber&&r.trackingNumber===trackingNumber));
  if(index<0)return null;
  const status=clean(payload?.parcel?.status?.message||payload?.parcel?.status?.code||payload?.status?.message||payload?.status?.code||payload?.action||payload?.event||rows[index].status,120);
  rows[index]={...rows[index],status,trackingNumber:trackingNumber||rows[index].trackingNumber,updatedAt:new Date().toISOString()};
  save(rows);return{...rows[index]};
}
