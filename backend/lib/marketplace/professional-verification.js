/** Vérification professionnelle vendeur via données publiques françaises (SIRENE/INSEE). */
const API_BASE = "https://recherche-entreprises.api.gouv.fr/search";
const TIMEOUT_MS = 8000;

function normalizeSiret(value) {
  return String(value || "").replace(/\D/g, "");
}

function legalName(result) {
  return String(
    result?.nom_complet ||
    result?.nom_raison_sociale ||
    result?.denomination ||
    result?.nom_raison_sociale ||
    result?.siege?.nom_commercial ||
    ""
  ).trim().slice(0, 200);
}

function establishmentRows(result) {
  const rows = [];
  if (result?.siege) rows.push(result.siege);
  if (Array.isArray(result?.matching_etablissements)) rows.push(...result.matching_etablissements);
  return rows;
}

function resultMatchesSiret(result, siret) {
  return establishmentRows(result).find((row) => String(row?.siret || "").replace(/\D/g, "") === siret) || null;
}

function isActive(value) {
  return String(value || "").trim().toUpperCase() === "A";
}

export async function verifyFrenchProfessionalSiret(rawSiret) {
  const siret = normalizeSiret(rawSiret);
  if (!/^\d{14}$/.test(siret)) {
    throw Object.assign(new Error("SIRET invalide : 14 chiffres sont requis."), { status: 400, code: "SELLER_SIRET_INVALID" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    const url = new URL(API_BASE);
    url.searchParams.set("q", siret);
    url.searchParams.set("per_page", "1");
    url.searchParams.set("limite_matching_etablissements", "25");
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Cardoria/6.0 professional-verification (cardoriashop.fr)"
      },
      signal: controller.signal
    });
  } catch (error) {
    throw Object.assign(new Error("Vérification SIRET temporairement indisponible. Réessayez dans quelques instants."), {
      status: 503,
      code: "SELLER_SIRET_VERIFICATION_UNAVAILABLE",
      cause: error
    });
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    throw Object.assign(new Error("Service de vérification SIRET temporairement limité. Réessayez dans quelques instants."), {
      status: 503,
      code: "SELLER_SIRET_RATE_LIMITED"
    });
  }
  if (!response.ok) {
    throw Object.assign(new Error("Impossible de vérifier le SIRET auprès du registre public."), {
      status: 503,
      code: "SELLER_SIRET_VERIFICATION_FAILED"
    });
  }

  const data = await response.json().catch(() => ({}));
  const results = Array.isArray(data?.results) ? data.results : [];
  const exact = results.find((result) => resultMatchesSiret(result, siret));
  if (!exact) {
    throw Object.assign(new Error("SIRET introuvable dans les données publiques SIRENE/INSEE."), {
      status: 422,
      code: "SELLER_SIRET_NOT_FOUND"
    });
  }

  if (!isActive(exact?.etat_administratif)) {
    throw Object.assign(new Error("L'entreprise correspondant à ce SIRET n'est pas active."), {
      status: 422,
      code: "SELLER_COMPANY_INACTIVE"
    });
  }

  const establishment = resultMatchesSiret(exact, siret);
  if (establishment?.etat_administratif && !isActive(establishment.etat_administratif)) {
    throw Object.assign(new Error("L'établissement correspondant à ce SIRET n'est pas actif."), {
      status: 422,
      code: "SELLER_ESTABLISHMENT_INACTIVE"
    });
  }

  return {
    verified: true,
    siret,
    siren: String(exact?.siren || siret.slice(0, 9)).replace(/\D/g, "").slice(0, 9),
    legalName: legalName(exact) || "Entreprise vérifiée",
    activityCode: String(exact?.activite_principale || establishment?.activite_principale || "").trim().slice(0, 20),
    legalCategory: String(exact?.nature_juridique || "").trim().slice(0, 40),
    establishmentAddress: String(
      establishment?.adresse ||
      establishment?.adresse_complete ||
      establishment?.geo_adresse ||
      ""
    ).trim().slice(0, 300),
    source: "recherche-entreprises.api.gouv.fr / SIRENE-INSEE",
    verifiedAt: new Date().toISOString()
  };
}
