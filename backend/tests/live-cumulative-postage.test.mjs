import test from "node:test";
import assert from "node:assert/strict";
import { livePurchaseProgress, quoteLivePostage } from "../lib/live/shipping-billing.js";

const base={liveId:"L1",ownerId:"S1",customerId:"A",customerEmail:"alice@example.invalid",currentItemAmount:0,shippingTarget:4.09,checkouts:[]};
const paid=(id,itemAmount,extra={})=>({id,liveId:"L1",ownerId:"S1",customerId:"A",customerEmail:"alice@example.invalid",status:"paid",itemAmount,shippingAmount:0,...extra});

test("giveaway with a first 6 EUR purchase keeps postage on the liveur",()=>{
  const q=quoteLivePostage({...base,giveawayWinner:true,currentItemAmount:6});
  assert.equal(q.cumulativeItems,6);assert.equal(q.buyerAmount,0);assert.equal(q.payer,"streamer");assert.equal(q.locked,false);
});
test("6 EUR paid plus 5 EUR reaches the cumulative threshold at 11 EUR",()=>{
  const q=quoteLivePostage({...base,giveawayWinner:true,currentItemAmount:5,checkouts:[paid("C1",6)]});
  assert.equal(q.priorPaidItems,6);assert.equal(q.cumulativeItems,11);assert.equal(q.qualifyingGiveawayPurchase,true);
  assert.equal(q.buyerAmount,4.09);assert.equal(q.payer,"buyer");assert.equal(q.locked,true);
});
test("after paid threshold purchase later weights never create more buyer postage",()=>{
  const q=quoteLivePostage({...base,giveawayWinner:true,currentItemAmount:25,shippingTarget:25.49,checkouts:[paid("C1",6),paid("C2",5,{shippingAmount:4.09})]});
  assert.equal(q.buyerAmount,0);assert.equal(q.locked,true);assert.equal(q.cumulativeItems,36);
});
test("exactly 10 EUR qualifies, including cent-level arithmetic",()=>{
  const q=quoteLivePostage({...base,giveawayWinner:true,currentItemAmount:0.01,checkouts:[paid("C1",9.99)]});
  assert.equal(q.cumulativeItems,10);assert.equal(q.qualifyingGiveawayPurchase,true);assert.equal(q.buyerAmount,4.09);
  assert.equal(quoteLivePostage({...base,giveawayWinner:true,currentItemAmount:3.33,checkouts:[paid("A",3.33),paid("B",3.33)]}).qualifyingGiveawayPurchase,false);
});
test("completed purchases count like paid, and a new live resets the threshold",()=>{
  const completed=quoteLivePostage({...base,currentItemAmount:0.01,checkouts:[paid("C1",9.99,{status:"completed"})]});
  assert.equal(completed.cumulativeItems,10);assert.equal(completed.locked,true);
  const otherLive=quoteLivePostage({...base,liveId:"L2",currentItemAmount:6,checkouts:[paid("C1",20)]});
  assert.equal(otherLive.cumulativeItems,6);assert.equal(otherLive.thresholdReachedBeforePurchase,false);
});
test("postage and the value of a free gift never count toward the 10 EUR threshold",()=>{
  const q=quoteLivePostage({...base,giveawayWinner:true,currentItemAmount:0,checkouts:[paid("C1",6,{shippingAmount:4.09,amount:10.09}),paid("G1",0,{productValue:100})]});
  assert.equal(q.cumulativeItems,6);assert.equal(q.qualifyingGiveawayPurchase,false);assert.equal(q.buyerAmount,0);
});
test("pending, failed, cancelled, refunded and merely authorized purchases are excluded",()=>{
  const invalid=["planned","creating","pending","authorized","authorised","failed","cancelled","refunded","reconciliation_required"].map((status,i)=>paid(`C${i}`,100,{status}));
  const q=quoteLivePostage({...base,giveawayWinner:true,currentItemAmount:5,checkouts:invalid});
  assert.equal(q.priorPaidItems,0);assert.equal(q.cumulativeItems,5);assert.equal(q.payer,"streamer");
});
test("another live, seller or client never contributes to this buyer's cumulative spend",()=>{
  const checkouts=[paid("L",100,{liveId:"L2"}),paid("S",100,{ownerId:"S2"}),paid("B",100,{customerId:"B"}),paid("E",100,{customerId:"",customerEmail:"bob@example.invalid"})];
  assert.equal(quoteLivePostage({...base,giveawayWinner:true,currentItemAmount:5,checkouts}).cumulativeItems,5);
});
test("postage already paid is deducted, not charged a second time",()=>{
  const q=quoteLivePostage({...base,currentItemAmount:5,checkouts:[paid("C1",6,{shippingAmount:2.29})]});
  assert.equal(q.buyerPostageAlreadyPaid,2.29);assert.equal(q.buyerAmount,1.8);assert.equal(q.locked,true);
});
test("ordinary first purchase bears postage; cumulative threshold caps all later purchases",()=>{
  const first=quoteLivePostage({...base,currentItemAmount:3});assert.equal(first.buyerAmount,4.09);assert.equal(first.locked,false);
  const crossing=quoteLivePostage({...base,currentItemAmount:7,checkouts:[paid("C1",3,{shippingAmount:4.09})]});
  assert.equal(crossing.buyerAmount,0);assert.equal(crossing.cumulativeItems,10);assert.equal(crossing.locked,true);
  const later=quoteLivePostage({...base,currentItemAmount:1,shippingTarget:11.49,checkouts:[paid("C1",3,{shippingAmount:4.09}),paid("C2",7)]});
  assert.equal(later.buyerAmount,0);
});
test("a cancelled crossing purchase does not unlock free postage",()=>{
  const q=quoteLivePostage({...base,giveawayWinner:true,currentItemAmount:1,checkouts:[paid("C1",6),paid("C2",5,{status:"cancelled",shippingAmount:4.09})]});
  assert.equal(q.cumulativeItems,7);assert.equal(q.locked,false);assert.equal(q.payer,"streamer");
});
test("Cardoria seller-pack coverage remains distinct from a buyer payment",()=>{
  const q=quoteLivePostage({...base,planCovered:true,currentItemAmount:6});
  assert.equal(q.buyerAmount,0);assert.equal(q.payer,"cardoria");assert.equal(q.buyerPostageAlreadyPaid,0);
  const later=quoteLivePostage({...base,currentItemAmount:1,checkouts:[paid("C1",6,{shippingCoveredBySellerPlan:true})]});assert.equal(later.payer,"cardoria");
});
test("duplicate records or the excluded current checkout do not inflate the threshold",()=>{
  const c=paid("C1",6);
  assert.equal(livePurchaseProgress({...base,checkouts:[c,c],currentItemAmount:1}).cumulativeItemCents,700);
  assert.equal(livePurchaseProgress({...base,checkouts:[c],excludeCheckoutId:"C1",currentItemAmount:1}).cumulativeItemCents,100);
});
test("invalid negative or non-finite amounts fail rather than corrupt postage totals",()=>{
  for(const value of[-1,NaN,Infinity,"not a number"])assert.throws(()=>quoteLivePostage({...base,currentItemAmount:value}),{code:"LIVE_AMOUNT_INVALID"});
});
