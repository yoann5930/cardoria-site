import test from "node:test";
import assert from "node:assert/strict";
import { __setLiveStoreForTests, __resetLiveStoreForTests, applyLivePaymentStatus, createLiveSession, getLiveSession, setLiveStatus } from "../lib/live/sessions.js";
import { __setLiveActionsStoreForTests, __resetLiveActionsStoreForTests, drawGiveaway, enterGiveaway, getLiveActionState, startAuction, stopAuction, placeAuctionBid, startFlashSale, startBreak, startGiveaway } from "../lib/live/actions.js";
import { planLiveCheckout } from "../lib/live/checkout.js";

const admin={role:"admin",id:"admin",email:"admin@test.local"};
function setup(ownerRole="admin",ownerId="cardoria"){
  __setLiveStoreForTests({sessions:[],checkouts:[],adminAccess:[]});
  __setLiveActionsStoreForTests({states:{}});
  const actor=ownerRole==="admin"?admin:{role:"seller",id:ownerId,sellerId:ownerId,email:"seller@test.local"};
  const live=createLiveSession({title:"Sale actions",ownerRole,ownerId,actor,products:[
    {id:"BUY",name:"Achat",price:10,stock:10,qty:10,mode:"buy_now"},
    {id:"AUC",name:"Enchere",price:5,stock:1,qty:1,mode:"auction"},
    {id:"FLASH",name:"Flash",price:10,stock:5,qty:5,mode:"flash"},
    {id:"BREAK",name:"Break",price:8,stock:12,qty:12,mode:"break"},
    {id:"GIV",name:"Giveaway",price:0,stock:1,qty:1,mode:"giveaway"}
  ]});
  setLiveStatus(live.id,"live",actor,{adminOverride:ownerRole==="admin"});
  return live.id;
}
function teardown(){__resetLiveActionsStoreForTests();__resetLiveStoreForTests();}

test("buy now uses server product price and blocks forged amount",()=>{const id=setup();try{const c=planLiveCheckout({liveId:id,productId:"BUY",qty:1,customerEmail:"buyer@test.local"});assert.equal(c.amount,10);assert.equal(c.saleKind,"buy_now");assert.equal(c.provider,"sumup");assert.equal(c.platformFee,0);assert.throws(()=>planLiveCheckout({liveId:id,productId:"BUY",qty:1,customerEmail:"other@test.local",requestedAmount:1}),e=>e.status===403);}finally{teardown();}});

test("pending and planned checkouts reserve stock against overselling",()=>{const id=setup();try{const first=planLiveCheckout({liveId:id,productId:"BUY",qty:7,customerEmail:"one@test.local"});assert.equal(first.qty,7);assert.throws(()=>planLiveCheckout({liveId:id,productId:"BUY",qty:4,customerEmail:"two@test.local"}),e=>e.status===409);const second=planLiveCheckout({liveId:id,productId:"BUY",qty:3,customerEmail:"two@test.local"});assert.equal(second.qty,3);applyLivePaymentStatus(first.id,"failed");const released=planLiveCheckout({liveId:id,productId:"BUY",qty:7,customerEmail:"three@test.local"});assert.equal(released.qty,7);}finally{teardown();}});

test("flash uses active flash price, not catalog price",()=>{const id=setup();try{startFlashSale(id,{productId:"FLASH",price:6.5,durationSeconds:60});const c=planLiveCheckout({liveId:id,productId:"FLASH",qty:1,customerEmail:"flash@test.local"});assert.equal(c.amount,6.5);assert.equal(c.unitPrice,6.5);assert.equal(c.saleKind,"flash");assert.throws(()=>planLiveCheckout({liveId:id,productId:"FLASH",qty:1,customerEmail:"badflash@test.local",requestedAmount:10}),e=>e.status===403);}finally{teardown();}});

test("break checkout uses per-spot price and paid stock updates progress",()=>{const id=setup();try{startBreak(id,{productId:"BREAK",spots:12,pricePerSpot:3});const c=planLiveCheckout({liveId:id,productId:"BREAK",qty:2,customerEmail:"break@test.local"});assert.equal(c.unitPrice,3);assert.equal(c.amount,6);assert.equal(c.saleKind,"break");applyLivePaymentStatus(c.id,"paid");const state=getLiveActionState(id);assert.equal(state.break.soldSpots,2);assert.equal(state.break.remainingSpots,10);}finally{teardown();}});

test("auction cannot be paid while running and only winner can pay final price",()=>{const id=setup();try{startAuction(id,{productId:"AUC",startPrice:5,durationSeconds:30,mode:"standard"});placeAuctionBid(id,{amount:7,bidderName:"Alice",bidderEmail:"alice@test.local"});assert.throws(()=>planLiveCheckout({liveId:id,productId:"AUC",qty:1,customerEmail:"alice@test.local"}),e=>e.status===409);stopAuction(id);assert.throws(()=>planLiveCheckout({liveId:id,productId:"AUC",qty:1,customerEmail:"bob@test.local"}),e=>e.status===403);const winner=planLiveCheckout({liveId:id,productId:"AUC",qty:1,customerEmail:"alice@test.local"});assert.equal(winner.amount,7);assert.equal(winner.saleKind,"auction");}finally{teardown();}});

test("giveaway cannot create payment and drawing consumes stock once",()=>{const id=setup();try{startGiveaway(id,{productId:"GIV",durationSeconds:60});enterGiveaway(id,{name:"Alice",email:"alice@test.local"});assert.throws(()=>planLiveCheckout({liveId:id,productId:"GIV",qty:1,customerEmail:"give@test.local"}),e=>e.status===409);const draw=drawGiveaway(id);assert.ok(draw.giveaway.winner);assert.equal(getLiveSession(id).products.find(p=>p.id==="GIV").stock,0);assert.equal(drawGiveaway(id).duplicate,true);assert.equal(getLiveSession(id).products.find(p=>p.id==="GIV").stock,0);}finally{teardown();}});

test("seller action sale stays PayPal with plan commission",()=>{const id=setup("seller","SEL-ACTION");try{startFlashSale(id,{productId:"FLASH",price:9,durationSeconds:60});const c=planLiveCheckout({liveId:id,productId:"FLASH",qty:1,customerEmail:"sellerbuyer@test.local"});assert.equal(c.provider,"paypal");assert.ok(c.platformFee>0);assert.equal(c.amount,9);}finally{teardown();}});
