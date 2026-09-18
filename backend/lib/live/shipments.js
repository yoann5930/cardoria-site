import crypto from "crypto";
import { readJson, writeJson } from "../storage.js";
import { getUserByEmail } from "../auth/users.js";
import { getSeller } from "../marketplace/sellers.js";
import { liveShipmentGroupKey } from "../subscriptions/plans.js";
import { getLiveActionState } from "./actions.js";
import { getLiveSession, listLiveCheckouts } from "./sessions.js";
import { productShippingWeight, shippingPackForWeight } from "./shipping.js";
import { createCheckoutQueue } from "./checkout-queue.js";
import { updateShipmentFromSendcloud } from "../sendcloud-tracking.js";
import { createSendcloudShipment, isSendcloudConfigured } from "../sendcloud.js";

const STORE="live-shipments";
const PAID=new Set(["paid","completed"]);
const runShipmentTask=createCheckoutQueue();
const clean=(v,m=240)=>String(v==null?"":v).trim().slice(0,m);
const emailKey=(v)=>clean(v,254).toLowerCase();
const money=(v)=>Math.round((Number(v)||0)*100)/100;
function load(){const rows=readJson(STORE,[]);if(!Array.isArray(rows))throw new Error("Stockage des expéditions invalide.");return rows;}
function save(rows){writeJson(STORE,rows);}
function persist(row){const rows=load();const index=rows.findIndex(r=>r.groupKey===row.groupKey);if(index<0)rows.push(row);else rows[index]=row;save(rows);return row;}

export function liveLabelPurchasesEnabled(){
  return process.env.SENDCLOUD_LIVE_LABELS_ENABLED==="true";
}
function profileAddress(user){
  if(!user?.addressLine1||!user?.postalCode||!user?.city)return null;
  return{recipientName:[user.firstName,user.lastName].filter(Boolean).join(" ")||user.name||"",addressLine1:user.addressLine1,addressLine2:user.addressLine2||"",postalCode:user.postalCode,city:user.city,countryCode:user.country||"FR",phone:user.phone||""};
}
function profileRelay(user){const r=user?.relay;return r?.id?{...r,id:String(r.id)}:null;}
function checkoutRelay(checkout){const r=checkout?.servicePoint;return r?.id?{...r,id:String(r.id)}:null;}
function giveawayWinner(liveId){
  const g=getLiveActionState(liveId)?.giveaway;
  return g?.winner?.email?{email:emailKey(g.winner.email),name:clean(g.winner.name,120),productId:g.productId||"",giveawayId:g.id||""}:null;
}
function senderForLive(live){
  if(live.ownerRole==="seller"){
    const seller=getSeller(live.ownerId);
    if(!seller?.senderReady)throw Object.assign(new Error("Adresse expéditeur vendeur incomplète."),{status:409,code:"SELLER_SENDER_PROFILE_REQUIRED"});
    return{address:{...seller.sender,recipientName:seller.sender.name},email:seller.email||"",companyName:seller.displayName||""};
  }
  const address={name:clean(process.env.CARDORIA_SENDER_NAME,120),recipientName:clean(process.env.CARDORIA_SENDER_NAME,120),addressLine1:clean(process.env.CARDORIA_SENDER_ADDRESS_LINE1,160),addressLine2:clean(process.env.CARDORIA_SENDER_ADDRESS_LINE2,160),postalCode:clean(process.env.CARDORIA_SENDER_POSTAL_CODE,24),city:clean(process.env.CARDORIA_SENDER_CITY,120),countryCode:clean(process.env.CARDORIA_SENDER_COUNTRY||"FR",2),phone:clean(process.env.CARDORIA_SENDER_PHONE,32)};
  if(!address.recipientName||!address.addressLine1||!address.postalCode||!address.city)throw Object.assign(new Error("Adresse expéditeur Cardoria non configurée."),{status:503,code:"CARDORIA_SENDER_NOT_CONFIGURED"});
  return{address,email:clean(process.env.CARDORIA_SENDER_EMAIL,254),companyName:"Cardoria"};
}
function groupData(live,email){
  const all=listLiveCheckouts({liveId:live.id}).filter(c=>emailKey(c.customerEmail)===email);
  if(all.some(c=>["pending","authorized","authorised"].includes(String(c.status||"").toLowerCase())))throw Object.assign(new Error("Un paiement de cet acheteur est encore en attente. Aucun colis ne sera créé avant régularisation."),{status:409,code:"LIVE_PAYMENT_UNSETTLED"});
  const checkouts=all.filter(c=>PAID.has(String(c.status||"").toLowerCase())).sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||"")));
  const winner=giveawayWinner(live.id),isWinner=winner?.email===email;
  if(!checkouts.length&&!isWinner)return null;
  const user=getUserByEmail(email);
  const lastWithAddress=[...checkouts].reverse().find(c=>c.shippingAddress?.addressLine1);
  const recipient=lastWithAddress?.shippingAddress||profileAddress(user);
  if(!recipient?.recipientName||!recipient?.addressLine1||!recipient?.postalCode||!recipient?.city)throw Object.assign(new Error("Nom réel et adresse du destinataire requis."),{status:409,code:"RECIPIENT_ADDRESS_REQUIRED"});
  const relay=[...checkouts].reverse().map(checkoutRelay).find(Boolean)||profileRelay(user);
  let weight=0;
  for(const c of checkouts){
    const unit=Number(c.shippingUnitWeightGrams);
    if(!Number.isFinite(unit)||unit<=0)throw Object.assign(new Error("Poids emballé manquant dans une commande. Confirmez le poids avant l'expédition."),{status:409,code:"SHIPMENT_WEIGHT_REQUIRED"});
    weight+=unit*Math.max(1,Number(c.qty)||1);
  }
  if(isWinner){
    const p=(live.products||[]).find(x=>String(x.id)===String(winner.productId));
    const giftWeight=productShippingWeight(p,1);
    if(!giftWeight)throw Object.assign(new Error("Poids du cadeau manquant."),{status:409,code:"SHIPMENT_WEIGHT_REQUIRED"});
    weight+=giftWeight;
  }
  weight=Math.ceil(weight);
  const pack=shippingPackForWeight(weight);
  const carrierCode=pack?.carrier==="Mondial Relay"?"mondial_relay":clean(process.env.SENDCLOUD_LETTER_CARRIER_CODE,80);
  if(!carrierCode)throw Object.assign(new Error("Transporteur Lettre suivie non validé pour ce compte Sendcloud."),{status:503,code:"LETTER_CARRIER_NOT_CONFIGURED"});
  if(carrierCode==="mondial_relay"&&!relay?.id)throw Object.assign(new Error("Point Relais Mondial Relay manquant."),{status:409,code:"SERVICE_POINT_REQUIRED"});
  const planCovered=checkouts.some(c=>c.shippingCoveredBySellerPlan===true);
  const buyerPostagePaid=money(checkouts.reduce((sum,c)=>sum+Number(c.shippingAmount||0),0));
  const payer=planCovered?"cardoria":buyerPostagePaid>0?"buyer":isWinner?"streamer":"unresolved";
  if(payer==="unresolved")throw Object.assign(new Error("Financement des frais d'envoi à régulariser."),{status:409,code:"SHIPMENT_FUNDING_UNRESOLVED"});
  return{live,checkouts,winner:isWinner?winner:null,recipient,relay,weight,pack,carrierCode,payer,buyerPostagePaid,totalOrderValue:money(checkouts.reduce((sum,c)=>sum+Number(c.itemAmount||0),0)),buyerName:recipient.recipientName};
}
export function listLiveShipments({liveId="",sellerId="",buyerEmail=""}={}){
  let rows=load();
  if(liveId)rows=rows.filter(r=>r.liveId===String(liveId));
  if(sellerId)rows=rows.filter(r=>r.sellerId===String(sellerId));
  if(buyerEmail)rows=rows.filter(r=>emailKey(r.buyerEmail)===emailKey(buyerEmail));
  return rows.map(r=>({...r}));
}
export async function createLiveShipment({liveId,buyerEmail}={}){
  const live=getLiveSession(liveId);
  if(!live)throw Object.assign(new Error("Live introuvable."),{status:404});
  if(live.status!=="ended")throw Object.assign(new Error("Le Live doit être terminé, non annulé, avant de créer les étiquettes."),{status:409,code:"LIVE_NOT_CLOSED"});
  const email=emailKey(buyerEmail);
  const groupKey=liveShipmentGroupKey({liveId:live.id,sellerId:live.ownerId,buyerId:email});
  return runShipmentTask(groupKey,async()=>{
    const existing=load().find(r=>r.groupKey===groupKey);
    if(existing?.sendcloudShipmentId)return{...existing,duplicate:true};
    if(existing)throw Object.assign(new Error("Une tentative d'étiquette existe déjà. Vérifiez Sendcloud avant toute nouvelle création."),{status:409,code:"SHIPMENT_RECONCILIATION_REQUIRED"});
    // API credentials alone must not enable financial side effects during rollout.
    if(!liveLabelPurchasesEnabled())throw Object.assign(new Error("Création réelle d'étiquettes désactivée : validation transporteur et facturation nécessaire."),{status:503,code:"LIVE_LABELS_NOT_ACTIVATED"});
    if(!isSendcloudConfigured())throw Object.assign(new Error("Sendcloud non configuré côté serveur."),{status:503,code:"SENDCLOUD_NOT_CONFIGURED"});
    const data=groupData(live,email);
    if(!data)throw Object.assign(new Error("Aucun achat payé ni cadeau pour cet acheteur."),{status:404});
    const sender=senderForLive(live),id="LSH-"+crypto.randomUUID(),now=new Date().toISOString();
    const intent={id,groupKey,liveId:live.id,sellerId:live.ownerId,buyerEmail:email,buyerName:data.buyerName,payer:data.payer,buyerPostagePaid:data.buyerPostagePaid,estimatedShippingCost:money(data.pack?.price||0),weightGrams:data.weight,carrier:data.pack?.carrier||data.carrierCode,carrierCode:data.carrierCode,servicePoint:data.relay||null,recipientAddress:data.recipient,status:"creation_pending",createdAt:now,updatedAt:now};
    // Persist before contacting the carrier. Timeouts/restarts require reconciliation,
    // not blind re-announcement, which could purchase another label.
    persist(intent);
    try{
      const sc=await createSendcloudShipment({orderNumber:id,reference:id,toAddress:data.recipient,toEmail:email,fromAddress:sender.address,fromEmail:sender.email,fromCompanyName:sender.companyName,weightGrams:data.weight,totalOrderValue:data.totalOrderValue,carrierCode:data.carrierCode,servicePointId:data.carrierCode==="mondial_relay"?Number(data.relay.id):null});
      if(!sc.shipmentId||!sc.parcelId)throw new Error("Réponse Sendcloud incomplète : rapprochement requis.");
      return persist({...intent,sendcloudShipmentId:sc.shipmentId,sendcloudParcelId:sc.parcelId,trackingNumber:sc.trackingNumber,trackingUrl:sc.trackingUrl,labelUrl:sc.labelUrl,status:sc.status||"READY_TO_SEND",shippingOptionCode:sc.shippingOptionCode,updatedAt:new Date().toISOString()});
    }catch(error){
      persist({...intent,status:"reconciliation_required",updatedAt:new Date().toISOString()});
      throw Object.assign(new Error("Création non confirmée. Contrôlez Sendcloud avant de réessayer pour éviter une double facturation."),{status:502,code:"SHIPMENT_RECONCILIATION_REQUIRED"});
    }
  });
}
export async function createLiveShipmentsForLive(liveId){
  const live=getLiveSession(liveId);if(!live)throw Object.assign(new Error("Live introuvable."),{status:404});
  const emails=new Set(listLiveCheckouts({liveId:live.id}).filter(c=>PAID.has(String(c.status||"").toLowerCase())).map(c=>emailKey(c.customerEmail)).filter(Boolean));
  const winner=giveawayWinner(live.id);if(winner?.email)emails.add(winner.email);
  const created=[],errors=[];
  for(const email of emails){try{created.push(await createLiveShipment({liveId:live.id,buyerEmail:email}));}catch(error){errors.push({buyerEmail:email,code:error?.code||"",error:error?.message||"Erreur expédition"});}}
  return{created,errors,total:emails.size};
}
export function applySendcloudWebhookToLiveShipment(payload={}){
  if(payload?.action!=="parcel_status_changed")return null;
  const parcelId=String(payload?.parcel?.id||"");
  if(!parcelId)return null;
  const rows=load(),index=rows.findIndex(r=>String(r.sendcloudParcelId||"")===parcelId);
  if(index<0)return null;
  const update=updateShipmentFromSendcloud(rows[index],payload);
  if(update.changed){rows[index]=update.shipment;save(rows);}
  return{...update.shipment,eventApplied:update.changed};
}
