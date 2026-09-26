import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const route=fs.readFileSync(new URL("../routes/live-realtime.js",import.meta.url),"utf8");
const transport=fs.readFileSync(new URL("../lib/live/cloudflare-realtime.js",import.meta.url),"utf8");
const registry=fs.readFileSync(new URL("../lib/live/realtime-sessions.js",import.meta.url),"utf8");
const live=fs.readFileSync(new URL("../routes/live.js",import.meta.url),"utf8");
const viewer=fs.readFileSync(new URL("../../js/cardoria-live-viewer.js",import.meta.url),"utf8");
const viewerRuntime=fs.readFileSync(new URL("../public/js/cardoria-live-viewer.js",import.meta.url),"utf8");
const publisher=fs.readFileSync(new URL("../../js/cardoria-live-publisher.js",import.meta.url),"utf8");
const publisherRuntime=fs.readFileSync(new URL("../public/js/cardoria-live-publisher.js",import.meta.url),"utf8");
const livePage=fs.readFileSync(new URL("../../live.html",import.meta.url),"utf8");

test("Live API mounts the complete WebRTC transport",()=>{
  assert.match(live,/router\.use\("\/webrtc",\s*liveRealtimeRoutes\)/);
  for(const path of[
    "publisher/start","publisher/ready","publisher/heartbeat","publisher/stop",
    "publisher/offers","publisher/answer","viewer/start","viewer/offer",
    "viewer/answers","viewer/answer","viewer/heartbeat","viewer/stop","status/:liveId"
  ]) assert.ok(route.includes(path),path);
});

test("Cloudflare credentials stay server side and subscriptions retain source mapping",()=>{
  assert.match(transport,/CLOUDFLARE_REALTIME_APP_ID/);
  assert.match(transport,/CLOUDFLARE_REALTIME_APP_SECRET/);
  assert.match(transport,/Authorization:\s*\`Bearer \$\{secret\}\`/);
  assert.match(transport,/subscriptions/);
  assert.match(transport,/sourceId/);
  assert.doesNotMatch(route,/APP_SECRET/);
});

test("Realtime registry expires viewers and all stale publishers",()=>{
  assert.match(registry,/VIEWER_TTL_MS\s*=\s*90_000/);
  assert.match(registry,/PUBLISHER_TTL_MS\s*=\s*30_000/);
  assert.match(registry,/cleanupPublisherSources/);
  assert.match(registry,/Number\(source\.lastSeenAt\s*\|\|\s*0\)\s*<\s*cutoff/);
  assert.match(registry,/getLiveSession\(liveId\)/);
  assert.match(registry,/LIVE_PUBLISHER_MISMATCH/);
  assert.match(registry,/heartbeatRealtimeViewer/);
  assert.match(registry,/heartbeatRealtimePublisher/);
  assert.match(registry,/viewerCountForLive/);
  assert.match(registry,/realtimeStatusForLive/);
});

test("Cloudflare publication is hidden until the publisher is really ready",()=>{
  assert.match(registry,/ready:\s*false/);
  assert.match(registry,/markRealtimePublisherReady/);
  assert.match(registry,/sourceIsReady/);
  assert.match(registry,/connectingPublishers/);
  assert.match(publisher,/waitConnected\(bootstrap,\s*10000\)/);
  assert.match(publisher,/\/api\/live\/webrtc\/publisher\/ready/);
  assert.match(publisher,/\/api\/live\/webrtc\/publisher\/heartbeat/);
  assert.match(publisher,/publisherKey:\s*publisherKey/);
});

test("Realtime provider can use Cloudflare and safely fall back to Cardoria P2P",()=>{
  assert.match(registry,/"cardoria-p2p"/);
  assert.match(registry,/isCloudflareRealtimeConfigured\(\)\s*\?\s*"cloudflare-realtime"\s*:\s*"cardoria-p2p"/);
  assert.match(route,/configured:true/);
  assert.match(live,/PAYMENT_MATRIX/);
  assert.match(live,/provider:\s*"paypal"/);
});

test("frontend Live supports two cameras, Cloudflare mid mapping and real reconnect",()=>{
  assert.equal(viewerRuntime,viewer);
  assert.equal(publisherRuntime,publisher);
  assert.doesNotMatch(viewer,/onrender\.com|whatnot-live/i);
  assert.doesNotMatch(livePage,/onrender\.com|whatnot-live/i);
  assert.match(viewer,/\/api\/live\/webrtc\/viewer\/start/);
  assert.match(viewer,/\/api\/live\/webrtc\/viewer\/offer/);
  assert.match(viewer,/\/api\/live\/webrtc\/viewer\/answers/);
  assert.match(viewer,/data-live-source-video/);
  assert.match(viewer,/syncViewerSources/);
  assert.match(viewer,/cloudflare-waiting/);
  assert.match(viewer,/event\.transceiver\?\.mid/);
  assert.match(viewer,/start\.subscriptions/);
  assert.match(viewer,/scheduleReconnect/);
  assert.match(viewer,/connectRealtime\(sessionId\)/);
  assert.match(viewer,/\/api\/live\/sessions\?status=all/);
  assert.match(publisher,/getUserMedia/);
  assert.match(publisher,/\/api\/live\/webrtc\/publisher\/start/);
  assert.match(publisher,/\/api\/live\/webrtc\/publisher\/offers/);
  assert.match(publisher,/\/api\/live\/webrtc\/publisher\/answer/);
  assert.match(registry,/MAX_PUBLISHERS_PER_LIVE\s*=\s*2/);
  assert.match(registry,/sources:\s*status\.sources/);
  assert.match(registry,/super_admin/);
  assert.match(registry,/LIVE_PUBLISHER_ADMIN_ROLES/);
});

test("Cloudflare viewers submit ICE-complete localDescription answers",()=>{assert.match(viewer,/await waitIce\(pc\)/);assert.match(viewer,/const local = pc\.localDescription \|\| answer/);assert.match(viewer,/sdp:\s*local\.sdp/);});\ntest("paired phone publishers unregister through their capability key",()=>{
  assert.match(route,/publisherKey/);
  assert.match(route,/stopRealtimePublisher\(\{liveId,sourceId:body\.sourceId,publisherKey\}\)/);
  assert.match(publisher,/stopServerRegistration/);
  assert.match(publisher,/publisherKey:\s*publisherKey/);
  assert.doesNotMatch(publisher,/if\s*\(!pairToken\)[\s\S]{0,180}publisher\/stop/);
});

test("Live P2P signaling and playout stay tuned for low latency",()=>{
  assert.match(publisher,/iceCandidatePoolSize:\s*4/);
  assert.match(publisher,/pollDelay\s*=\s*500/);
  assert.match(publisher,/schedulePoll\(0\)/);
  assert.match(viewer,/iceCandidatePoolSize:\s*4/);
  assert.match(viewer,/jitterBufferTarget\s*=\s*50/);
  assert.match(viewer,/\}, 250\);/);
  assert.match(viewer,/startHeartbeat\(sessionId, 1000\)/);
});

test("Cardoria admin roles can publish Admin Live; sellers cannot",async()=>{
  const{isLivePublisher}=await import("../lib/live/realtime-sessions.js");
  const adminLive={ownerRole:"admin",ownerId:"cardoria",status:"live"};
  assert.equal(isLivePublisher(adminLive,{role:"super_admin",id:"u1"}),true);
  assert.equal(isLivePublisher(adminLive,{role:"admin",id:"u1"}),true);
  assert.equal(isLivePublisher(adminLive,{role:"employee",id:"u1"}),true);
  assert.equal(isLivePublisher(adminLive,{role:"seller",id:"s1",sellerId:"s1"}),false);
  assert.equal(isLivePublisher({ownerRole:"seller",ownerId:"s1",status:"live"},{role:"seller",id:"s1",sellerId:"s1"}),true);
  assert.equal(isLivePublisher({ownerRole:"seller",ownerId:"A",status:"live"},{role:"seller",id:"B",sellerId:"B"}),false);
  assert.equal(isLivePublisher(adminLive,{role:"client",id:"c1"}),false);
  assert.equal(isLivePublisher(adminLive,null),false);
});
