const BASE=process.env.TEST_BASE_URL||"http://127.0.0.1:10000";
const suffix=`${Date.now()}-${Math.floor(Math.random()*10000)}`,password="Live-Journey-E2E-2026!";
function assert(condition,message){if(!condition)throw new Error(message);}
async function json(path,options={}){const response=await fetch(BASE+path,options);let body={};try{body=await response.json();}catch{}return{response,body};}
function auth(token,path,options={}){return json(path,{...options,headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${token}`,...(options.headers||{})}});}
async function register(label){const email=`${label}-${suffix}@cardoria.invalid`;const result=await json("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,name:label})});assert(result.response.status===201&&result.body.token&&result.body.user?.id,`Registration failed for ${label}`);return{email,token:result.body.token,user:result.body.user};}
const sellerAccount=await register("liveur-test");
const buyer=await register("client-test");
const sellerRegistration=await auth(sellerAccount.token,"/api/marketplace/v1/paypal/sellers/register",{method:"POST",body:JSON.stringify({displayName:"Liveur Test Cardoria",sellerType:"individual"})});
assert(sellerRegistration.response.status===200&&sellerRegistration.body.seller?.id,"Seller registration failed");
const seller=sellerRegistration.body.seller;
const sender=await auth(sellerAccount.token,`/api/marketplace/v1/sellers/${seller.id}/sender-profile`,{method:"PUT",body:JSON.stringify({name:"Liveur Test Cardoria",addressLine1:"1 rue Test",postalCode:"59330",city:"Hautmont",countryCode:"FR",phone:"0600000000"})});
assert(sender.response.status===200&&sender.body.ready===true,"Seller sender address is not ready");

const relay={id:"12345",carrierServicePointId:"TEST-MR-12345",name:"Point Relais Test",address:"2 rue Test",postalCode:"59330",city:"Hautmont",countryCode:"FR",carrierCode:"mondial_relay"};
const buyerAddress={recipientName:"Client Test Cardoria",addressLine1:"3 rue Test",addressLine2:"",postalCode:"59330",city:"Hautmont",countryCode:"FR",phone:"0600000001"};
const profile=await auth(buyer.token,"/api/auth/profile",{method:"PATCH",body:JSON.stringify({name:"Client Test Cardoria",firstName:"Client",lastName:"Test",phone:buyerAddress.phone,addressLine1:buyerAddress.addressLine1,postalCode:buyerAddress.postalCode,city:buyerAddress.city,country:"FR",shippingPreference:"mondial_relay",relay})});
assert(profile.response.status===200&&profile.body.user?.profileReady===true&&profile.body.user?.relayReady===true,"Client shipping profile is not ready");

const products=[
  {id:"GIFT-SUB",name:"Cadeau Abonné Test",mode:"giveaway",price:0,qty:2,stock:2,shippingWeightGrams:200},
  {id:"GIFT-BUYER",name:"Cadeau Acheteur Test",mode:"giveaway",price:0,qty:2,stock:2,shippingWeightGrams:300},
  {id:"BUY-6",name:"Achat Test 6 EUR",mode:"buy_now",price:6,qty:10,stock:10,shippingWeightGrams:20},
  {id:"BUY-5",name:"Achat Test 5 EUR",mode:"buy_now",price:5,qty:10,stock:10,shippingWeightGrams:20},
  {id:"BUY-2",name:"Achat Test 2 EUR",mode:"buy_now",price:2,qty:10,stock:10,shippingWeightGrams:20}
];
const created=await auth(sellerAccount.token,"/api/live/seller/sessions",{method:"POST",body:JSON.stringify({title:`Liveur + Client E2E ${suffix}`,products})});
assert(created.response.status===200&&created.body.session?.ownerId===seller.id,"Seller Live creation failed");
const liveId=created.body.session.id;
const started=await auth(sellerAccount.token,`/api/live/seller/sessions/${liveId}/start`,{method:"POST",body:"{}"});
assert(started.response.status===200&&started.body.session?.status==="live","Seller Live did not start");

const subStart=await auth(sellerAccount.token,`/api/live/actions/seller/${liveId}/giveaway/start`,{method:"POST",body:JSON.stringify({productId:"GIFT-SUB",durationSeconds:60,eligibility:"subscriber"})});
assert(subStart.response.status===200&&subStart.body.giveaway?.eligibility==="subscriber","Subscriber giveaway did not start");
const beforeFollow=await auth(buyer.token,`/api/live/actions/${liveId}/giveaway/enter`,{method:"POST",body:JSON.stringify({name:"Fake",email:"fake@example.invalid"})});
assert(beforeFollow.response.status===403&&beforeFollow.body.code==="FOLLOW_REQUIRED","Non-follower entered subscriber giveaway");
const follow=await auth(buyer.token,`/api/live/actions/${liveId}/follow`,{method:"POST",body:"{}"});
assert(follow.response.status===200&&follow.body.following===true,"Buyer could not follow seller");
const entered=await auth(buyer.token,`/api/live/actions/${liveId}/giveaway/enter`,{method:"POST",body:JSON.stringify({name:"Fake",email:"fake@example.invalid"})});
assert(entered.response.status===200&&entered.body.entry?.name==="client-test","Follower did not enter subscriber giveaway with authenticated identity");
const subDraw=await auth(sellerAccount.token,`/api/live/actions/seller/${liveId}/giveaway/draw`,{method:"POST",body:"{}"});
assert(subDraw.response.status===200&&subDraw.body.giveaway?.winner,"Subscriber giveaway draw failed");

const sessions=await import("../lib/live/sessions.js");
const shipments=await import("../lib/live/shipments.js");
async function plan(productId,amount){
  const result=await auth(buyer.token,"/api/live/checkout/plan",{method:"POST",body:JSON.stringify({liveId,productId,qty:1,provider:"paypal",amount,shippingAddress:buyerAddress,servicePoint:relay,checkoutRequestId:crypto.randomUUID()})});
  assert(result.response.status===200,`Checkout plan failed for ${productId}: ${JSON.stringify(result.body)}`);
  return result.body.checkout;
}
const crypto=await import("node:crypto");
const first=await plan("BUY-6",6);
assert(first.shippingPaidBy==="streamer"&&first.shippingAmount===0&&first.shippingItemTotalWithPurchase===6,"First 6 EUR giveaway-winner purchase shipping rule failed");
sessions.saveLiveCheckout({...first,status:"paid",paymentProviderOrderId:"TEST-PAY-1",paymentProviderTransactionId:"TEST-CAP-1",updatedAt:new Date().toISOString()});
const second=await plan("BUY-5",5);
assert(second.shippingPaidItemTotalBefore===6&&second.shippingItemTotalWithPurchase===11,"Cumulative 10 EUR threshold did not reach 11 EUR");
assert(second.shippingPaidBy==="buyer"&&second.shippingAmount===4.09,"Qualifying 5 EUR purchase did not carry remaining postage");
sessions.saveLiveCheckout({...second,status:"paid",paymentProviderOrderId:"TEST-PAY-2",paymentProviderTransactionId:"TEST-CAP-2",updatedAt:new Date().toISOString()});

const buyerGiveStart=await auth(sellerAccount.token,`/api/live/actions/seller/${liveId}/giveaway/buyer/start`,{method:"POST",body:JSON.stringify({productId:"GIFT-BUYER",durationSeconds:60})});
assert(buyerGiveStart.response.status===200&&buyerGiveStart.body.giveaway?.eligibility==="buyer","Buyer giveaway did not start");
assert(buyerGiveStart.body.giveaway.entries?.length===1,"Paid buyer was not prefilled exactly once");
const buyerEnter=await auth(buyer.token,`/api/live/actions/${liveId}/giveaway/enter`,{method:"POST",body:"{}"});
assert(buyerEnter.response.status===200&&buyerEnter.body.duplicate===true,"Paid buyer duplicate entry was not recognized");
const buyerDraw=await auth(sellerAccount.token,`/api/live/actions/seller/${liveId}/giveaway/draw`,{method:"POST",body:"{}"});
assert(buyerDraw.response.status===200&&buyerDraw.body.giveaway?.winner,"Buyer giveaway draw failed");

const third=await plan("BUY-2",2);
assert(third.shippingItemTotalWithPurchase===13&&third.shippingAmount===0&&third.shippingChargeLockedForLive===true,"Post-threshold purchase incorrectly charged shipping");
sessions.saveLiveCheckout({...third,status:"paid",paymentProviderOrderId:"TEST-PAY-3",paymentProviderTransactionId:"TEST-CAP-3",updatedAt:new Date().toISOString()});

const group=shipments.prepareLiveShipmentGroup(liveId,buyer.email);
assert(group&&group.checkouts.length===3,"Shipment did not group all three paid purchases");
assert(group.gifts.length===2,"Shipment did not group both giveaway prizes");
assert(group.weight===560,"Grouped shipment weight should be 560 g");
assert(group.pack?.id==="PACK-MR-1000","560 g shipment should select PACK-MR-1000");
assert(group.payer==="buyer"&&group.buyerPostagePaid===4.09,"Shipment financing is inconsistent with paid postage");
assert(group.recipient.recipientName==="Client Test Cardoria","Shipment recipient identity is wrong");
assert(String(group.relay?.id)==="12345","Shipment relay is missing");

const stopped=await auth(sellerAccount.token,`/api/live/seller/sessions/${liveId}/stop`,{method:"POST",body:"{}"});
assert(stopped.response.status===200&&stopped.body.session?.status==="ended","Seller Live did not stop");
assert(stopped.body.shipping?.errors?.some(e=>e.code==="LIVE_LABELS_NOT_ACTIVATED"),"Test environment unexpectedly attempted a real label purchase");
const ended=await json(`/api/live/sessions/${liveId}`);
assert(ended.response.status===404,"Ended Live is still public");
console.log(JSON.stringify({
  pass:true,scenario:"seller-client-full-live-journey",sellerCreated:true,buyerCreated:true,
  sellerSenderReady:true,buyerProfileReady:true,buyerRelayReady:true,followRequired:true,followed:true,
  subscriberGiveawayWon:true,paidPurchases:[6,5,2],cumulativePaidItems:13,buyerPostagePaid:4.09,
  buyerGiveawayWon:true,groupedPurchases:3,groupedGifts:2,shipmentWeightGrams:560,pack:"PACK-MR-1000",
  liveEnded:true,realPayment:false,realLabel:false
},null,2));
