import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

test("energy spot checkout reaches SumUp, becomes paid, updates spot availability and is idempotent", async () => {
  let createdPayload=null;
  const checkoutId="SUMUP-ENERGY-TEST";
  let checkoutStatus="PENDING";

  const server=http.createServer(async (req,res)=>{
    if(req.method==="POST" && req.url==="/v0.1/checkouts"){
      let body=""; for await (const chunk of req) body+=chunk;
      createdPayload=JSON.parse(body||"{}");
      res.writeHead(201,{"content-type":"application/json"});
      res.end(JSON.stringify({id:checkoutId,status:"PENDING",hosted_checkout_url:"https://pay.example.test/energy"}));
      return;
    }
    if(req.method==="GET" && req.url===`/v0.1/checkouts/${checkoutId}`){
      res.writeHead(200,{"content-type":"application/json"});
      res.end(JSON.stringify({
        id:checkoutId,
        checkout_reference:createdPayload?.checkout_reference,
        status:checkoutStatus,
        transaction_code: checkoutStatus==="SUCCESSFUL" ? "TX-ENERGY-TEST" : ""
      }));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve)=>server.listen(0,"127.0.0.1",resolve));
  const port=server.address().port;

  process.env.SUMUP_API_BASE=`http://127.0.0.1:${port}`;
  process.env.SUMUP_API_KEY="test-key";
  process.env.SUMUP_MERCHANT_CODE="TEST-MERCHANT";

  const sessions=await import("../backend/lib/live/sessions.js");
  const actions=await import("../backend/lib/live/actions.js");
  const checkout=await import("../backend/lib/live/checkout.js");
  const sumup=await import("../backend/lib/payments/sumup.js");

  const liveStore={
    sessions:[{
      id:"LIVE-ENERGY-PAYMENT",title:"Energy Payment Test",ownerRole:"admin",ownerId:"cardoria",ownerEmail:"",
      status:"live",scheduledAt:"",startedAt:new Date().toISOString(),endedAt:"",
      products:[],currentLot:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
    }],
    checkouts:[],
    adminAccess:[]
  };
  const actionStore={states:{
    "LIVE-ENERGY-PAYMENT":{
      pinnedProductId:"",
      auction:null,flash:null,giveaway:null,
      break:{
        id:"BRK-ENERGY-1",
        productId:"ENERGY-BRK-ENERGY-1",
        productName:"Jeu de l’énergie",
        status:"running",
        breakType:"energy_game",
        virtualProduct:true,
        shippingWeightGrams:20,
        gamesCount:1,
        energyGames:[],
        spots:2,
        spotLabels:["Jeu 1 — Feu","Jeu 1 — Eau"],
        pricePerSpot:5,
        stockAtStart:2,
        soldSpots:0,
        remainingSpots:2,
        startedAt:new Date().toISOString()
      },
      energyTypesByProduct:{},chat:[],updatedAt:new Date().toISOString()
    }
  }};

  sessions.__setLiveStoreForTests(liveStore);
  actions.__setLiveActionsStoreForTests(actionStore);

  try {
    const first=await checkout.createLiveCheckout({
      liveId:"LIVE-ENERGY-PAYMENT",
      productId:"ENERGY-BRK-ENERGY-1",
      qty:1,
      spotLabel:"Jeu 1 — Feu",
      customerEmail:"buyer@example.com",
      customerName:"Buyer",
      requestedProvider:"sumup",
      successUrl:"https://www.cardoriashop.fr/live.html?session=LIVE-ENERGY-PAYMENT"
    });

    assert.equal(first.provider,"sumup");
    assert.equal(first.status,"pending");
    assert.equal(first.paymentProviderOrderId,checkoutId);
    assert.equal(first.url,"https://pay.example.test/energy");
    assert.equal(first.spotLabel,"Jeu 1 — Feu");
    assert.equal(first.itemAmount,5);
    assert.equal(first.shippingAmount,2.29);
    assert.equal(first.amount,7.29);
    assert.equal(createdPayload.amount,7.29);
    assert.equal(createdPayload.currency,"EUR");
    assert.equal(createdPayload.merchant_code,"TEST-MERCHANT");
    assert.match(createdPayload.description,/Jeu 1 — Feu/);
    assert.equal(createdPayload.checkout_reference,first.id);

    const duplicate=await checkout.createLiveCheckout({
      liveId:"LIVE-ENERGY-PAYMENT",productId:"ENERGY-BRK-ENERGY-1",qty:1,
      spotLabel:"Jeu 1 — Feu",customerEmail:"buyer@example.com",customerName:"Buyer",
      requestedProvider:"sumup"
    });
    assert.equal(duplicate.id,first.id);
    assert.equal(duplicate.paymentProviderOrderId,checkoutId);

    checkoutStatus="SUCCESSFUL";
    const synced=await sumup.syncPaymentFromCheckout(checkoutId);
    assert.equal(synced.status,"paid");
    assert.equal(synced.transactionId,"TX-ENERGY-TEST");

    const paid=sessions.getLiveCheckout(first.id);
    assert.equal(paid.status,"paid");
    assert.equal(paid.paymentProviderTransactionId,"TX-ENERGY-TEST");

    const state=actions.getLiveActionState("LIVE-ENERGY-PAYMENT");
    assert.equal(state.break.soldSpots,1);
    assert.equal(state.break.remainingSpots,1);

    assert.throws(()=>checkout.planLiveCheckout({
      liveId:"LIVE-ENERGY-PAYMENT",productId:"ENERGY-BRK-ENERGY-1",qty:1,
      spotLabel:"Jeu 1 — Feu",customerEmail:"other@example.com",customerName:"Other",
      requestedProvider:"sumup"
    }),/déjà réservé ou vendu/);

    const other=checkout.planLiveCheckout({
      liveId:"LIVE-ENERGY-PAYMENT",productId:"ENERGY-BRK-ENERGY-1",qty:1,
      spotLabel:"Jeu 1 — Eau",customerEmail:"other@example.com",customerName:"Other",
      requestedProvider:"sumup"
    });
    assert.equal(other.spotLabel,"Jeu 1 — Eau");
    assert.equal(other.provider,"sumup");

    const syncedAgain=await sumup.syncPaymentFromCheckout(checkoutId);
    assert.equal(syncedAgain.status,"paid");
    assert.equal(sessions.getLiveCheckout(first.id).status,"paid");
  } finally {
    actions.__resetLiveActionsStoreForTests();
    sessions.__resetLiveStoreForTests();
    await new Promise((resolve)=>server.close(resolve));
  }
});
