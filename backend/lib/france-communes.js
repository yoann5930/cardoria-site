const API_URL = "https://geo.api.gouv.fr/communes";

function failure(code, message, status = 502, meta = {}) {
  return Object.assign(new Error(message), { code, status, ...meta });
}

function raw(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeCity(value) {
  return raw(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function validPostalCode(value) {
  const postalCode = raw(value).replace(/\s+/g, "");
  if (!/^\d{5}$/.test(postalCode)) {
    throw failure("FRENCH_POSTAL_CODE_INVALID", "Code postal français invalide.", 400);
  }
  return postalCode;
}

export async function listFrenchCommunesByPostalCode(postalCode, { fetchImpl = globalThis.fetch, timeoutMs = 7000 } = {}) {
  const code = validPostalCode(postalCode);
  if (typeof fetchImpl !== "function") throw failure("FRENCH_COMMUNES_UNAVAILABLE", "Service de validation des communes indisponible.", 503);

  const url = new URL(API_URL);
  url.searchParams.set("codePostal", code);
  url.searchParams.set("fields", "nom,code,codesPostaux,population");
  url.searchParams.set("format", "json");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: controller.signal
    });
  } catch (error) {
    throw failure(
      controller.signal.aborted ? "FRENCH_COMMUNES_TIMEOUT" : "FRENCH_COMMUNES_UNAVAILABLE",
      "Impossible de vérifier le code postal pour le moment.",
      503
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw failure("FRENCH_COMMUNES_UNAVAILABLE", "Impossible de vérifier le code postal pour le moment.", 503, { providerStatus: response.status });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw failure("FRENCH_COMMUNES_INVALID_RESPONSE", "Réponse du référentiel des communes invalide.", 502);
  }

  const rows = Array.isArray(payload) ? payload : [];
  const byName = new Map();
  for (const row of rows) {
    const name = raw(row?.nom);
    const codeInsee = raw(row?.code);
    const postalCodes = Array.isArray(row?.codesPostaux) ? row.codesPostaux.map(raw) : [];
    if (!name || !codeInsee || !postalCodes.includes(code)) continue;
    const key = normalizeCity(name);
    const candidate = { name, codeInsee, population: Number(row?.population || 0) };
    const current = byName.get(key);
    if (!current || candidate.population > current.population) byName.set(key, candidate);
  }

  const communes = [...byName.values()]
    .sort((a, b) => (b.population - a.population) || a.name.localeCompare(b.name, "fr"))
    .map(({ name, codeInsee }) => ({ name, codeInsee }));

  return { postalCode: code, communes, source: "geo.api.gouv.fr" };
}

export async function resolveFrenchPostalCity(postalCode, city, options = {}) {
  const result = await listFrenchCommunesByPostalCode(postalCode, options);
  if (!result.communes.length) {
    throw failure("FRENCH_POSTAL_CODE_UNKNOWN", "Aucune commune française trouvée pour ce code postal.", 400);
  }

  const requested = normalizeCity(city);
  const exact = requested ? result.communes.find((item) => normalizeCity(item.name) === requested) : null;
  if (exact) return { postalCode: result.postalCode, city: exact.name, communes: result.communes };

  if (result.communes.length === 1) {
    return { postalCode: result.postalCode, city: result.communes[0].name, communes: result.communes };
  }

  if (!requested) {
    throw failure("FRENCH_CITY_REQUIRED", "Plusieurs villes correspondent à ce code postal. Sélectionnez votre ville.", 400, {
      allowedCities: result.communes.map((item) => item.name)
    });
  }

  throw failure("FRENCH_POSTAL_CITY_MISMATCH", "La ville ne correspond pas au code postal. Sélectionnez une ville proposée.", 400, {
    allowedCities: result.communes.map((item) => item.name)
  });
}

export function normalizeFrenchCityName(value) {
  return normalizeCity(value);
}
