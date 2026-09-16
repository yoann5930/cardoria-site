import { readJson } from "../storage.js";
import { getLiveSession, listLiveCheckouts } from "./sessions.js";

const money=(v)=>Math.round((Number(v)||0)*100)/100;
const cleanEmail=(v)=>String(v||"").trim().toLowerCase();
const ACTIVE_SHIPPING_STATUSES=new Set(["pending","paid","completed","authorized","authorised"]);

// Tarifs Cardoria France : base proche du barème Whatnot France 2026,
// légèrement majorée pour absorber les packs d'expédition / consommables.
// Le prix reste monotone pour permettre le regroupement et ne facturer que le complément.
export const LIVE_SHIPPING_PACKS=Object.freeze([
  {id:"PACK-LS-20",maxGrams:20,price:2.29,carrier:"La Poste Lettre suivie"},
  {id:"PACK-LS-100",maxGrams:100,price:3.89,carrier:"La Poste Lettre suivie"},
  {id:"PACK-MR-500",maxGrams:500,price:4.09,carrier:"Mondial Relay"},
  {id:"PACK-MR-1000",maxGrams:1000,price:4.69,carrier:"Mondial Relay"},
  {id:"PACK-MR-2000",maxGrams:2000,price:5.29,carrier:"Mondial Relay"},
  {id:"PACK-MR-3000",maxGrams:3000,price:6.99,carrier:"Mondial Relay"},
  {id:"PACK-MR-4000",maxGrams:4000,price:7.59,carrier:"Mondial Relay"},
  {id:"PACK-MR-5000",maxGrams:5000,price:7.99,carrier:"Mondial Relay"},
  {id:"PACK-MR-7000",maxGrams:7000,price:8.69,carrier:"Mondial Relay"},
  {id:"PACK-MR-10000",maxGrams:10000,price:11.49,carrier:"Mondial Relay"},
  {id:"PACK-MR-15000",maxGrams:15000,price:16.49,carrier:"Mondial Relay"},
  {id:"PACK-MR-20000",maxGrams:20000,price:20.49,carrier:"Mondial Relay"},
  {id:"PACK-MR-25000",maxGrams:25000,price:25.49,carrier:"Mondial Relay"}
]);

export function shippingPackForWeight(weightGrams){
  const grams=Math.max(0,Math.ceil(Number(weightGrams)||0));
  if(!grams)return null;
  const max=LIVE_SHIPPING_PACKS[LIVE_SHIPPING_PACKS.length-1].maxGrams;
  if(grams>max)throw Object.assign(new Error("Poids total du colis Live supérieur à 25 kg. Séparez l'expédition en plusieurs colis."),{status:409,code:"LIVE_SHIPPING_WEIGHT_LIMIT",maxGrams:max});
  return LIVE_SHIPPING_PACKS.find((pack)=>grams<=pack.maxGrams)||null;
}
export function productShippingWeight(product,qty=1){
  const perUnit=Math.max(0,Math.ceil(Number(product?.shippingWeightGrams)||0));
  return perUnit*Math.max(1,Math.trunc(Number(qty)||1));
}
function giveawayWeightForCustomer(live,email){
  const target=cleanEmail(email);if(!target)return 0;
  const store=readJson("live-actions.json",{states:{}}),g=store?.states?.[live.id]?.giveaway;
  if(!g?.winner||cleanEmail(g.winner.email)!==target)return 0;
  const product=(live.products||[]).find((item)=>String(item.id)===String(g.productId));
  return productShippingWeight(product,1);
}
export function quoteLiveShipping({liveId,customerEmail,productId,qty=1,excludeCheckoutId=""}={}){
  const live=getLiveSession(liveId);if(!live)throw Object.assign(new Error("Live introuvable."),{status:404});
  const product=(live.products||[]).find((item)=>String(item.id)===String(productId||""));
  if(!product)throw Object.assign(new Error("Produit Live introuvable."),{status:404});
  const currentWeight=productShippingWeight(product,qty);
  if(!currentWeight)return{shippingAmount:0,alreadyCharged:0,totalWeightGrams:0,currentWeightGrams:0,pack:null,bundled:true};
  const email=cleanEmail(customerEmail);
  const prior=listLiveCheckouts({liveId:live.id}).filter((c)=>
    c.id!==excludeCheckoutId&&cleanEmail(c.customerEmail)===email&&ACTIVE_SHIPPING_STATUSES.has(String(c.status||"").toLowerCase())
  );
  let priorWeight=0,alreadyCharged=0;
  for(const checkout of prior){
    const priorProduct=(live.products||[]).find((item)=>String(item.id)===String(checkout.productId));
    priorWeight+=productShippingWeight(priorProduct,checkout.qty);
    alreadyCharged+=Math.max(0,Number(checkout.shippingAmount)||0);
  }
  const giveawayWeight=giveawayWeightForCustomer(live,email);
  const totalWeight=priorWeight+currentWeight+giveawayWeight;
  const pack=shippingPackForWeight(totalWeight);
  const target=money(pack?.price||0),charged=money(alreadyCharged),increment=money(Math.max(0,target-charged));
  return{shippingAmount:increment,alreadyCharged:charged,totalShippingTarget:target,totalWeightGrams:totalWeight,currentWeightGrams:currentWeight,giveawayWeightGrams:giveawayWeight,pack,bundled:true};
}
export function giveawayShippingPolicy(){return{participantPays:0,winnerPays:0,withoutPurchase:"streamer",withPurchase:"bundle_with_first_purchase",subsequentPurchases:"increment_only_if_pack_changes"};}
