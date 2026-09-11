import test from "node:test";
import assert from "node:assert/strict";
import { __setLiveStoreForTests, __resetLiveStoreForTests, createLiveSession, setLiveStatus } from "../lib/live/sessions.js";
import { __setLiveActionsStoreForTests, __resetLiveActionsStoreForTests, addLiveChatMessage, drawGiveaway, enterGiveaway, getLiveActionState, pinLiveProduct, placeAuctionBid, startAuction, startBreak, startFlashSale, startGiveaway, stopAuction } from "../lib/live/actions.js";

const admin = { role: "admin", id: "admin-test", email: "admin@test.local" };
function setup() {
  const liveStore = { sessions: [], checkouts: [], adminAccess: [] };
  const actionStore = { states: {} };
  __setLiveStoreForTests(liveStore);
  __setLiveActionsStoreForTests(actionStore);
  const live = createLiveSession({ title: "Test actions", ownerRole: "admin", ownerId: "cardoria", actor: admin, products: [
    { id: "LOT-1", name: "Booster", price: 5, qty: 10, stock: 10, mode: "buy_now" },
    { id: "GIV-1", name: "Giveaway", price: 0, qty: 1, stock: 1, mode: "giveaway" }
  ] });
  setLiveStatus(live.id, "live", admin, { adminOverride: true });
  return live.id;
}
function teardown() { __resetLiveActionsStoreForTests(); __resetLiveStoreForTests(); }

test("pin, auction and bids work with server validation", () => { const id=setup(); try { const state=pinLiveProduct(id,"LOT-1"); assert.equal(state.pinnedProductId,"LOT-1"); const auction=startAuction(id,{productId:"LOT-1",startPrice:5,durationSeconds:30,mode:"standard"}); assert.equal(auction.status,"running"); assert.equal(auction.currentPrice,5); const bid=placeAuctionBid(id,{amount:5,bidderName:"Alice",bidderEmail:"alice@test.local"}); assert.equal(bid.auction.currentPrice,5); assert.throws(()=>placeAuctionBid(id,{amount:5.1,bidderName:"Bob"}),/minimale/i); const bid2=placeAuctionBid(id,{amount:5.5,bidderName:"Bob"}); assert.equal(bid2.auction.highestBidder.name,"Bob"); const ended=stopAuction(id); assert.equal(ended.status,"ended"); } finally { teardown(); } });

test("sudden death auction does not use standard extension mode", () => { const id=setup(); try { const a=startAuction(id,{productId:"LOT-1",startPrice:5,durationSeconds:5,mode:"sudden_death"}); const ends=a.endsAt; const bid=placeAuctionBid(id,{amount:5,bidderName:"Alice"}); assert.equal(bid.auction.mode,"sudden_death"); assert.equal(bid.auction.endsAt,ends); } finally { teardown(); } });

test("giveaway is free, deduplicates email and draws one winner", () => { const id=setup(); try { const g=startGiveaway(id,{productId:"GIV-1",durationSeconds:60}); assert.equal(g.status,"running"); const first=enterGiveaway(id,{name:"Alice",email:"alice@test.local"}); assert.equal(first.giveaway.entries.length,1); const duplicate=enterGiveaway(id,{name:"Alice 2",email:"alice@test.local"}); assert.equal(duplicate.duplicate,true); enterGiveaway(id,{name:"Bob",email:"bob@test.local"}); const draw=drawGiveaway(id); assert.equal(draw.giveaway.status,"ended"); assert.ok(draw.giveaway.winner); assert.equal(drawGiveaway(id).duplicate,true); } finally { teardown(); } });

test("flash, break and chat are exposed in state", () => { const id=setup(); try { const flash=startFlashSale(id,{productId:"LOT-1",price:4,durationSeconds:30}); assert.equal(flash.price,4); const br=startBreak(id,{productId:"LOT-1",spots:8,pricePerSpot:3}); assert.equal(br.spots,8); assert.equal(br.pricePerSpot,3); const msg=addLiveChatMessage(id,{name:"Viewer",message:"Bonjour"}); assert.equal(msg.message,"Bonjour"); const state=getLiveActionState(id); assert.equal(state.flash.status,"running"); assert.equal(state.break.status,"running"); assert.equal(state.chat.length,1); } finally { teardown(); } });
