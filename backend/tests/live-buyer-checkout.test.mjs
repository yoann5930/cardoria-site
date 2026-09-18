import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

// Run only in CI/test: use real local sessions and HTTP routes, never a provider.
test("Live checkout identity and lifecycle regressions", async t => {
  assert.equal(process.env.NODE_ENV, "test", "This suite must run with NODE_ENV=test");
  const directory=await mkdtemp(path.join(os.tmpdir(),"cardoria-buyer-checkout-"));
  const cwd=process.cwd();process.chdir(directory);
  let server,db;
  const userIds=[];
  try {
    const {default:express}=await import("express");
    const {migrateAuth}=await import("../lib/auth/migrate.js");
    const {createUser}=await import("../lib/auth/users.js");
    const {createSession}=await import("../lib/auth/session.js");
    const database=await import("../lib/engine/database.js");db=database.getDb();migrateAuth();
    const sessions=await import("../lib/live/sessions.js");
    const actions=await import("../lib/live/actions.js");
    const {planLiveCheckout}=await import("../lib/live/checkout.js");
    const {setSellerPlan}=await import("../lib/subscriptions/seller-plans.js");
    const {default:router}=await import("../routes/live.js");
    const suffix=crypto.randomUUID();
    function account(name,role="client"){
      const user=createUser({email:`${name}-${suffix}@cardoria.invalid`,password:"Test-only-password-123!",role,name});
      userIds.push(user.id);return{...user,token:createSession(user.id).token};
    }
    const alice=account("Alice"),bob=account("Bob"),admin=account("Admin","admin");
    const actor={role:"admin",id:admin.id,email:admin.email};
    let live,store;
    function setup(ownerRole="admin",ownerId="cardoria"){
      store={sessions:[],checkouts:[],adminAccess:[]};
      sessions.__setLiveStoreForTests(store);actions.__setLiveActionsStoreForTests({states:{}});
      live=sessions.createLiveSession({title:"Identity test",ownerRole,ownerId,actor,products:[
        {id:"A",name:"Lot A",mode:"buy_now",price:12,qty:20,stock:20,shippingWeightGrams:20},
        {id:"B",name:"Lot B",mode:"buy_now",price:14,qty:20,stock:20,shippingWeightGrams:20}
      ]});
      sessions.setLiveStatus(live.id,"live",actor,{adminOverride:true});
    }
    const app=express();app.use(express.json());app.use("/api/live",router);
    server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
    const base=`http://127.0.0.1:${server.address().port}`;
    async function post(endpoint,body,token){
      const response=await fetch(base+endpoint,{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
      return{status:response.status,body:await response.json()};
    }
    const address={recipientName:"Alice Test",addressLine1:"1 rue de Test",postalCode:"59000",city:"Lille",countryCode:"FR"};
    const input=(productId="A",extra={})=>({liveId:live.id,productId,qty:1,customerId:alice.id,customerEmail:alice.email,customerName:alice.name,shippingAddress:address,...extra});

    await t.test("anonymous, forged, inactive and non-client sessions cannot plan or pay",async()=>{
      setup();
      for(const endpoint of["/api/live/checkout/plan","/api/live/checkout"]){
        for(const token of[undefined,"forged-token",admin.token]){
          const result=await post(endpoint,{liveId:live.id,productId:"A",customerEmail:alice.email},token);
          assert.equal(result.status,401);assert.equal(result.body.code,"CLIENT_LOGIN_REQUIRED");
        }
      }
      db.prepare("UPDATE auth_users SET active=0 WHERE id=?").run(bob.id);
      assert.equal((await post("/api/live/checkout/plan",{liveId:live.id,productId:"A"},bob.token)).status,401);
      db.prepare("UPDATE auth_users SET active=1 WHERE id=?").run(bob.id);
      assert.equal(store.checkouts.length,0);
    });
    await t.test("another buyer's email or id is rejected before any order is stored",async()=>{
      setup();
      for(const endpoint of["/api/live/checkout/plan","/api/live/checkout"]){
        for(const patch of[{customerEmail:bob.email},{buyerEmail:bob.email},{customerId:bob.id},{buyerId:bob.id},{userId:bob.id}]){
          const result=await post(endpoint,{liveId:live.id,productId:"A",...patch},alice.token);
          assert.equal(result.status,403);assert.equal(result.body.code,"LIVE_BUYER_MISMATCH");
        }
      }
      assert.equal(store.checkouts.length,0);
    });
    await t.test("session identity overrides forged nickname, seller, payer, fee and status flags",async()=>{
      setup();
      const result=await post("/api/live/checkout/plan",{liveId:live.id,productId:"A",customerName:"Bob",customerEmail:` ${alice.email.toUpperCase()} `,sellerId:"foreign",ownerId:"foreign",platformFee:-100,shippingPaidBy:"cardoria",shippingAmount:0,status:"paid"},alice.token);
      assert.equal(result.status,200);
      const c=result.body.checkout;
      assert.equal(c.customerId,alice.id);assert.equal(c.customerEmail,alice.email);assert.equal(c.customerName,"Alice");
      assert.equal(c.ownerId,"cardoria");assert.equal(c.status,"planned");assert.equal(c.shippingPaidBy,"buyer");assert.equal(c.shippingAmount,2.29);
    });
    await t.test("a guest quote cannot expose its stored address to an account with the same email",async()=>{
      setup();const legacy=planLiveCheckout({...input(),customerId:"",shippingAddress:{...address,addressLine1:"LEGACY PRIVATE ADDRESS"}});
      const result=await post("/api/live/checkout/plan",{liveId:live.id,productId:"A"},alice.token);
      assert.equal(result.status,409);assert.equal(result.body.code,"LIVE_CHECKOUT_IDENTITY_UNVERIFIED");
      assert.equal(JSON.stringify(result.body).includes("LEGACY PRIVATE ADDRESS"),false);assert.equal(store.checkouts.length,1);assert.equal(store.checkouts[0].id,legacy.id);
    });
    await t.test("unissued quote is repriced and a newly supplied address replaces the draft",()=>{
      setup();const first=planLiveCheckout(input());
      sessions.updateLiveSession(live.id,{products:sessions.getLiveSession(live.id).products.map(p=>p.id==="A"?{...p,price:16}:p)},actor,{adminOverride:true});
      const revised=planLiveCheckout(input("A",{shippingAddress:{...address,city:"Paris"}}));
      assert.equal(revised.id,first.id);assert.equal(revised.itemAmount,16);assert.equal(revised.shippingAddress.city,"Paris");assert.equal(store.checkouts.length,1);
    });
    await t.test("a planned quote without address cannot skip required payment address checks",()=>{
      setup();planLiveCheckout({...input(),shippingAddress:undefined});
      assert.throws(()=>planLiveCheckout({...input(),shippingAddress:undefined,requireShippingAddress:true}),{code:"LIVE_SHIPPING_ADDRESS_REQUIRED"});
    });
    await t.test("a quote recalculates postage after a different purchase is actually paid",()=>{
      setup();const draftB=planLiveCheckout(input("B"));assert.equal(draftB.shippingAmount,2.29);
      const a=planLiveCheckout(input("A"));sessions.saveLiveCheckout({...a,status:"paid"});
      const b=planLiveCheckout(input("B"));assert.equal(b.id,draftB.id);assert.equal(b.shippingAmount,0);
    });
    await t.test("same-live pending order prevents a second charge, but other buyers and lives remain independent",()=>{
      setup();const a=planLiveCheckout(input("A"));sessions.saveLiveCheckout({...a,status:"pending",url:"https://example.invalid/pay",paymentProviderOrderId:"PROVIDER-A"});
      assert.throws(()=>planLiveCheckout(input("B")),{code:"LIVE_PAYMENT_PENDING"});
      assert.equal(planLiveCheckout(input("A")).id,a.id);
      assert.equal(planLiveCheckout(input("B",{customerId:bob.id,customerEmail:bob.email})).customerId,bob.id);
      const other=sessions.createLiveSession({title:"Other live",ownerRole:"admin",ownerId:"cardoria",actor,products:live.products});sessions.setLiveStatus(other.id,"live",actor,{adminOverride:true});
      assert.ok(planLiveCheckout({...input(),liveId:other.id}).shippingAmount>0);
    });
    await t.test("ambiguous or merely authorized attempts cannot trigger blind retries",()=>{
      for(const status of["creating","reconciliation_required","authorized","authorised"]){
        setup();const a=planLiveCheckout(input());sessions.saveLiveCheckout({...a,status});
        assert.throws(()=>planLiveCheckout(input()),error=>error.status===409);
        assert.throws(()=>planLiveCheckout(input("B")),{code:"LIVE_PAYMENT_PENDING"});
      }
    });
    await t.test("known failed payment does not make the next order postage-free",()=>{
      setup();const a=planLiveCheckout(input());sessions.saveLiveCheckout({...a,status:"failed"});
      assert.equal(planLiveCheckout(input("B")).shippingAmount,2.29);
    });
    await t.test("paid postage is scoped to its live, never to all future lives",()=>{
      setup();const a=planLiveCheckout(input());sessions.saveLiveCheckout({...a,status:"paid"});
      assert.equal(planLiveCheckout(input("B")).shippingAmount,0);
      const other=sessions.createLiveSession({title:"New live",ownerRole:"admin",ownerId:"cardoria",actor,products:live.products});sessions.setLiveStatus(other.id,"live",actor,{adminOverride:true});
      assert.equal(planLiveCheckout({...input(),liveId:other.id}).shippingAmount,2.29);
    });
    await t.test("Pro quota is recomputed on a draft and cannot be consumed by quote-only buyers",()=>{
      setup("seller","seller-quota-test");setSellerPlan("seller-quota-test","pro");
      const first=planLiveCheckout(input());assert.equal(first.shippingAmount,0);
      for(let i=0;i<6;i++)sessions.saveLiveCheckout({id:`PAID-${i}`,liveId:live.id,customerId:`other-${i}`,customerEmail:`other-${i}@cardoria.invalid`,status:"paid",createdAt:`2026-01-01T00:00:0${i}Z`,shippingCoveredBySellerPlan:true});
      const after=planLiveCheckout(input());assert.equal(after.id,first.id);assert.equal(after.shippingAmount,2.29);assert.equal(after.shippingCoveredBySellerPlan,false);
    });
    await t.test("distinct request ids allow a later repeat purchase but replay cannot duplicate a paid order",()=>{
      setup();const id1=crypto.randomUUID(),id2=crypto.randomUUID();
      const a=planLiveCheckout(input("A",{checkoutRequestId:id1}));sessions.saveLiveCheckout({...a,status:"paid"});
      assert.throws(()=>planLiveCheckout(input("A",{checkoutRequestId:id1})),{code:"LIVE_PAYMENT_ALREADY_SETTLED"});
      const next=planLiveCheckout(input("A",{checkoutRequestId:id2}));assert.notEqual(next.id,a.id);assert.equal(next.shippingAmount,0);
      assert.throws(()=>planLiveCheckout(input("B",{checkoutRequestId:"bad"})),{code:"LIVE_REQUEST_ID_INVALID"});
    });
    sessions.__resetLiveStoreForTests();actions.__resetLiveActionsStoreForTests();
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve));
    if(db)for(const id of userIds){db.prepare("DELETE FROM auth_sessions WHERE user_id=?").run(id);db.prepare("DELETE FROM auth_users WHERE id=?").run(id);}
    process.chdir(cwd);await rm(directory,{recursive:true,force:true});
  }
});
