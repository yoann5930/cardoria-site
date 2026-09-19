import crypto from "crypto";
import { readJson, writeJson } from "../storage.js";
import { getUserByEmail } from "../auth/users.js";
import { getSeller } from "../marketplace/sellers.js";
import { liveShipmentGroupKey } from "../subscriptions/plans.js";
import { getLiveGiveawayAwards } from "./actions.js";
import { getLiveSession, listLiveCheckouts } from "./sessions.js";
import { shippingPackForWeight } from "./shipping.js";
import { createCheckoutQueue } from "./checkout-queue.js";
import { UNSETTLED_LIVE_PAYMENT_STATUSES } from "./checkout-lifecycle.js";
import { updateShipmentFromSendcloud } from "../sendcloud-tracking.js";
import { createSendcloudShipment, isSendcloudConfigured } from "../sendcloud.js";

const STORE="live-shipments",PAID=new Set(["paid","completed"]),runShipmentTask=createCheckoutQueue();
const clean=(v,m=240)=>String(v==null?"":v).trim().slice(0,m),emailKey=v=>clean(v,254).toLowerCase(),money=v=>Math.round((Number(v)||0)*100)/100;
function load(){const rows=readJson(STORE,[]);if(!Array.isArray(rows))throw new Error("Stockage des expéditions invalide.");return rows;}
function save(rows){writeJson(STORE,rows);}
function persist(row){const rows=load(),index=rows.findIndex(r=>r.groupKey===row.groupKey);if(index<0)rows.push(row);else rows[index]=row;save(rows);return row;}
export function liveLabelPurchasesEnabled(){return process.env.SENDCLOUD_LIVE_LABELS_ENABLED==="true";}
function profileAddress(user){if(!user?.addressLine1||!user?.postalCode||!user?.city)return null;return{recipientName:[user.firstName,user.lastName].filter(Boolean).join(" ")||user.name||"",addressLine1:user.addressLine1,addressLine2:user.addressLine2||"",postalCode:user.postalCode,city:user.city,countryCode:user.country||"FR",phone:user.phone||""};}
function profileRelay(user){const r=user?.relay;return r?.id?{...r,id:String(r.id)}:null;}
function checkoutRelay(checkout){const r=checkout?.servicePoint;return r?.id?{...r,id:String(r.id)}:null;}
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
// Read-only preview used both for tests and real creation; it never purchases a label.
export function prepareLiveShipmentGroup(liveId,buyerEmail){
  const live=getLiveSession(liveId);if(!live)throw Object.assign(new Error("Live introuvable."),{status:404});
  const email=emailKey(buyerEmail),all=listLiveCheckouts({liveId:live.id}).filter(c=>emailKey(c.customerEmail)===email);
  if(all.some(c=>UNSETTLED_LIVE_PAYMENT_STATUSES.has(String(c.status||"").toLowerCase())))throw Object.assign(new Error("Un paiement de cet acheteur est encore en attente. Aucun colis ne sera créé avant régularisation."),{status:409,code:"LIVE_PAYMENT_UNSETTLED"});
  const checkouts=all.filter(c=>PAID.has(String(c.status||"").toLowerCase())).sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||"")));
  const gifts=getLiveGiveawayAwards(live.id,{customerEmail:email}),isWinner=gifts.length>0;
  if(!checkouts.length&&!isWinner)return null;
  const user=getUserByEmail(email),lastWithAddress=[...checkouts].reverse().find(c=>c.shippingAddress?.addressLine1);
  const recipient=lastWithAddress?.shippingAddress||profileAddress(user);
  if(!recipient?.recipientName||!recipient?.addressLine1||!recipient?.postalCode||!recipient?.city)throw Object.assign(new Error("Nom réel et adresse du destinataire requis."),{status:409,code:"RECIPIENT_ADDRESS_REQUIRED"});
  const relay=[...checkouts].reverse().map(checkoutRelay).find(Boolean)||profileRelay(user);
  let weight=0;
  for(const c of checkouts){const unit=Number(c.shippingUnitWeightGrams);if(!Number.isFinite(unit)||unit<=0)throw Object.assign(new Error("Poids emballé manquant dans une commande."),{status:409,code:"SHIPMENT_WEIGHT_REQUIRED"});weight+=unit*Math.max(1,Number(c.qty)||1);}
  for(const gift of gifts){const grams=Number(gift.shippingWeightGrams);if(!Number.isFinite(grams)||grams<=0)throw Object.assign(new Error("Poids d'un cadeau gagné manquant."),{status:409,code:"SHIPMENT_WEIGHT_REQUIRED"});weight+=grams*Math.max(1,Number(gift.quantity)||1);}
  weight=Math.ceil(weight);
  const pack=shippingPackForWeight(weight),carrierCode=pack?.carrier==="Mondial Relay"?"mondial_relay":clean(process.env.SENDCLOUD_LETTER_CARRIER_CODE,80);
  if(!carrierCode)throw Object.assign(new Error("Transporteur Lettre suivie non validé pour ce compte Sendcloud."),{status:503,code:"LETTER_CARRIER_NOT_CONFIGURED"});
  if(carrierCode==="mondial_relay"&&!relay?.id)throw Object.assign(new Error("Point Relais Mondial Relay manquant."),{status:409,code:"SERVICE_POINT_REQUIRED"});
  const planCovered=checkouts.some(c=>c.shippingCoveredBySellerPlan===true),buyerPostagePaid=money(checkouts.reduce((sum,c)=>sum+Number(c.shippingAmount||0),0));
  const payer=planCovered?"cardoria":buyerPostagePaid>0?"buyer":isWinner?"streamer":"unresolved";
  if(payer==="unresolved")throw Object.assign(new Error("Financement des frais d'envoi à régulariser."),{status:409,code:"SHIPMENT_FUNDING_UNRESOLVED"});
  return{live,checkouts,gifts,recipient,relay,weight,pack,carrierCode,payer,buyerPostagePaid,totalOrderValue:money(checkouts.reduce((sum,c)=>sum+Number(c.itemAmount||0),0)),buyerName:recipient.recipientName};
}
export function liveShipmentRecipientEmails(liveId){
  const emails=new Set(listLiveCheckouts({liveId}).filter(c=>PAID.has(String(c.status||"").toLowerCase())).map(c=>emailKey(c.customerEmail)).filter(Boolean));
  for(const gift of getLiveGiveawayAwards(liveId))if(gift.winner?.email)emails.add(emailKey(gift.winner.email));
  return [...emails];
}
export function listLiveShipments({liveId="",sellerId="",buyerEmail=""}={}){let rows=load();if(liveId)rows=rows.filter(r=>r.liveId===String(liveId));if(sellerId)rows=rows.filter(r=>r.sellerId===String(sellerId));if(buyerEmail)rows=rows.filter(r=>emailKey(r.buyerEmail)===emailKey(buyerEmail));return rows.map(r=>({...r}));}
export async function createLiveShipment({liveId,buyerEmail}={}){
  const live=getLiveSession(liveId);if(!live)throw Object.assign(new Error("Live introuvable."),{status:404});
  if(live.status!=="ended")throw Object.assign(new Error("Le Live doit être terminé, non annulé, avant de créer les étiquettes."),{status:409,code:"LIVE_NOT_CLOSED"});
  const email=emailKey(buyerEmail),groupKey=liveShipmentGroupKey({liveId:live.id,sellerId:live.ownerId,buyerId:email});
  return runShipmentTask(groupKey,async()=>{
    const existing=load().find(r=>r.groupKey===groupKey);
    if(existing?.sendcloudShipmentId)return{...existing,duplicate:true};
    if(existing)throw Object.assign(new Error("Une tentative d'étiquette existe déjà. Vérifiez Sendcloud avant toute nouvelle création."),{status:409,code:"SHIPMENT_RECONCILIATION_REQUIRED"});
    if(!liveLabelPurchasesEnabled())throw Object.assign(new Error("Création réelle d'étiquettes désactivée : validation transporteur et facturation nécessaire."),{status:503,code:"LIVE_LABELS_NOT_ACTIVATED"});
    if(!isSendcloudConfigured())throw Object.assign(new Error("Sendcloud non configuré côté serveur."),{status:503,code:"SENDCLOUD_NOT_CONFIGURED"});
    const data=prepareLiveShipmentGroup(live.id,email);
    if(!data)throw Object.assign(new Error("Aucun achat payé ni cadeau pour cet acheteur."),{status:404});
    const sender=senderForLive(live),id="LSH-"+crypto.randomUUID(),now=new Date().toISOString();
    const intent={id,groupKey,liveId:live.id,sellerId:live.ownerId,buyerEmail:email,buyerName:data.buyerName,payer:data.payer,buyerPostagePaid:data.buyerPostagePaid,estimatedShippingCost:money(data.pack?.price||0),weightGrams:data.weight,carrier:data.pack?.carrier||data.carrierCode,carrierCode:data.carrierCode,servicePoint:data.relay||null,recipientAddress:data.recipient,giveawayIds:data.gifts.map(g=>g.giveawayId),checkoutIds:data.checkouts.map(c=>c.id),status:"creation_pending",createdAt:now,updatedAt:now};
    persist(intent);
    try{
      const sc=await createSendcloudShipment({orderNumber:id,reference:id,toAddress:data.recipient,toEmail:email,fromAddress:sender.address,fromEmail:sender.email,fromCompanyName:sender.companyName,weightGrams:data.weight,totalOrderValue:data.totalOrderValue,carrierCode:data.carrierCode,servicePointId:data.carrierCode==="mondial_relay"?Number(data.relay.id):null});
      if(!sc.shipmentId||!sc.parcelId)throw new Error("Réponse Sendcloud incomplète : rapprochement requis.");
      return persist({...intent,sendcloudShipmentId:sc.shipmentId,sendcloudParcelId:sc.parcelId,trackingNumber:sc.trackingNumber,trackingUrl:sc.trackingUrl,labelUrl:sc.labelUrl,status:sc.status||"READY_TO_SEND",shippingOptionCode:sc.shippingOptionCode,updatedAt:new Date().toISOString()});
    }catch(error){persist({...intent,status:"reconciliation_required",updatedAt:new Date().toISOString()});throw Object.assign(new Error("Création non confirmée. Contrôlez Sendcloud avant de réessayer pour éviter une double facturation."),{status:502,code:"SHIPMENT_RECONCILIATION_REQUIRED"});}
  });
}
export async function createLiveShipmentsForLive(liveId){
  const live=getLiveSession(liveId);if(!live)throw Object.assign(new Error("Live introuvable."),{status:404});
  const emails=liveShipmentRecipientEmails(liveId),created=[],errors=[];
  for(const email of emails){try{created.push(await createLiveShipment({liveId:live.id,buyerEmail:email}));}catch(error){errors.push({buyerEmail:email,code:error?.code||"",error:error?.message||"Erreur expédition"});}}
  return{created,errors,total:emails.length};
}
export function applySendcloudWebhookToLiveShipment(payload={}){
  if(payload?.action!=="parcel_status_changed")return null;
  const parcelId=String(payload?.parcel?.id||"");if(!parcelId)return null;
  const rows=load(),index=rows.findIndex(r=>String(r.sendcloudParcelId||"")===parcelId);if(index<0)return null;
  const update=updateShipmentFromSendcloud(rows[index],payload);if(update.changed){rows[index]=update.shipment;save(rows);}
  return{...update.shipment,eventApplied:update.changed};
}
