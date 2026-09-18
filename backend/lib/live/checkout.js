/** Checkout Live Cardoria : Live Admin → SumUp, Live vendeur → PayPal. */
import crypto from "crypto";
import { assertSaleProvider, assertServerAmount, money } from "../payments/routing.js";
import { createSumUpCheckout, isSumUpConfigured } from "../payments/sumup.js";
import { getPayPalMarketplaceConfig, createLivePayPalOrder } from "../marketplace/paypal.js";
import { getLiveCommissionAmount, getSellerPlan, isLiveBuyerShippingPaidByCardoria } from "../subscriptions/plans.js";
import { getSellerPlanState } from "../subscriptions/seller-plans.js";
import { getLiveCheckout, getLiveSession, listLiveCheckouts, saveLiveCheckout } from "./sessions.js";
import { runLiveCheckoutTask } from "./checkout-queue.js";
import { UNSETTLED_LIVE_PAYMENT_STATUSES, SETTLED_LIVE_PAYMENT_STATUSES, isSameLiveBuyer, assertCheckoutOwnership, assertNoOtherUnsettledCheckout, assertExistingCheckoutReusable, normalizeCheckoutRequestId } from "./checkout-lifecycle.js";
import { resolveLiveSaleRule } from "./sale-rules.js";
import { getLiveActionState } from "./actions.js";
import { quoteLiveShipping } from "./shipping.js";
import { quoteLivePostage } from "./shipping-billing.js";
const clean=(v,m=200)=>String(v==null?"":v).trim().slice(0,m);
function validateEmail(v){const e=clean(v,254).toLowerCase();if(!/^\S+@\S+\.\S+$/.test(e))throw Object.assign(new Error("Adresse email invalide."),{status:400});return e;}
function normalizeShippingAddress(raw,customerName=""){
  const source=raw&&typeof raw==="object"?raw:{};
  const address={recipientName:clean(source.recipientName||customerName,120),addressLine1:clean(source.addressLine1,160),addressLine2:clean(source.addressLine2,160),postalCode:clean(source.postalCode,24).toUpperCase(),city:clean(source.city,120),countryCode:clean(source.countryCode||"FR",2).toUpperCase(),phone:clean(source.phone,32)};
  if(!address.recipientName)throw Object.assign(new Error("Nom et prénom du destinataire obligatoires."),{status:400,code:"LIVE_SHIPPING_RECIPIENT_REQUIRED"});
  if(!address.addressLine1)throw Object.assign(new Error("Adresse postale obligatoire pour l’envoi."),{status:400,code:"LIVE_SHIPPING_ADDRESS_REQUIRED"});
  if(!address.postalCode)throw Object.assign(new Error("Code postal obligatoire pour l’envoi."),{status:400,code:"LIVE_SHIPPING_POSTAL_CODE_REQUIRED"});
  if(!address.city)throw Object.assign(new Error("Ville obligatoire pour l’envoi."),{status:400,code:"LIVE_SHIPPING_CITY_REQUIRED"});
  if(!/^[A-Z]{2}$/.test(address.countryCode))throw Object.assign(new Error("Code pays invalide."),{status:400,code:"LIVE_SHIPPING_COUNTRY_INVALID"});
  return address;
}
function normalizeServicePoint(raw){
  if(!raw||typeof raw!=="object")return null;
  const id=clean(raw.id,64);if(!id)return null;
  if(!/^\d+$/.test(id)||!Number.isSafeInteger(Number(id))||Number(id)<=0)throw Object.assign(new Error("Identifiant Point Relais invalide."),{status:400,code:"LIVE_SERVICE_POINT_INVALID"});
  return{id,carrierServicePointId:clean(raw.carrierServicePointId,120),name:clean(raw.name,160),address:clean(raw.address,200),postalCode:clean(raw.postalCode,24).toUpperCase(),city:clean(raw.city,120),countryCode:clean(raw.countryCode||"FR",2).toUpperCase(),carrierCode:clean(raw.carrierCode||"mondial_relay",80)};
}
function privateBuyerHistory(liveId,email,customerId){
  return listLiveCheckouts({liveId}).filter(c=>isSameLiveBuyer(c,{customerId,customerEmail:email})&&(!customerId||String(c.customerId||"")===String(customerId))&&["planned","pending","paid","completed","authorized","authorised"].includes(String(c.status||"").toLowerCase()));
}
function resolveShippingAddress({history,provided,customerName,required=false}){
  const hasProvided=provided&&typeof provided==="object"&&Object.values(provided).some(v=>String(v||"").trim());
  const source=hasProvided?provided:history.find(c=>c.shippingAddress?.addressLine1&&c.shippingAddress?.postalCode&&c.shippingAddress?.city)?.shippingAddress;
  if(!source&&!required)return null;
  return normalizeShippingAddress(source,customerName);
}
function commissionFor(live,amount){
  if(live.ownerRole!=="seller")return{platformFee:0,sellerNet:amount,commissionPercent:0};
  const state=getSellerPlanState(live.ownerId),plan=getSellerPlan(state.planId),platformFee=money(getLiveCommissionAmount(state.planId,amount));
  return{platformFee,sellerNet:money(amount-platformFee),commissionPercent:Number(plan.liveCommissionRate)*100,planId:plan.id};
}
function sellerPlanShippingCoverage(live,email){
  if(live?.ownerRole!=="seller")return{covered:false,planId:"",buyerLimit:0};
  const state=getSellerPlanState(live.ownerId);
  if(!state.active)return{covered:false,planId:state.planId||"",buyerLimit:0};
  const priorBuyerIds=listLiveCheckouts({liveId:live.id})
    .filter(c=>UNSETTLED_LIVE_PAYMENT_STATUSES.has(String(c.status||"").toLowerCase())||SETTLED_LIVE_PAYMENT_STATUSES.has(String(c.status||"").toLowerCase()))
    .sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||"")))
    .map(c=>String(c.customerEmail||"").trim().toLowerCase()).filter(Boolean);
  const plan=getSellerPlan(state.planId);
  return{covered:isLiveBuyerShippingPaidByCardoria(state.planId,email,priorBuyerIds),planId:state.planId,buyerLimit:Number(plan.liveCardoriaShippingBuyerLimit||0)};
}
function liveShippingPaymentPolicy({live,email,customerId,itemAmount,shipping,coverage,actionState,excludeCheckoutId}){
  const awards=Array.isArray(actionState?.giveawayAwards)?actionState.giveawayAwards:[];
  const winnerEmail=String(actionState?.giveaway?.winner?.email||"").trim().toLowerCase();
  const giveawayWinner=winnerEmail===email||awards.some(a=>String(a.winner?.email||"").trim().toLowerCase()===email);
  return quoteLivePostage({
    checkouts:listLiveCheckouts({liveId:live.id}),liveId:live.id,ownerId:live.ownerId,
    customerId,customerEmail:email,currentItemAmount:itemAmount,
    shippingTarget:shipping.totalShippingTarget??shipping.shippingAmount,
    planCovered:coverage.covered,giveawayWinner,excludeCheckoutId
  });
}
function reservedUnits(liveId,productId,excludeKey=""){
  return listLiveCheckouts({liveId}).filter(c=>c.productId===productId&&c.idempotencyKey!==excludeKey&&(c.status==="planned"||UNSETTLED_LIVE_PAYMENT_STATUSES.has(String(c.status||"").toLowerCase()))).reduce((n,c)=>n+Math.max(1,Number(c.qty)||1),0);
}
function normalizeSpotLabel(value){return clean(value,80);}
function assertEnergySpotAvailable({liveId,productId,rule,spotLabel,excludeKey}){
  if(rule.breakType!=="energy_game")return"";
  const label=normalizeSpotLabel(spotLabel);
  if(!label)throw Object.assign(new Error("Choisissez une énergie disponible avant le paiement."),{status:400});
  const canonical=(rule.spotLabels||[]).find(item=>String(item)===label);
  if(!canonical)throw Object.assign(new Error("Cette énergie ne fait pas partie de l'item sélectionné."),{status:409});
  const occupied=listLiveCheckouts({liveId}).some(c=>c.productId===productId&&c.idempotencyKey!==excludeKey&&String(c.spotLabel||"")===canonical&&(c.status==="planned"||UNSETTLED_LIVE_PAYMENT_STATUSES.has(String(c.status||"").toLowerCase())||SETTLED_LIVE_PAYMENT_STATUSES.has(String(c.status||"").toLowerCase())));
  if(occupied)throw Object.assign(new Error(`Le spot ${canonical} est déjà réservé ou vendu.`),{status:409,spotLabel:canonical});
  return canonical;
}
export function planLiveCheckout({liveId,productId,qty,spotLabel,customerId="",customerEmail,customerName,shippingAddress,servicePoint,checkoutRequestId,requireShippingAddress=false,requestedProvider,requestedAmount}){
  const live=getLiveSession(liveId);
  if(!live)throw Object.assign(new Error("Live introuvable."),{status:404});
  if(live.status!=="live")throw Object.assign(new Error("Ce Live doit être en cours pour accepter un paiement."),{status:409});
  const route=assertSaleProvider({channel:"live",ownerRole:live.ownerRole,requestedProvider});
  const actionState=getLiveActionState(live.id),energyBreak=actionState.break?.breakType==="energy_game"&&actionState.break?.status==="running"?actionState.break:null;
  let product=(live.products||[]).find(i=>i.id===String(productId||""));
  if(!product&&energyBreak&&String(energyBreak.productId)===String(productId||""))product={id:energyBreak.productId,name:energyBreak.productName||"Jeu de l’énergie",mode:"break",price:energyBreak.pricePerSpot,stock:energyBreak.spots,qty:energyBreak.spots,shippingWeightGrams:Number(energyBreak.shippingWeightGrams||20),virtualProduct:true};
  if(!product)throw Object.assign(new Error("Produit Live introuvable."),{status:404});
  let units=Math.max(1,Math.min(20,Math.trunc(Number(qty)||1)));
  const email=validateEmail(customerEmail),buyerId=clean(customerId,120),rule=resolveLiveSaleRule({live,product,customerEmail:email});
  if(rule.breakType==="energy_game")units=1;
  const requestId=normalizeCheckoutRequestId(checkoutRequestId);
  const keyFor=label=>[live.id,product.id,email,units,rule.actionId||rule.kind,label,...(requestId?[requestId]:[])].join(":");
  const provisionalKey=keyFor(normalizeSpotLabel(spotLabel)),provisional=getLiveCheckout(provisionalKey);
  assertCheckoutOwnership(provisional,buyerId);assertExistingCheckoutReusable(provisional);
  if(provisional?.status==="pending")return provisional;
  const selectedSpot=assertEnergySpotAvailable({liveId:live.id,productId:product.id,rule,spotLabel,excludeKey:provisionalKey});
  const idempotencyKey=keyFor(selectedSpot),existing=getLiveCheckout(idempotencyKey);
  assertCheckoutOwnership(existing,buyerId);assertExistingCheckoutReusable(existing);
  if(existing?.status==="pending")return existing;
  assertNoOtherUnsettledCheckout(listLiveCheckouts({liveId:live.id}),{liveId:live.id,customerId:buyerId,customerEmail:email,excludeId:existing?.id||""});
  const available=Math.max(0,Number(product.stock||0)-reservedUnits(live.id,product.id,idempotencyKey));
  if(available<units)throw Object.assign(new Error(`Stock Live insuffisant pour ${product.name}.`),{status:409,available});
  const itemAmount=assertServerAmount(money(rule.unitPrice)*units,requestedAmount);
  const shipping=quoteLiveShipping({liveId:live.id,customerEmail:email,productId:product.id,qty:units,excludeCheckoutId:existing?.id||"",productOverride:product});
  const coverage=sellerPlanShippingCoverage(live,email);
  const paymentPolicy=liveShippingPaymentPolicy({live,email,customerId:buyerId,itemAmount,shipping,coverage,actionState,excludeCheckoutId:existing?.id||""});
  const buyerShippingAmount=paymentPolicy.buyerAmount,amount=money(itemAmount+buyerShippingAmount),name=clean(customerName,120)||"Client Live";
  const history=privateBuyerHistory(live.id,email,buyerId);
  const address=resolveShippingAddress({history,provided:shippingAddress,customerName:name,required:requireShippingAddress});
  const selectedServicePoint=normalizeServicePoint(servicePoint)||normalizeServicePoint(history.find(c=>c.servicePoint?.id)?.servicePoint);
  const commission=commissionFor(live,itemAmount);
  if(shipping.pack?.carrier==="Mondial Relay"&&!selectedServicePoint?.id)throw Object.assign(new Error("Choisissez un Point Relais Mondial Relay pour cet envoi."),{status:400,code:"LIVE_SERVICE_POINT_REQUIRED"});
  const now=new Date().toISOString();
  return saveLiveCheckout({id:existing?.status==="planned"?existing.id:"LCK-"+crypto.randomUUID(),idempotencyKey,checkoutRequestId:requestId,liveId:live.id,liveTitle:live.title,ownerRole:live.ownerRole,ownerId:live.ownerId,channel:route.channel,provider:route.provider,productId:product.id,productName:product.name,qty:units,unitPrice:rule.unitPrice,itemAmount,saleKind:rule.kind,actionId:rule.actionId||"",breakType:rule.breakType||"",spotLabel:selectedSpot,shippingAmount:buyerShippingAmount,shippingCostAmount:money(shipping.shippingAmount),shippingEstimatedTotal:money(shipping.totalShippingTarget??shipping.shippingAmount),shippingPaidBy:paymentPolicy.payer,shippingCoveredBySellerPlan:paymentPolicy.payer==="cardoria",shippingChargeLockedForLive:paymentPolicy.locked,shippingPolicyVersion:paymentPolicy.policyVersion,shippingThresholdEur:paymentPolicy.thresholdEur,shippingThresholdMode:"cumulative_paid_items",shippingPaidItemTotalBefore:paymentPolicy.priorPaidItems,shippingItemTotalWithPurchase:paymentPolicy.cumulativeItems,shippingBuyerPostageAlreadyPaid:paymentPolicy.buyerPostageAlreadyPaid,giveawayWinner:paymentPolicy.giveawayWinner,giveawayShippingPurchaseQualified:paymentPolicy.qualifyingGiveawayPurchase,shippingCoveragePlanId:coverage.planId,shippingCoverageBuyerLimit:coverage.buyerLimit,shippingAlreadyCharged:shipping.alreadyCharged||0,shippingPackId:shipping.pack?.id||"",shippingCarrier:shipping.pack?.carrier||"",shippingWeightGrams:shipping.totalWeightGrams||0,shippingUnitWeightGrams:Number(product.shippingWeightGrams||0),shippingBundled:true,amount,...commission,sellerNet:money(commission.sellerNet+buyerShippingAmount),customerId:buyerId,customerEmail:email,customerName:name,shippingAddress:address,servicePoint:selectedServicePoint,status:"planned",paymentProviderOrderId:"",url:"",createdAt:existing?.status==="planned"?existing.createdAt:now,updatedAt:now});
}
export async function createLiveCheckout(input){
  return runLiveCheckoutTask("shipping-live:"+String(input?.liveId||""),async()=>{
    const current=planLiveCheckout(input);
    if(current.url&&current.paymentProviderOrderId&&current.status==="pending")return current;
    let paypal=null;
    if(current.provider==="sumup"){
      if(!isSumUpConfigured())throw Object.assign(new Error("Paiement SumUp non configuré côté serveur."),{status:503,provider:"sumup"});
    }else{
      paypal=getPayPalMarketplaceConfig();
      if(!paypal.configured)throw Object.assign(new Error("Paiement PayPal non configuré côté serveur."),{status:503,provider:"paypal"});
    }
    saveLiveCheckout({...current,status:"creating",updatedAt:new Date().toISOString()});
    try{
      let payment;
      if(current.provider==="sumup"){
        payment=await createSumUpCheckout({orderId:current.id,amount:current.amount,description:`Live Cardoria — ${current.productName}${current.spotLabel?` — ${current.spotLabel}`:""}${current.shippingAmount?` — port ${current.shippingAmount.toFixed(2)} EUR`:""}`,customerEmail:current.customerEmail,redirectUrl:String(input.successUrl||"/live.html"),source:"live_cardoria"});
      }else{
        payment=await createLivePayPalOrder({checkoutId:current.id,amount:current.amount,sellerId:current.ownerId,description:`Live vendeur Cardoria — ${current.productName}${current.spotLabel?` — ${current.spotLabel}`:""}${current.shippingAmount?` — port ${current.shippingAmount.toFixed(2)} EUR`:""}`,successUrl:String(input.successUrl||"/live.html"),cancelUrl:String(input.cancelUrl||"/live.html"),platformFee:current.platformFee});
      }
      const providerId=current.provider==="sumup"?payment.checkoutId:payment.id;
      if(!providerId||!payment.url)throw new Error("Réponse de paiement incomplète.");
      const latest=getLiveCheckout(current.id)||current;
      const status=latest.status==="creating"||latest.status==="planned"?"pending":latest.status;
      return saveLiveCheckout({...latest,status,paymentProviderOrderId:providerId,url:payment.url,environment:paypal?.environment||"production",updatedAt:new Date().toISOString()});
    }catch(error){
      const latest=getLiveCheckout(current.id)||current;
      if(latest.status==="creating"||latest.status==="planned")saveLiveCheckout({...latest,status:"reconciliation_required",updatedAt:new Date().toISOString()});
      throw Object.assign(new Error("Création du paiement non confirmée. Vérification nécessaire avant de réessayer."),{status:502,code:"LIVE_PAYMENT_RECONCILIATION_REQUIRED",provider:current.provider});
    }
  });
}
