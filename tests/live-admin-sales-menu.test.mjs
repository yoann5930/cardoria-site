// Operator UI contract plus real eligibility checks. Authorized is not captured.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { __setLiveStoreForTests, __resetLiveStoreForTests } from "../backend/lib/live/sessions.js";
import { __setLiveActionsStoreForTests, __resetLiveActionsStoreForTests, startBuyerGiveaway, drawGiveaway } from "../backend/lib/live/actions.js";
const read=p=>fs.readFileSync(new URL("../"+p,import.meta.url),"utf8");
const adminHtml=read("admin-live.html"),ui=read("js/live-studio-actions-ui.js"),controls=read("js/live-studio-sales-controls.js"),css=read("css/live-studio-clean.css"),routes=read("backend/routes/live-admin-studio.js");
test("admin sales menu exposes all implemented operator controls",()=>{
  for(const id of["lasBuyNow","lasAuction","lasFlash","lasBreak","lasGame","lasGiveaway","lasGiveBuyer"])assert.ok(ui.includes(`id='${id}'`)||controls.includes(`id="${id}"`)||controls.includes(id),`missing ${id}`);
  assert.match(controls,/lasGroupSales/);assert.match(controls,/lasGroupGames/);assert.match(controls,/lasGroupPromo/);assert.match(controls,/\["lasGiveaway","lasGiveBuyer"\]/);
});
test("buyer giveaway is enabled and subscriber giveaway remains restricted to seller UI",()=>{
  assert.doesNotMatch(ui,/id='lasGiveBuyer' disabled/);
  assert.match(controls,/buyer\.onclick=startBuyerGiveaway/);
  assert.match(controls,/if\(!isAdmin\(\)\)\{follow\.hidden=false/);
  assert.match(controls,/else\{follow\.hidden=true;follow\.style\.display="none"/);
  assert.match(css,/#lasGiveFollow\[hidden\]\{display:none!important\}/);
  assert.doesNotMatch(css,/#lasGiveFollow,#lasGiveBuyer/);
});
test("admin runtime uses cache-busted final sales menu assets",()=>{assert.match(adminHtml,/live-studio-clean\.css\?v=20260918-sales-menu-final/);assert.match(adminHtml,/live-studio-actions-ui\.js\?v=20260923-live-public-journey/);assert.match(adminHtml,/live-studio-sales-controls\.js\?v=20260918-sales-menu-final/);});
test("sales editor keeps destructive rerender loops disabled",()=>{assert.doesNotMatch(ui,/setInterval\s*\(\s*loadEditor/);assert.doesNotMatch(controls,/new MutationObserver/);});
test("buyer giveaway route exists and only uses validated paid buyers",()=>{assert.match(routes,/giveaway\/buyer\/start/);assert.match(routes,/startBuyerGiveaway/);});
test("paid and completed buyers participate once; authorized and pending buyers are excluded",()=>{
  const liveStore={sessions:[{id:"LIVE-TEST",title:"Live Test",ownerRole:"admin",ownerId:"cardoria",ownerEmail:"",status:"live",scheduledAt:"",startedAt:new Date().toISOString(),endedAt:"",products:[{id:"GIFT",name:"Lot cadeau",qty:2,stock:2,price:1,mode:"buy_now",durationSeconds:0,shippingWeightGrams:20}],currentLot:"GIFT",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}],checkouts:[
    {id:"C1",liveId:"LIVE-TEST",customerEmail:"alice@example.com",customerName:"Alice",status:"paid"},
    {id:"C2",liveId:"LIVE-TEST",customerEmail:"alice@example.com",customerName:"Alice",status:"completed"},
    {id:"C3",liveId:"LIVE-TEST",customerEmail:"bob@example.com",customerName:"Bob",status:"authorized"},
    {id:"C4",liveId:"LIVE-TEST",customerEmail:"eve@example.com",customerName:"Eve",status:"pending"},
    {id:"C5",liveId:"LIVE-TEST",customerEmail:"charlie@example.com",customerName:"Charlie",status:"completed"},
    {id:"C6",liveId:"OTHER-LIVE",customerEmail:"other@example.com",customerName:"Other",status:"paid"}
  ],adminAccess:[]};
  __setLiveStoreForTests(liveStore);__setLiveActionsStoreForTests({states:{}});
  try{
    const giveaway=startBuyerGiveaway("LIVE-TEST",{productId:"GIFT",durationSeconds:60});
    assert.equal(giveaway.eligibility,"buyer");assert.equal(giveaway.entries.length,2);
    assert.deepEqual(new Set(giveaway.entries.map(x=>x.email)),new Set(["alice@example.com","charlie@example.com"]));
    assert.equal(giveaway.shippingCustomerAmount,0);assert.equal(giveaway.shippingPayer,"streamer");
    const drawn=drawGiveaway("LIVE-TEST").giveaway;assert.ok(["alice@example.com","charlie@example.com"].includes(drawn.winner.email));assert.equal(liveStore.sessions[0].products[0].stock,1);
  }finally{__resetLiveActionsStoreForTests();__resetLiveStoreForTests();}
});
test("buyer giveaway refuses to start when nobody has a validated payment",()=>{
  __setLiveStoreForTests({sessions:[{id:"LIVE-NO-BUYER",title:"No Buyer",ownerRole:"admin",ownerId:"cardoria",status:"live",products:[{id:"GIFT",name:"Gift",qty:1,stock:1,price:1,mode:"buy_now",durationSeconds:0,shippingWeightGrams:20}],currentLot:"GIFT",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}],checkouts:[{id:"PENDING",liveId:"LIVE-NO-BUYER",customerEmail:"wait@example.com",customerName:"Wait",status:"pending"},{id:"AUTHORIZED",liveId:"LIVE-NO-BUYER",customerEmail:"auth@example.com",status:"authorized"}],adminAccess:[]});__setLiveActionsStoreForTests({states:{}});
  try{assert.throws(()=>startBuyerGiveaway("LIVE-NO-BUYER",{productId:"GIFT"}),/Aucun acheteur payé/);}finally{__resetLiveActionsStoreForTests();__resetLiveStoreForTests();}
});
