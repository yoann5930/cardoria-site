import test from "node:test";
import assert from "node:assert/strict";
import { buildLiveArchive } from "../backend/lib/live/archive.js";
test("live archive groups paid purchases by buyer for shipping",()=>{
  const archive=buildLiveArchive({id:"LIVE-1",title:"Test",ownerRole:"admin",ownerId:"cardoria",paymentProvider:"sumup",startedAt:"2026-09-16T01:00:00Z",endedAt:"2026-09-16T02:00:00Z"},[
    {id:"C1",customerName:"PikaFan",customerEmail:"pika@example.com",productName:"EV10",qty:2,status:"paid",amount:12,shippingAmount:2.29,shippingWeightGrams:40,shippingCarrier:"La Poste Lettre suivie",shippingPackId:"PACK-LS-100"},
    {id:"C2",customerName:"PikaFan",customerEmail:"pika@example.com",productName:"ME05",qty:1,status:"completed",amount:6,shippingAmount:1.60,shippingWeightGrams:20,shippingCarrier:"La Poste Lettre suivie",shippingPackId:"PACK-LS-100"},
    {id:"C3",customerName:"Other",customerEmail:"other@example.com",productName:"Lot",qty:1,status:"failed",amount:9}
  ]);
  assert.equal(archive.totals.buyers,1);assert.equal(archive.totals.paidPurchases,2);assert.equal(archive.buyers[0].pseudo,"PikaFan");assert.equal(archive.buyers[0].paidPurchases.length,2);assert.equal(archive.buyers[0].totalShippingPaid,3.89);
});
