/** Checkout Live Cardoria : Live Admin → SumUp, Live vendeur → PayPal. */
import crypto from "crypto";
import { assertSaleProvider, assertServerAmount, money } from "../payments/routing.js";
import { createSumUpCheckout, isSumUpConfigured } from "../payments/sumup.js";
import { getPayPalMarketplaceConfig, createLivePayPalOrder } from "../marketplace/paypal.js";
import { getLiveCommissionAmount, getSellerPlan, isLiveBuyerShippingPaidByCardoria } from "../subscriptions/plans.js";
import { getSellerPlanState } from "../subscriptions/seller-plans.js";
import { getLiveCheckout, getLiveSession, listLiveCheckouts, saveLiveCheckout, withLiveLock } from "./sessions.js";
import { resolveLiveSaleRule } from "./sale-rules.js";
import { getLiveActionState } from "./actions.js";
import { quoteLiveShipping } from "./shipping.js";
const clean=(v,m=200)=>String(v==null?"":v).trim().slice(0,m);
function validateEmail(v){const e=clean(v,254).toLowerCase();if(!/^\S+@\S+\.\S+$/.test(e))throw Object.assign(new Error("Adresse email invalide."),{status:400});return e;}
function normalizeShippingAddress(raw,customerName=""){
  const source=raw&&typeof raw==="object"?raw:{};
  const address={
    recipientName:clean(source.recipientName||customerName,120),
    addressLine1:clean(source.addressLine1,160),
    addressLine2:clean(source.addressLine2,160),
    postalCode:clean(source.postalCode,24).toUpperCase(),
    city:clean(source.city,120),
    countryCode:clean(source.countryCode||"FR",2).toUpperCase(),
    phone:clean(source.phone,32)
  };
  if(!address.recipientName)throw Object.assign(new Error("Nom et prénom du destinataire obligatoires."),{status:400,code:"LIVE_SHIPPING_RECIPIENT_REQUIRED"});
  if(!address.addressLine1)throw Object.assign(new Error("Adresse postale obligatoire pour l’envoi."),{status:400,code:"LIVE_SHIPPING_ADDRESS_REQUIRED"});
  if(!address.postalCode)throw Object.assign(new Error("Code postal obligatoire pour l’envoi."),{status:400,code:"LIVE_SHIPPING_POSTAL_CODE_REQUIRED"});
  if(!address.city)throw Object.assign(new Error("Ville obligatoire pour l’envoi."),{status:400,code:"LIVE_SHIPPING_CITY_REQUIRED"});
  if(!/^[A-Z]{2}$/.test(address.countryCode))throw Object.assign(new Error("Code pays invalide."),{status:400,code:"LIVE_SHIPPING_COUNTRY_INVALID"});
  return address;
}
function priorShippingAddress(liveId,email){
  const usable=new Set(["planned","pending","paid","completed","authorized","authorised"]);
  const prior=listLiveCheckouts({liveId}).find((c)=>String(c.customerEmail||"").toLowerCase()===email&&usable.has(String(c.status||"").toLowerCase())&&c.shippingAddress?.addressLine1&&c.shippingAddress?.postalCode&&c.shippingAddress?.city);
  return prior?.shippingAddress||null;
}
function resolveShippingAddress({liveId,email,provided,customerName,required=false}){
  const hasProvided=provided&&typeof provided==="object"&&Object.values(provided).some((v)=>String(v||"").trim());
  const source=hasProvided?provided:priorShippingAddress(liveId,email);
  if(!source&&!required)return null;
  return normalizeShippingAddress(source,customerName);
}
function commissionFor(live,amount){if(live.ownerRole!=="seller")return{platformFee:0,sellerNet:amount,commissionPercent:0};try{const state=getSellerPlanState(live.ownerId),plan=getSellerPlan(state.planId),platformFee=money(getLiveCommissionAmount(state.planId,amount));return{platformFee,sellerNet:money(amount-platformFee),commissionPercent:Number(plan.liveCommissionRate)*100,planId:plan.id};}catch{const percent=5,platformFee=money(amount*percent/100);return{platformFee,sellerNet:money(amount-platformFee),commissionPercent:percent};}}
function sellerPlanShippingCoverage(live,email){
  if(live?.ownerRole!=="seller")return{covered:false,planId:"",buyerLimit:0};
  try{
    const state=getSellerPlanState(live.ownerId);
    if(!state.active)return{covered:false,planId:state.planId||"",buyerLimit:0};
    const eligibleStatuses=new Set(["pending","paid","completed","authorized","authorised"]);
    const priorBuyerIds=listLiveCheckouts({liveId:live.id})
      .filter((checkout)=>eligibleStatuses.has(String(checkout.status||"").toLowerCase()))
      .sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||"")))
      .map((checkout)=>String(checkout.customerEmail||"").trim().toLowerCase())
      .filter(Boolean);
    const plan=getSellerPlan(state.planId);
    return{
      covered:isLiveBuyerShippingPaidByCardoria(state.planId,email,priorBuyerIds),
      planId:state.planId,
      buyerLimit:Number(plan.liveCardoriaShippingBuyerLimit||0)
    };
  }catch{
    return{covered:false,planId:"",buyerLimit:0};
  }
}
function reservedUnits(liveId,productId,excludeKey=""){return listLiveCheckouts({liveId}).filter((c)=>c.productId===productId&&c.idempotencyKey!==excludeKey&&["planned","pending"].includes(c.status)).reduce((n,c)=>n+Math.max(1,Number(c.qty)||1),0);}
function normalizeSpotLabel(value){return clean(value,80);}
function assertEnergySpotAvailable({liveId,productId,rule,spotLabel,excludeKey}){if(rule.breakType!=="energy_game")return"";const label=normalizeSpotLabel(spotLabel);if(!label)throw Object.assign(new Error("Choisissez une énergie disponible avant le paiement."),{status:400});const canonical=(rule.spotLabels||[]).find((item)=>String(item)===label);if(!canonical)throw Object.assign(new Error("Cette énergie ne fait pas partie de l'item sélectionné."),{status:409});const occupied=listLiveCheckouts({liveId}).some((c)=>c.productId===productId&&c.idempotencyKey!==excludeKey&&String(c.spotLabel||"")===canonical&&["planned","pending","paid","completed","authorized","authorised"].includes(String(c.status||"").toLowerCase()));if(occupied)throw Object.assign(new Error(`Le spot ${canonical} est déjà réservé ou vendu.`),{status:409,spotLabel:canonical});return canonical;}
export function planLiveCheckout({liveId,productId,qty,spotLabel,customerEmail,customerName,shippingAddress,requireShippingAddress=false,requestedProvider,requestedAmount}){const live=getLiveSession(liveId);if(!live)throw Object.assign(new Error("Live introuvable."),{status:404});if(live.status!=="live")throw Object.assign(new Error("Ce Live doit être en cours pour accepter un paiement."),{status:409});const route=assertSaleProvider({channel:"live",ownerRole:live.ownerRole,requestedProvider}),actionState=getLiveActionState(live.id),energyBreak=actionState.break?.breakType==="energy_game"&&actionState.break?.status==="running"?actionState.break:null;let product=(live.products||[]).find(i=>i.id===String(productId||""));if(!product&&energyBreak&&String(energyBreak.productId)===String(productId||""))product={id:energyBreak.productId,name:energyBreak.productName||"Jeu de l’énergie",mode:"break",price:energyBreak.pricePerSpot,stock:energyBreak.spots,qty:energyBreak.spots,shippingWeightGrams:Number(energyBreak.shippingWeightGrams||20),virtualProduct:true};if(!product)throw Object.assign(new Error("Produit Live introuvable."),{status:404});let units=Math.max(1,Math.min(20,Math.trunc(Number(qty)||1)));const email=validateEmail(customerEmail),rule=resolveLiveSaleRule({live,product,customerEmail:email});if(rule.breakType==="energy_game")units=1;const provisionalKey=[live.id,product.id,email,units,rule.actionId||rule.kind,normalizeSpotLabel(spotLabel)].join(":"),selectedSpot=assertEnergySpotAvailable({liveId:live.id,productId:product.id,rule,spotLabel,excludeKey:provisionalKey}),idempotencyKey=[live.id,product.id,email,units,rule.actionId||rule.kind,selectedSpot].join(":"),existing=getLiveCheckout(idempotencyKey);if(existing){if(existing.status==="paid")throw Object.assign(new Error("Ce paiement Live a déjà été traité."),{status:409});if(["pending","planned"].includes(existing.status))return existing;}const available=Math.max(0,Number(product.stock||0)-reservedUnits(live.id,product.id,idempotencyKey));if(available<units)throw Object.assign(new Error(`Stock Live insuffisant pour ${product.name}.`),{status:409,available});const itemAmount=assertServerAmount(money(rule.unitPrice)*units,requestedAmount),shipping=quoteLiveShipping({liveId:live.id,customerEmail:email,productId:product.id,qty:units,productOverride:product}),coverage=sellerPlanShippingCoverage(live,email),buyerShippingAmount=coverage.covered?0:shipping.shippingAmount,amount=money(itemAmount+buyerShippingAmount),name=clean(customerName,120)||"Client Live",address=resolveShippingAddress({liveId:live.id,email,provided:shippingAddress,customerName:name,required:requireShippingAddress}),commission=commissionFor(live,itemAmount);return saveLiveCheckout({id:"LCK-"+crypto.randomUUID(),idempotencyKey,liveId:live.id,liveTitle:live.title,ownerRole:live.ownerRole,ownerId:live.ownerId,channel:route.channel,provider:route.provider,productId:product.id,productName:product.name,qty:units,unitPrice:rule.unitPrice,itemAmount,saleKind:rule.kind,actionId:rule.actionId||"",breakType:rule.breakType||"",spotLabel:selectedSpot,shippingAmount:buyerShippingAmount,shippingCostAmount:shipping.shippingAmount,shippingPaidBy:coverage.covered?"cardoria":"buyer",shippingCoveredBySellerPlan:coverage.covered,shippingCoveragePlanId:coverage.planId,shippingCoverageBuyerLimit:coverage.buyerLimit,shippingAlreadyCharged:shipping.alreadyCharged||0,shippingPackId:shipping.pack?.id||"",shippingCarrier:shipping.pack?.carrier||"",shippingWeightGrams:shipping.totalWeightGrams||0,shippingUnitWeightGrams:Number(product.shippingWeightGrams||0),shippingBundled:true,amount,...commission,sellerNet:money(commission.sellerNet+buyerShippingAmount),customerEmail:email,customerName:name,shippingAddress:address,status:"planned",paymentProviderOrderId:"",url:"",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});}
export async function createLiveCheckout(input){const planned=planLiveCheckout(input);return withLiveLock(planned.idempotencyKey,async()=>{const current=getLiveCheckout(planned.id)||planned;if(current.status==="paid")throw Object.assign(new Error("Ce paiement Live a déjà été traité."),{status:409});if(current.url&&current.paymentProviderOrderId&&current.status==="pending")return current;if(current.provider==="sumup"){if(!isSumUpConfigured())throw Object.assign(new Error("Paiement SumUp non configuré côté serveur."),{status:503,provider:"sumup"});const payment=await createSumUpCheckout({orderId:current.id,amount:current.amount,description:`Live Cardoria — ${current.productName}${current.spotLabel?` — ${current.spotLabel}`:""}${current.shippingAmount?` — port ${current.shippingAmount.toFixed(2)} EUR`:""}`,customerEmail:current.customerEmail,redirectUrl:String(input.successUrl||"/live.html"),source:"live_cardoria"});current.status="pending";current.paymentProviderOrderId=payment.checkoutId;current.url=payment.url;current.environment="production";current.updatedAt=new Date().toISOString();return saveLiveCheckout(current);}const paypal=getPayPalMarketplaceConfig();if(!paypal.configured)throw Object.assign(new Error("Paiement PayPal non configuré côté serveur."),{status:503,provider:"paypal"});const payment=await createLivePayPalOrder({checkoutId:current.id,amount:current.amount,sellerId:current.ownerId,description:`Live vendeur Cardoria — ${current.productName}${current.spotLabel?` — ${current.spotLabel}`:""}${current.shippingAmount?` — port ${current.shippingAmount.toFixed(2)} EUR`:""}`,successUrl:String(input.successUrl||"/live.html"),cancelUrl:String(input.cancelUrl||"/live.html"),platformFee:current.platformFee});current.status="pending";current.paymentProviderOrderId=payment.id;current.url=payment.url;current.environment=paypal.environment;current.updatedAt=new Date().toISOString();return saveLiveCheckout(current);});}
