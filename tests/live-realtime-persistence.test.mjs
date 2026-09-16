import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const src=fs.readFileSync(new URL("../backend/lib/live/realtime-sessions.js",import.meta.url),"utf8");
test("P2P publisher registrations persist across Cardoria restarts",()=>{
 assert.match(src,/PUBLISHER_STORE_KEY/);
 assert.match(src,/hydratePublishedLives\(\)/);
 assert.match(src,/persistPublishedLives\(\)/);
 assert.match(src,/offers:new Map\(\),lastSeenAt:Date\.now\(\)/);
});
// Regression: OVH/service restarts must not erase an active P2P publisher registration.
