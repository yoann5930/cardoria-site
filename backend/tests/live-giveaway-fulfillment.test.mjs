import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

test("giveaway awards, cumulative postage and private fulfillment",async t=>{
  assert.equal(process.env.NODE_ENV,"test");
  const cwd=process.cwd(),dir=await mkdtemp(path.join(os.tmpdir(),"cardoria-giveaways-"));process.chdir(dir);
  const oldLetter=process.env.SENDCLOUD_LETTER_CARRIER_CODE;process.env.SENDCLOUD_LETTER_CARRIER_CODE="test-letter-carrier";
  let server,db;const users=[];
  try{
    const {default:express}=await import("express");
    const {migrateAuth}=await import("../lib/auth/migrate.js");migrateAuth();
    const {getDb}=await import("../lib/engine/database.js");db=getDb();
    const {createUser,updateClientProfile}=await import("../lib/auth/users.js");
    const {createSession}=await import("../lib/auth/session.js");
    const sessions=await import("../lib/live/sessions.js"),actions=await import("../lib/live/actions.js");
    const {planLiveCheckout}=await import("../lib/live/checkout.js");
    const shipping=await import("../lib/live/shipping.js"),fulfillment=await import("../lib/live/shipments.js");
    const {readJson,writeJson}=await import("../lib/storage.js");
    const {default:router}=await import("../routes/live-actions.js");
    const suffix=crypto.randomUUID();
    function account(name){const user=createUser({email:`${name}-${suffix}@cardoria.invalid`,password:"Test-account-password-123!",name,role:"client"});users.push(user.id);return{...user,token:createSession(user.id).token};}
    const alice=account("Alice"),bob=account("Bob");
    const address={recipientName:"Alice Real Name",addressLine1:"1 rue de Test",postalCode:"59000",city:"Lille",countryCode:"FR"};
    const relay={id:"12345",name:"Test point",postalCode:"59000",city:"Lille",countryCode:"FR",carrierCode:"mondial_relay"};
    for(const user of[alice,bob])updateClientProfile(user.id,{name:user.name,addressLine1:address.addressLine1,postalCode:address.postalCode,city:address.city,country:"FR",relay});
    const actor={role:"admin",id:"test-admin"};let live,store,actionStore;
    function setup(){
      store={sessions:[],checkouts:[],adminAccess:[]};actionStore={states:{}};sessions.__setLiveStoreForTests(store);actions.__setLiveActionsStoreForTests(actionStore);
      live=sessions.createLiveSession({title:"Giveaway fulfillment",ownerRole:"admin",ownerId:"cardoria",actor,products:[
        {id:"G1",name:"Gift one",price:0,mode:"giveaway",qty:10,stock:10,shippingWeightGrams:200},
        {id:"G2",name:"Gift two",price:0,mode:"giveaway",qty:10,stock:10,shippingWeightGrams:300},
        {id:"A",name:"Six euro lot",price:6,mode:"buy_now",qty:10,stock:10,shippingWeightGrams:20},
        {id:"B",name:"Five euro lot",price:5,mode:"buy_now",qty:10,stock:10,shippingWeightGrams:20},
        {id:"C",name:"Two euro lot",price:2,mode:"buy_now",qty:10,stock:10,shippingWeightGrams:20}
      ]});sessions.setLiveStatus(live.id,"live",actor,{adminOverride:true});
    }
    function award(user,productId="G1"){
      actions.startGiveaway(live.id,{productId});actions.enterGiveaway(live.id,{email:user.email,name:user.name});return actions.drawGiveaway(live.id).giveaway;
    }
    function purchase(productId,extra={}){return planLiveCheckout({liveId:live.id,productId,qty:1,customerId:alice.id,customerEmail:alice.email,customerName:"Pseudo",shippingAddress:address,servicePoint:relay,...extra});}
    const app=express();app.use(express.json());app.use("/api/live/actions",router);
    server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
    const base=`http://127.0.0.1:${server.address().port}/api/live/actions`;
    async function post(body,token){const r=await fetch(`${base}/${live.id}/giveaway/enter`,{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};}

    await t.test("all successive awards persist with one record per draw, not just the last winner",()=>{
      setup();const first=award(alice,"G1"),second=award(alice,"G2");actions.drawGiveaway(live.id);const third=award(bob,"G1");
      const all=actions.getLiveGiveawayAwards(live.id);assert.equal(all.length,3);
      assert.deepEqual(all.map(a=>a.giveawayId),[first.id,second.id,third.id]);
      assert.equal(actions.getLiveGiveawayAwards(live.id,{customerEmail:alice.email}).length,2);
      assert.equal(shipping.giveawayWeightForCustomer(live,alice.email),500);
      assert.deepEqual(new Set(fulfillment.liveShipmentRecipientEmails(live.id)),new Set([alice.email,bob.email]));
      const copy=actions.getLiveGiveawayAwards(live.id);copy[0].winner.email="changed";assert.equal(actions.getLiveGiveawayAwards(live.id)[0].winner.email,alice.email);
    });
    await t.test("award names and weights survive later lot edits",()=>{
      setup();award(alice,"G1");
      sessions.updateLiveSession(live.id,{products:sessions.getLiveSession(live.id).products.map(p=>p.id==="G1"?{...p,name:"Edited",shippingWeightGrams:900}:p)},actor,{adminOverride:true});
      assert.equal(actions.getLiveGiveawayAwards(live.id)[0].productName,"Gift one");assert.equal(shipping.giveawayWeightForCustomer(live,alice.email),200);
    });
    await t.test("award ledger survives managed-storage round trip",()=>{
      setup();award(alice,"G1");award(bob,"G2");
      writeJson("live-actions.json",structuredClone(actionStore));actions.__resetLiveActionsStoreForTests();
      assert.equal(actions.getLiveGiveawayAwards(live.id).length,2);assert.equal(readJson("live-actions.json",{}).states[live.id].giveawayAwards.length,2);
    });
    await t.test("legacy visible winner is retained without inventing an unknown weight",()=>{
      setup();actionStore.states[live.id]={giveaway:{id:"LEGACY",productId:"G1",productName:"Legacy gift",status:"ended",stockConsumed:true,winner:{email:alice.email,name:"Alice"}},energyTypesByProduct:{},chat:[]};
      const old=actions.getLiveGiveawayAwards(live.id)[0];assert.equal(old.shippingWeightGrams,null);
      actions.startGiveaway(live.id,{productId:"G2"});assert.equal(actions.getLiveGiveawayAwards(live.id).length,1);
      assert.throws(()=>shipping.giveawayWeightForCustomer(live,alice.email),{code:"SHIPMENT_WEIGHT_REQUIRED"});
    });
    await t.test("6 then 5 EUR after a gift reaches 11 EUR and locks subsequent buyer postage",()=>{
      setup();award(alice,"G1");award(bob,"G2");
      const a=purchase("A");assert.equal(a.shippingAmount,0);assert.equal(a.shippingPaidBy,"streamer");assert.equal(a.shippingItemTotalWithPurchase,6);
      sessions.saveLiveCheckout({...a,status:"paid"});
      const b=purchase("B");assert.equal(b.shippingPaidItemTotalBefore,6);assert.equal(b.shippingItemTotalWithPurchase,11);assert.equal(b.shippingAmount,4.09);assert.equal(b.shippingPaidBy,"buyer");
      sessions.saveLiveCheckout({...b,status:"paid"});
      const c=purchase("C");assert.equal(c.shippingAmount,0);assert.equal(c.shippingChargeLockedForLive,true);
    });
    await t.test("shipping already paid by an ordinary buyer is credited at the cumulative threshold",()=>{
      setup();const a=purchase("A");assert.equal(a.shippingAmount,2.29);sessions.saveLiveCheckout({...a,status:"paid"});
      const b=purchase("B");assert.equal(b.shippingItemTotalWithPurchase,11);assert.equal(b.shippingAmount,1.6);assert.equal(b.shippingBuyerPostageAlreadyPaid,2.29);
      sessions.saveLiveCheckout({...b,status:"paid"});assert.equal(purchase("C").shippingAmount,0);
    });
    await t.test("grouped shipment contains every gift and preserves the real recipient name",()=>{
      setup();award(alice,"G1");award(alice,"G2");award(bob,"G1");
      const a=purchase("A");sessions.saveLiveCheckout({...a,status:"paid"});
      const group=fulfillment.prepareLiveShipmentGroup(live.id,alice.email);
      assert.equal(group.gifts.length,2);assert.equal(group.weight,520);assert.equal(group.buyerName,"Alice Real Name");assert.equal(group.recipient.recipientName,"Alice Real Name");assert.equal(group.payer,"streamer");
      assert.equal(fulfillment.prepareLiveShipmentGroup(live.id,bob.email).weight,200);
    });
    await t.test("unresolved payment states prevent a premature shipment",()=>{
      for(const status of["creating","pending","authorized","authorised","reconciliation_required"]){
        setup();award(alice);const a=purchase("A");sessions.saveLiveCheckout({...a,status});
        assert.throws(()=>fulfillment.prepareLiveShipmentGroup(live.id,alice.email),{code:"LIVE_PAYMENT_UNSETTLED"});
      }
    });
    await t.test("public spectator API never leaks the private award ledger or email addresses",async()=>{
      setup();award(alice);award(bob,"G2");
      const r=await fetch(`${base}/${live.id}/state`),body=await r.json();assert.equal(r.status,200);
      assert.equal("giveawayAwards" in body.state,false);assert.equal(JSON.stringify(body).includes(alice.email),false);assert.equal(JSON.stringify(body).includes(bob.email),false);
    });
    await t.test("buyer giveaway rejects impersonation, unpaid buyers and purchases from another live",async()=>{
      setup();const a=purchase("A");sessions.saveLiveCheckout({...a,status:"paid"});actions.startBuyerGiveaway(live.id,{productId:"G1"});
      assert.equal((await post({email:alice.email},undefined)).status,401);
      assert.equal((await post({email:alice.email},bob.token)).status,403);
      sessions.saveLiveCheckout({id:"OTHER-LIVE",liveId:"OTHER",customerEmail:bob.email,status:"paid",itemAmount:20});
      assert.equal((await post({email:bob.email},bob.token)).status,403);
      const allowed=await post({email:bob.email,name:"Fake"},alice.token);assert.equal(allowed.status,200);assert.equal(allowed.body.duplicate,true);assert.equal(allowed.body.entry.name,"Pseudo");
      assert.equal(actions.getLiveActionState(live.id).giveaway.entries.length,1);
    });
    await t.test("buyer losing paid eligibility cannot win the later draw",()=>{
      setup();const a=purchase("A");sessions.saveLiveCheckout({...a,status:"paid"});actions.startBuyerGiveaway(live.id,{productId:"G1"});sessions.saveLiveCheckout({...a,status:"refunded"});
      assert.throws(()=>actions.drawGiveaway(live.id),/Aucun participant/);assert.equal(actions.getLiveGiveawayAwards(live.id).length,0);
    });
    await t.test("label purchase remains disabled during these tests",async()=>{
      setup();award(alice);sessions.setLiveStatus(live.id,"ended",actor,{adminOverride:true});
      assert.equal(fulfillment.liveLabelPurchasesEnabled(),false);
      await assert.rejects(fulfillment.createLiveShipment({liveId:live.id,buyerEmail:alice.email}),{code:"MONDIAL_RELAY_LABELS_NOT_ACTIVATED"});
    });
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    if(db)for(const id of users){db.prepare("DELETE FROM auth_sessions WHERE user_id=?").run(id);db.prepare("DELETE FROM auth_users WHERE id=?").run(id);}
    if(oldLetter===undefined)delete process.env.SENDCLOUD_LETTER_CARRIER_CODE;else process.env.SENDCLOUD_LETTER_CARRIER_CODE=oldLetter;
    process.chdir(cwd);await rm(dir,{recursive:true,force:true});
  }
});
