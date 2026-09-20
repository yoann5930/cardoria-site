import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { __setLiveStoreForTests, __resetLiveStoreForTests } from "../backend/lib/live/sessions.js";
import { __setLiveActionsStoreForTests, __resetLiveActionsStoreForTests } from "../backend/lib/live/actions.js";
import { planLiveCheckout } from "../backend/lib/live/checkout.js";
import { buildLiveArchive } from "../backend/lib/live/archive.js";

function store(){
  const now=new Date().toISOString();
  return {
    sessions:[{
      id:"LIVE-ADDR",title:"Live adresse",ownerRole:"admin",ownerId:"cardoria",ownerEmail:"",
      status:"live",scheduledAt:"",startedAt:now,endedAt:"",
      products:[
        {id:"P1",name:"Booster A",qty:10,stock:10,price:5,mode:"buy_now",durationSeconds:0,shippingWeightGrams:20},
        {id:"P2",name:"Booster B",qty:10,stock:10,price:6,mode:"buy_now",durationSeconds:0,shippingWeightGrams:20}
      ],
      currentLot:"P1",createdAt:now,updatedAt:now
    }],
    checkouts:[],
    adminAccess:[]
  };
}

test("first Live purchase requires a complete postal address",()=>{
  const s=store();__setLiveStoreForTests(s);__setLiveActionsStoreForTests({states:{}});
  try{
    assert.throws(()=>planLiveCheckout({liveId:"LIVE-ADDR",productId:"P1",qty:1,customerEmail:"buyer@example.com",customerName:"Pseudo",requireShippingAddress:true}),/Adresse postale obligatoire/);
  } finally {__resetLiveActionsStoreForTests();__resetLiveStoreForTests();}
});

test("postal address is normalized, persisted and reused for following purchases in same Live",()=>{
  const s=store();__setLiveStoreForTests(s);__setLiveActionsStoreForTests({states:{}});
  try{
    const first=planLiveCheckout({
      liveId:"LIVE-ADDR",productId:"P1",qty:1,customerEmail:"BUYER@EXAMPLE.COM",customerName:"Pseudo",requireShippingAddress:true,
      shippingAddress:{recipientName:"Jean Dupont",addressLine1:"12 rue des Cartes",addressLine2:"Appartement 2",postalCode:"59330",city:"Hautmont",countryCode:"fr",phone:"0600000000"}
    });
    assert.equal(first.shippingAddress.recipientName,"Jean Dupont");
    assert.equal(first.shippingAddress.postalCode,"59330");
    assert.equal(first.shippingAddress.countryCode,"FR");
    const second=planLiveCheckout({liveId:"LIVE-ADDR",productId:"P2",qty:1,customerEmail:"buyer@example.com",customerName:"Pseudo",requireShippingAddress:true});
    assert.deepEqual(second.shippingAddress,first.shippingAddress);
    assert.equal(s.checkouts.length,2);
  } finally {__resetLiveActionsStoreForTests();__resetLiveStoreForTests();}
});

test("archive exposes postal address for shipment preparation",()=>{
  const session=store().sessions[0];
  const address={recipientName:"Jean Dupont",addressLine1:"12 rue des Cartes",addressLine2:"",postalCode:"59330",city:"Hautmont",countryCode:"FR",phone:"0600000000"};
  const archive=buildLiveArchive(session,[{id:"C1",liveId:session.id,customerName:"Pseudo",customerEmail:"buyer@example.com",shippingAddress:address,productName:"Booster A",qty:1,status:"paid",amount:7.29,shippingAmount:2.29,shippingWeightGrams:20,shippingCarrier:"La Poste Lettre suivie",shippingPackId:"PACK-LS-20"}]);
  assert.equal(archive.buyers.length,1);
  assert.deepEqual(archive.buyers[0].shippingAddress,address);
  assert.deepEqual(archive.purchases[0].shippingAddress,address);
});

test("spectator checkout UIs transmit shippingAddress and archive CSV contains postal columns",()=>{
  const viewer=fs.readFileSync("js/cardoria-live-viewer.js","utf8");
  const energy=fs.readFileSync("js/live-energy-spots.js","utf8");
  const helper=fs.readFileSync("js/live-shipping-address.js","utf8");
  const archiveUi=fs.readFileSync("js/live-schedule-archive.js","utf8");
  const page=fs.readFileSync("live.html","utf8");
  assert.match(viewer,/shippingAddress/);
  assert.match(energy,/shippingAddress/);
  assert.match(helper,/recipientName/);
  assert.match(helper,/postalCode/);
  assert.match(archiveUi,/Adresse postale/);
  assert.match(archiveUi,/Code postal/);
  assert.match(page,/live-shipping-address\.js\?v=20260918-postal-address/);
});

test("client profile Point Relais search uses Mondial Relay direct, not Sendcloud",()=>{
  const source=fs.readFileSync("js/client-auth.js","utf8");
  const runtime=fs.readFileSync("backend/public/js/client-auth.js","utf8");
  assert.match(source,/\/api\/mondial-relay\/service-points/);
  assert.equal(source.includes("/api/sendcloud/service-points"),false);
  assert.equal(source,runtime);
});
