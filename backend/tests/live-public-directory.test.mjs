import test from "node:test";
import assert from "node:assert/strict";
import {
  filterPublicSessionsByCategory,
  normalizeLiveCategory,
  publicPlanMeta,
  requestedLiveCategory,
  sortPublicSessions
} from "../lib/live/public-directory.js";

test("live category aliases and title inference stay canonical", () => {
  assert.equal(normalizeLiveCategory("Pokémon", ""), "pokemon");
  assert.equal(normalizeLiveCategory("Yu-Gi-Oh!", ""), "yugioh");
  assert.equal(normalizeLiveCategory("", "Live Pokémon du vendredi"), "pokemon");
  assert.equal(normalizeLiveCategory("", "Break One Piece OP01"), "onepiece");
  assert.equal(normalizeLiveCategory("", "Session Lorcana"), "lorcana");
  assert.equal(normalizeLiveCategory("", "MTG draft"), "magic");
  assert.equal(normalizeLiveCategory("", "Live Cardoria"), "other");
  assert.equal(requestedLiveCategory("tous"), "");
  assert.equal(requestedLiveCategory("pokemon"), "pokemon");
  assert.equal(requestedLiveCategory("unknown-licence"), "");
});

test("public directory ranks Elite then Pro then Starter then connected viewers", () => {
  const rows = sortPublicSessions([
    { id: "starter-hot", status: "live", planRank: 3, viewerCount: 80, startedAt: "2026-01-01T12:00:00Z" },
    { id: "pro", status: "live", planRank: 2, viewerCount: 2, startedAt: "2026-01-01T13:00:00Z" },
    { id: "elite", status: "live", planRank: 1, viewerCount: 0, startedAt: "2026-01-01T08:00:00Z" },
    { id: "starter-quiet", status: "live", planRank: 3, viewerCount: 4, startedAt: "2026-01-01T14:00:00Z" },
    { id: "elite-soon", status: "scheduled", planRank: 1, viewerCount: 0, scheduledAt: "2026-03-01T18:00:00Z" },
    { id: "starter-soon", status: "scheduled", planRank: 3, viewerCount: 0, scheduledAt: "2026-01-20T18:00:00Z" }
  ]);
  assert.deepEqual(rows.map((row) => row.id), [
    "elite",
    "pro",
    "starter-hot",
    "starter-quiet",
    "elite-soon",
    "starter-soon"
  ]);
});

test("category filter keeps pack ranking inside the selected licence", () => {
  const filtered = filterPublicSessionsByCategory([
    { id: "poke-elite", title: "Pokemon Elite", category: "pokemon", status: "live", planRank: 1, viewerCount: 0 },
    { id: "yugi", title: "Yu-Gi-Oh live", category: "yugioh", status: "live", planRank: 3, viewerCount: 40 }
  ], "pokemon");
  assert.deepEqual(filtered.map((row) => row.id), ["poke-elite"]);
});

test("Cardoria admin lives stay featured like the top pack", () => {
  const admin = publicPlanMeta({ ownerRole: "admin", ownerId: "cardoria" });
  assert.equal(admin.planId, "cardoria");
  assert.equal(admin.featured, true);
  assert.equal(admin.rank, 0);
  const unknownSeller = publicPlanMeta({ ownerRole: "seller", ownerId: "seller-missing-pack-" + Date.now() });
  assert.equal(unknownSeller.planId, "starter");
  assert.equal(unknownSeller.featured, false);
  assert.equal(unknownSeller.rank, 3);
});
