import test from "node:test";
import assert from "node:assert/strict";
import { LIVE_SHIPPING_PACKS, shippingPackForWeight, productShippingWeight, giveawayShippingPolicy } from "../backend/lib/live/shipping.js";

test("Cardoria shipping packs stay monotone and slightly above source carrier baseline",()=>{
  let previous=0;
  for(const pack of LIVE_SHIPPING_PACKS){assert.ok(pack.price>=previous);previous=pack.price;assert.ok(pack.maxGrams>0);}
  assert.equal(shippingPackForWeight(20).id,"PACK-LS-20");
  assert.equal(shippingPackForWeight(21).id,"PACK-LS-100");
  assert.equal(shippingPackForWeight(101).id,"PACK-MR-500");
  assert.equal(shippingPackForWeight(1000).price,4.69);
});
test("legacy products without declared shipping weight are not silently charged",()=>{
  assert.equal(productShippingWeight({name:"legacy"},1),0);
  assert.equal(productShippingWeight({shippingWeightGrams:20},3),60);
});
test("giveaway shipping is always free to participant and winner",()=>{
  const policy=giveawayShippingPolicy();
  assert.equal(policy.participantPays,0);
  assert.equal(policy.winnerPays,0);
  assert.equal(policy.withoutPurchase,"streamer");
  assert.equal(policy.withPurchase,"bundle_with_first_purchase");
});
