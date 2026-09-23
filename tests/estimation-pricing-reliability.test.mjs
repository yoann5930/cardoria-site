import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { conditionMultiplierFor } from "../backend/lib/engine/pricing.js";
import { scoreCatalogMatch } from "../backend/lib/ai/smart-estimate.js";
import { ingestEstimationOutcome } from "../backend/lib/market/ingest.js";

const read = (path) => fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("condition grading has one canonical multiplier", () => {
  assert.equal(conditionMultiplierFor("nm"), 1);
  assert.equal(conditionMultiplierFor("ex"), 0.85);
  assert.equal(conditionMultiplierFor("gd"), 0.65);
  assert.equal(conditionMultiplierFor("lp"), 0.75);
  assert.equal(conditionMultiplierFor("hp"), 0.35);

  const smart = read("backend/lib/ai/smart-estimate.js");
  assert.doesNotMatch(smart, /CONDITION_MARKET_FACTOR/);
  assert.match(smart, /const conditionFactor = conditionMultiplierFor\(engineKey\)/);
  assert.match(smart, /recommended: round2\(rawRecommended \* conditionFactor\)/);
});

test("catalog identity scoring rewards exact name number set and language", () => {
  const card = {
    id: "pokemon-fr-test",
    license: "pokemon",
    language: "fr",
    name: "Dracaufeu ex",
    number: "199",
    extension: "151"
  };
  const exact = scoreCatalogMatch(card, {
    license: "Pokémon",
    language: "FR",
    name: "Dracaufeu ex",
    number: "199/165",
    extension: "151"
  });
  assert.equal(exact.exact, true);
  assert.ok(exact.score >= 20);

  const wrong = scoreCatalogMatch(card, {
    license: "pokemon",
    language: "fr",
    name: "Pikachu",
    number: "025",
    extension: "Base Set"
  });
  assert.equal(wrong.exact, false);
  assert.ok(wrong.score < exact.score);
});

test("catalog matching preserves Japanese and Korean names", () => {
  const japanese = scoreCatalogMatch({
    id: "pokemon-ja-test",
    license: "pokemon",
    language: "ja",
    name: "リザードンex",
    number: "201",
    extension: "シャイニートレジャーex"
  }, {
    license: "pokemon",
    language: "JP",
    name: "リザードンex",
    number: "201",
    extension: "シャイニートレジャーex"
  });
  assert.equal(japanese.exact, true);
  assert.ok(japanese.score >= 20);
});

test("AI estimates are observations, never real market transactions", () => {
  const result = ingestEstimationOutcome({
    analysisId: "AI-TEST",
    cardId: "pokemon-test",
    buybackPrice: 10,
    salePrice: 20,
    condition: "Near Mint"
  });
  assert.equal(result.recordedAsMarketTransaction, false);

  const ingest = read("backend/lib/market/ingest.js");
  const analyze = read("backend/lib/ai/analyze.js");
  assert.doesNotMatch(analyze, /ingestEstimationOutcome/);
  assert.doesNotMatch(analyze, /recordPriceSnapshot/);
  assert.match(analyze, /Lecture seule : une estimation ne doit jamais créer un point de marché/);
  assert.match(ingest, /Une estimation n'est ni une vente ni un rachat réel/);
});

test("market statistics only use real sale and buyback transaction types", () => {
  const stats = read("backend/lib/market/stats.js");
  assert.match(stats, /const BUYBACK_TYPES = \["buyback", "admin_buyback"\]/);
  assert.match(stats, /transaction_type IN/);
  assert.match(stats, /notes <> 'Prix revente estimé validé'/);
  assert.match(stats, /notes <> 'Offre rachat estimation IA'/);

  const migrate = read("backend/lib/market/migrate.js");
  const init = read("backend/lib/market/index.js");
  assert.match(migrate, /purgeEstimatedMarketPollution/);
  assert.match(migrate, /DELETE FROM sales_history/);
  assert.match(migrate, /DELETE FROM market_transactions/);
  assert.match(init, /purgeEstimatedMarketPollution\(\)/);
});

test("market sources are real stored providers and no synthetic Cardmarket TCGPlayer or eBay refs remain", () => {
  const smart = read("backend/lib/ai/smart-estimate.js");
  assert.match(smart, /getPriceSources\(card\.id\)/);
  assert.match(smart, /source: "actual_sales"/);
  assert.match(smart, /source: "cardoria_marketplace"/);
  assert.doesNotMatch(smart, /Cardmarket \(ref\.\)/);
  assert.doesNotMatch(smart, /TCGPlayer \(ref\.\)/);
  assert.doesNotMatch(smart, /eBay \(ref\.\)/);
  assert.doesNotMatch(smart, /refLow \* 0\.98|refHigh \* 0\.95/);
});

test("client condition is provided to AI as a hint but photos remain authoritative", () => {
  const prompts = read("backend/lib/ai/prompts.js");
  assert.match(prompts, /État indiqué par le client/);
  assert.match(prompts, /Vérifie-le visuellement sur les photos/);
});

test("estimation rendering escapes AI and customer-controlled text", () => {
  const client = read("js/ai-client.js");
  const admin = read("js/admin/admin-estimations.js");
  assert.match(client, /function escapeHtml/);
  assert.match(client, /safeMultiline\(data\.clientResult/);
  assert.match(client, /escapeHtml\(x\[1\]\)/);
  assert.match(admin, /function esc/);
  assert.match(admin, /esc\(x\.customerName\)/);
  assert.match(admin, /esc\(x\.result \|\| ""\)/);
});
