import { verifyFrenchProfessionalSiret } from "../lib/marketplace/professional-verification.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function rejects(fn, code) {
  try { await fn(); }
  catch (error) {
    assert(error?.code === code, `Expected ${code}, got ${error?.code || error?.message}`);
    return;
  }
  throw new Error(`Expected rejection ${code}`);
}

const originalFetch = global.fetch;
try {
  await rejects(() => verifyFrenchProfessionalSiret("123"), "SELLER_SIRET_INVALID");

  global.fetch = async () => new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "content-type": "application/json" } });
  await rejects(() => verifyFrenchProfessionalSiret("12345678901234"), "SELLER_SIRET_NOT_FOUND");

  global.fetch = async () => new Response(JSON.stringify({
    results: [{
      siren: "123456789",
      nom_complet: "TEST ENTREPRISE",
      etat_administratif: "C",
      siege: { siret: "12345678901234", etat_administratif: "C" }
    }]
  }), { status: 200, headers: { "content-type": "application/json" } });
  await rejects(() => verifyFrenchProfessionalSiret("12345678901234"), "SELLER_COMPANY_INACTIVE");

  global.fetch = async (url, options) => {
    assert(String(url).includes("q=12345678901234"), "SIRET not sent to official lookup");
    assert(String(options?.headers?.["User-Agent"] || "").includes("Cardoria"), "User-Agent missing");
    return new Response(JSON.stringify({
      results: [{
        siren: "123456789",
        nom_complet: "TEST ENTREPRISE ACTIVE",
        etat_administratif: "A",
        nature_juridique: "5710",
        activite_principale: "47.91B",
        siege: { siret: "12345678901234", etat_administratif: "A", adresse: "1 RUE TEST 59000 LILLE" }
      }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const verified = await verifyFrenchProfessionalSiret("123 456 789 01234");
  assert(verified.verified === true, "Verified SIRET rejected");
  assert(verified.siret === "12345678901234", "SIRET normalization failed");
  assert(verified.legalName === "TEST ENTREPRISE ACTIVE", "Legal name missing");
  assert(verified.source.includes("SIRENE-INSEE"), "Verification source missing");

  console.log("PROFESSIONAL_VERIFICATION_TEST_PASS");
} finally {
  global.fetch = originalFetch;
}
