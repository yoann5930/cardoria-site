import test from "node:test";
import assert from "node:assert/strict";
import { listFrenchCommunesByPostalCode, resolveFrenchPostalCity } from "../lib/france-communes.js";

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("one French commune auto-resolves from postal code", async () => {
  const fetchImpl = async (url) => {
    assert.match(String(url), /codePostal=59330/);
    return response([{ nom:"Hautmont", code:"59291", codesPostaux:["59330"], population:14200 }]);
  };
  const result = await resolveFrenchPostalCity("59330", "", { fetchImpl });
  assert.equal(result.postalCode, "59330");
  assert.equal(result.city, "Hautmont");
  assert.deepEqual(result.communes.map(x => x.name), ["Hautmont"]);
});

test("multiple communes require selecting one of the proposed cities", async () => {
  const fetchImpl = async () => response([
    { nom:"Ville A", code:"00001", codesPostaux:["12345"], population:1000 },
    { nom:"Ville B", code:"00002", codesPostaux:["12345"], population:2000 }
  ]);
  const listed = await listFrenchCommunesByPostalCode("12345", { fetchImpl });
  assert.deepEqual(listed.communes.map(x => x.name), ["Ville B","Ville A"]);
  await assert.rejects(resolveFrenchPostalCity("12345", "", { fetchImpl }), { code:"FRENCH_CITY_REQUIRED" });
  const selected = await resolveFrenchPostalCity("12345", "ville a", { fetchImpl });
  assert.equal(selected.city, "Ville A");
});

test("postal code and city mismatch is rejected", async () => {
  const fetchImpl = async () => response([{ nom:"Le Quesnoy", code:"59481", codesPostaux:["59530"], population:4900 }]);
  await assert.rejects(resolveFrenchPostalCity("59530", "Hautmont", { fetchImpl }), { code:"FRENCH_POSTAL_CITY_MISMATCH" });
});

test("invalid postal code never calls the upstream service", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response([]); };
  await assert.rejects(listFrenchCommunesByPostalCode("5953", { fetchImpl }), { code:"FRENCH_POSTAL_CODE_INVALID" });
  assert.equal(calls, 0);
});
