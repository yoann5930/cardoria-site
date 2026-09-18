import { readJson, writeJson } from "../storage.js";
import { getLiveSession, listLiveCheckouts } from "./sessions.js";

const STORE_KEY="live-archives.json";
const PAID=new Set(["paid","completed","authorized","authorised"]);
const money=(v)=>Math.round((Number(v)||0)*100)/100;
const clean=(v,m=300)=>String(v==null?"":v).trim().slice(0,m);
function load(){const d=readJson(STORE_KEY,{archives:[]});if(!Array.isArray(d.archives))d.archives=[];return d;}
function save(d){writeJson(STORE_KEY,d);}
function buyerKey(c){return clean(c.customerEmail,254).toLowerCase()||clean(c.customerName,120).toLowerCase()||"acheteur-inconnu";}
export function buildLiveArchive(session,checkouts=[]){
  if(!session)throw Object.assign(new Error("Live introuvable."),{status:404});
  const rows=(checkouts||[]).map((c)=>({
    id:c.id,
    checkoutId:c.id,
    pseudo:clean(c.customerName,120)||clean(c.customerEmail,254)||"Client Live",
    customerName:clean(c.customerName,120),
    customerEmail:clean(c.customerEmail,254).toLowerCase(),
    shippingAddress:c.shippingAddress&&typeof c.shippingAddress==="object"?{recipientName:clean(c.shippingAddress.recipientName,120),addressLine1:clean(c.shippingAddress.addressLine1,160),addressLine2:clean(c.shippingAddress.addressLine2,160),postalCode:clean(c.shippingAddress.postalCode,24),city:clean(c.shippingAddress.city,120),countryCode:clean(c.shippingAddress.countryCode,2),phone:clean(c.shippingAddress.phone,32)}:null,
    productId:clean(c.productId,120),
    productName:clean(c.productName,180),
    qty:Math.max(1,Number(c.qty)||1),
    spotLabel:clean(c.spotLabel,120),
    status:clean(c.status,40).toLowerCase(),
    paid:PAID.has(clean(c.status,40).toLowerCase()),
    unitPrice:money(c.unitPrice),
    itemAmount:money(c.itemAmount),
    shippingAmount:money(c.shippingAmount),
    shippingPackId:clean(c.shippingPackId,80),
    shippingCarrier:clean(c.shippingCarrier,120),
    shippingWeightGrams:Math.max(0,Number(c.shippingWeightGrams)||0),
    amount:money(c.amount),
    provider:clean(c.provider||c.paymentProvider,40),
    paymentProviderOrderId:clean(c.paymentProviderOrderId,160),
    paymentProviderTransactionId:clean(c.paymentProviderTransactionId,160),
    createdAt:c.createdAt||"",
    updatedAt:c.updatedAt||""
  }));
  const map=new Map();
  for(const row of rows){
    const key=buyerKey(row);
    if(!map.has(key))map.set(key,{pseudo:row.pseudo,customerName:row.customerName,customerEmail:row.customerEmail,shippingAddress:row.shippingAddress,purchases:[],paidPurchases:[],totalPaid:0,totalShippingPaid:0,totalWeightGrams:0,shippingCarrier:"",shippingPackId:""});
    const buyer=map.get(key);buyer.purchases.push(row);if(!buyer.shippingAddress&&row.shippingAddress)buyer.shippingAddress=row.shippingAddress;
    if(row.paid){buyer.paidPurchases.push(row);buyer.totalPaid=money(buyer.totalPaid+row.amount);buyer.totalShippingPaid=money(buyer.totalShippingPaid+row.shippingAmount);buyer.totalWeightGrams+=row.shippingWeightGrams;if(row.shippingCarrier)buyer.shippingCarrier=row.shippingCarrier;if(row.shippingPackId)buyer.shippingPackId=row.shippingPackId;}
  }
  const buyers=[...map.values()].filter((b)=>b.paidPurchases.length).sort((a,b)=>String(a.pseudo).localeCompare(String(b.pseudo),"fr"));
  const paidRows=rows.filter((r)=>r.paid);
  return{
    id:"ARCH-"+session.id,
    liveId:session.id,
    title:session.title,
    ownerRole:session.ownerRole,
    ownerId:session.ownerId,
    paymentProvider:session.paymentProvider,
    scheduledAt:session.scheduledAt||"",
    startedAt:session.startedAt||"",
    endedAt:session.endedAt||new Date().toISOString(),
    archivedAt:new Date().toISOString(),
    buyers,
    purchases:rows,
    totals:{buyers:buyers.filter((b)=>b.paidPurchases.length).length,checkouts:rows.length,paidPurchases:paidRows.length,paidAmount:money(paidRows.reduce((s,r)=>s+r.amount,0)),shippingAmount:money(paidRows.reduce((s,r)=>s+r.shippingAmount,0))}
  };
}
export function archiveLiveSession(liveId){
  const session=getLiveSession(liveId);if(!session)throw Object.assign(new Error("Live introuvable."),{status:404});
  const archive=buildLiveArchive(session,listLiveCheckouts({liveId:session.id}));
  const d=load(),i=d.archives.findIndex((a)=>a.liveId===session.id);
  if(i>=0)d.archives[i]=archive;else d.archives.unshift(archive);
  d.archives=d.archives.slice(0,1000);save(d);return archive;
}
export function listLiveArchives({ownerId,ownerRole}={}){let a=load().archives||[];if(ownerId)a=a.filter((x)=>String(x.ownerId)===String(ownerId));if(ownerRole)a=a.filter((x)=>x.ownerRole===ownerRole);return a;}
export function getLiveArchive(id){return(load().archives||[]).find((a)=>a.id===String(id||"")||a.liveId===String(id||""))||null;}
