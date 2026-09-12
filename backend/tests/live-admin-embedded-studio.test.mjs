import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const liveRoute=fs.readFileSync(new URL("../routes/live.js",import.meta.url),"utf8");
const studioRoute=fs.readFileSync(new URL("../routes/live-admin-studio.js",import.meta.url),"utf8");
const realtimeRoute=fs.readFileSync(new URL("../routes/live-realtime.js",import.meta.url),"utf8");
const studio=fs.readFileSync(new URL("../../js/cardoria-live-admin-studio.js",import.meta.url),"utf8");
const livePage=fs.readFileSync(new URL("../../live.html",import.meta.url),"utf8");
const publisher=fs.readFileSync(new URL("../../js/cardoria-live-publisher.js",import.meta.url),"utf8");

test("Live mounts grant-authenticated admin studio",()=>{
  assert.match(liveRoute,/liveAdminStudioRoutes/);
  assert.match(liveRoute,/router\.use\("\/admin-studio"/);
  assert.match(studioRoute,/resolveAdminLiveAccess/);
  assert.match(studioRoute,/x-live-admin-grant/);
});

test("Embedded studio exposes full Cardoria controls",()=>{
  for(const marker of["Démarrer Caméra 1","Démarrer Caméra 2 PC","Caméra 2 \/ téléphone","Lancer enchère","Vente flash","Giveaway","Tirer gagnant","Break","Paiements en direct"])assert.ok(studio.includes(marker),marker);
  assert.match(studio,/\/actions\/pin/);
  assert.match(studio,/\/actions\/auction\/start/);
  assert.match(studio,/\/actions\/flash\/start/);
  assert.match(studio,/\/actions\/giveaway\/start/);
  assert.match(studio,/\/actions\/break\/start/);
});

test("Camera publisher accepts secure admin grant",()=>{
  assert.match(publisher,/grantToken/);
  assert.match(publisher,/x-live-admin-grant/);
  assert.match(realtimeRoute,/resolveAdminLiveAccess/);
  assert.match(realtimeRoute,/cardoria-live-grant/);
});

test("Live page loads embedded studio and keeps payment providers untouched",()=>{
  assert.match(livePage,/cardoria-live-admin-studio\.js/);
  assert.doesNotMatch(studio,/revolut|onrender\.com/i);
  assert.doesNotMatch(studioRoute,/paypal|sumup|commission/i);
});
