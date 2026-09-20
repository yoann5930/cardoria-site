import { getDb, normalizeText, slugify } from "./database.js";
import { pokemonHitFamily } from "./tcgdex-sync.js";

const TCGCSV_BASE = "https://tcgcsv.com/tcgplayer";
const TCGCSV_CATEGORY = 3;
const SCRYDEX_BASE = "https://api.scrydex.com/pokemon/v1";
const REQUEST_TIMEOUT_MS = 30000;
const LANGUAGE_MAP = new Map([
  ["fr","fr"],["french","fr"],["francais","fr"],["français","fr"],
  ["en","en"],["english","en"],["anglais","en"],
  ["ja","ja"],["jp","ja"],["japanese","ja"],["japonais","ja"],
  ["ko","ko"],["kr","ko"],["korean","ko"],["coreen","ko"],["coréen","ko"]
]);

function raw(value) { return String(value == null ? "" : value).trim(); }
function nowIso() { return new Date().toISOString(); }
function parseJson(value, fallback = {}) { try { const parsed = JSON.parse(String(value || "")); return parsed && typeof parsed === "object" ? parsed : fallback; } catch { return fallback; } }
function safeJson(value) { return JSON.stringify(value && typeof value === "object" ? value : {}); }
function normalizeLanguage(value, fallback = "en") {
  const key = normalizeText(value);
  return LANGUAGE_MAP.get(key) || fallback;
}
function normalizeNumber(value) {
  const source = raw(value).split("/")[0].trim();
  if (!source) return "";
  const numeric = source.match(/^0*(\d+)$/)?.[1];
  return numeric ? String(Number(numeric)) : normalizeText(source).replace(/[^a-z0-9]/g, "");
}
function sourceMap(row) {
  const current = parseJson(row?.catalog_sources_json, {});
  return current && !Array.isArray(current) ? current : {};
}
function externalRefs(row) {
  const current = parseJson(row?.external_refs_json, {});
  return current && !Array.isArray(current) ? current : {};
}
function mergeSource(row, provider, payload = {}) {
  const sources = sourceMap(row);
  sources[provider] = { ...(sources[provider] || {}), ...payload, seenAt: nowIso() };
  return safeJson(sources);
}
function mergeRefs(row, refs = {}) {
  return safeJson({ ...externalRefs(row), ...Object.fromEntries(Object.entries(refs).filter(([,v]) => v !== "" && v != null)) });
}
function genericName(value) {
  return /^Carte Pokémon (?:anglaise|japonaise|coréenne|étrangère)(?:\s|$)/i.test(raw(value));
}
function genericExtension(value) {
  return /^Extension (?:anglaise|japonaise|coréenne|étrangère)(?:\s|$)/i.test(raw(value));
}
function extendedValue(product, names) {
  const wanted = new Set(names.map(normalizeText));
  for (const item of Array.isArray(product?.extendedData) ? product.extendedData : []) {
    const key = normalizeText(item?.name || item?.displayName || "");
    if (!wanted.has(key)) continue;
    const value = item?.value ?? item?.displayValue ?? item?.text ?? "";
    if (raw(value)) return raw(value);
  }
  return "";
}
async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "Cardoria/6.0 multisource-catalog", ...headers },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}
function ensureState(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS catalog_sync_state (
    provider TEXT PRIMARY KEY,
    cursor TEXT DEFAULT '',
    status TEXT DEFAULT 'idle',
    stats_json TEXT DEFAULT '{}',
    last_run_at TEXT DEFAULT '',
    completed_at TEXT DEFAULT '',
    error TEXT DEFAULT ''
  )`);
}
function readState(db, provider) {
  ensureState(db);
  return db.prepare("SELECT * FROM catalog_sync_state WHERE provider=?").get(provider) || { provider, cursor:"", status:"idle", stats_json:"{}", last_run_at:"", completed_at:"", error:"" };
}
function saveState(db, provider, patch = {}) {
  ensureState(db);
  const current = readState(db, provider);
  const next = { ...current, ...patch, provider };
  db.prepare(`INSERT INTO catalog_sync_state(provider,cursor,status,stats_json,last_run_at,completed_at,error)
    VALUES (@provider,@cursor,@status,@stats_json,@last_run_at,@completed_at,@error)
    ON CONFLICT(provider) DO UPDATE SET cursor=excluded.cursor,status=excluded.status,stats_json=excluded.stats_json,last_run_at=excluded.last_run_at,completed_at=excluded.completed_at,error=excluded.error`).run(next);
  return next;
}
function catalogCounts(db) {
  const rows = db.prepare("SELECT language,COUNT(*) AS count FROM cards WHERE license_slug='pokemon' AND active=1 GROUP BY language").all();
  const out = { fr:0,en:0,ja:0,ko:0,total:0 };
  for (const row of rows) { if (Object.prototype.hasOwnProperty.call(out,row.language)) out[row.language]=Number(row.count||0); out.total += Number(row.count||0); }
  return out;
}
function rebuildFts(db) {
  try { db.exec("DELETE FROM cards_fts; INSERT INTO cards_fts(rowid,name,extension,number,rarity,license_slug) SELECT rowid,name,extension,number,rarity,license_slug FROM cards;"); } catch {}
}

function findByExternalRef(db, key, value) {
  if (!value) return null;
  const needle = `%"${key}":"${String(value).replace(/[%_]/g,"")}"%`;
  return db.prepare("SELECT * FROM cards WHERE license_slug='pokemon' AND external_refs_json LIKE ? LIMIT 1").get(needle) || null;
}
function chooseExisting(db, { language, name, extension, extensionCode, number }) {
  const num = normalizeNumber(number);
  if (!num) return null;
  const candidates = db.prepare(`SELECT * FROM cards WHERE license_slug='pokemon' AND language=? AND active=1
    AND (number=? OR ltrim(number,'0')=?) LIMIT 80`).all(language, raw(number), num);
  if (!candidates.length) return null;
  const wantedName = normalizeText(name), wantedExtension = normalizeText(extension), wantedCode = normalizeText(extensionCode);
  const scored = candidates.map((row) => {
    let score = 0;
    const rowName = normalizeText(row.name), rowExt = normalizeText(row.extension), rowCode = normalizeText(row.extension_code);
    if (wantedName && rowName === wantedName) score += 8;
    else if (wantedName && rowName && (rowName.includes(wantedName) || wantedName.includes(rowName))) score += 3;
    if (wantedCode && rowCode === wantedCode) score += 8;
    if (wantedExtension && rowExt === wantedExtension) score += 7;
    else if (wantedExtension && rowExt && (rowExt.includes(wantedExtension) || wantedExtension.includes(rowExt))) score += 3;
    return { row, score };
  }).sort((a,b)=>b.score-a.score);
  if (scored[0]?.score >= 10 && scored[0].score > (scored[1]?.score || 0)) return scored[0].row;
  if (candidates.length === 1 && scored[0]?.score >= 8) return candidates[0];
  return null;
}

function upsertProviderCard(db, providerCard) {
  const provider = providerCard.provider;
  let current = providerCard.externalKey && providerCard.externalValue
    ? findByExternalRef(db, providerCard.externalKey, providerCard.externalValue)
    : null;
  if (!current) current = chooseExisting(db, providerCard);

  const now = nowIso();
  if (current) {
    const nextName = (!raw(current.name) || genericName(current.name)) && providerCard.name ? providerCard.name : current.name;
    const nextExtension = (!raw(current.extension) || genericExtension(current.extension)) && providerCard.extension ? providerCard.extension : current.extension;
    const nextNumber = raw(current.number) || providerCard.number;
    const nextRarity = raw(current.rarity) || providerCard.rarity;
    const nextImageHd = raw(current.image_hd) || providerCard.imageHd;
    const nextImageThumb = raw(current.image_thumb) || providerCard.imageThumb || providerCard.imageHd;
    const nextIllustration = raw(current.illustration) || providerCard.illustration;
    const nextCatalogSource = raw(current.catalog_source) || provider;
    const nextSourceUrl = raw(current.catalog_source_url) || providerCard.sourceUrl;
    const sourcesJson = mergeSource(current, provider, providerCard.provenance || {});
    const refsJson = mergeRefs(current, providerCard.refs || {});
    const family = raw(current.hit_family) || pokemonHitFamily(nextRarity, nextName);
    const changed = db.prepare(`UPDATE cards SET name=?,name_normalized=?,extension=?,extension_code=?,number=?,rarity=?,hit_family=?,
      illustration=?,image_hd=?,image_thumb=?,catalog_source=?,catalog_source_url=?,catalog_sources_json=?,external_refs_json=?,updated_at=?
      WHERE id=?`).run(nextName, normalizeText(nextName), nextExtension, raw(current.extension_code) || providerCard.extensionCode,
        nextNumber, nextRarity, family, nextIllustration, nextImageHd, nextImageThumb, nextCatalogSource, nextSourceUrl,
        sourcesJson, refsJson, now, current.id).changes || 0;
    return { matched:1, created:0, updated:changed ? 1 : 0, id:current.id };
  }

  const name = providerCard.name || "Carte Pokémon";
  const extension = providerCard.extension || providerCard.extensionCode || "";
  const number = providerCard.number || "";
  const id = providerCard.id;
  const slug = slugify(`${providerCard.language}-${name}-${extension}-${number}-${id}`);
  const sourcesJson = safeJson({ [provider]: { ...(providerCard.provenance || {}), seenAt:now } });
  const refsJson = safeJson(providerCard.refs || {});
  const metaTitle = `${name}${number ? " " + number : ""}${extension ? " — " + extension : ""} | Cardoria`;
  const metaDescription = `Référence Pokémon ${name}${extension ? ", extension " + extension : ""}${number ? ", numéro " + number : ""}, langue ${providerCard.language.toUpperCase()}.`;
  db.prepare(`INSERT INTO cards (id,license_slug,language,slug,name,name_normalized,extension,extension_code,number,rarity,hit_family,
    variants_json,illustration,image_hd,image_thumb,condition_note,avg_price,low_price,high_price,recommended_price,market_trend,trend_percent,
    sales_count,views,meta_title,meta_description,catalog_source,catalog_source_url,catalog_sources_json,external_refs_json,active,created_at,updated_at)
    VALUES (?,'pokemon',?,?,?,?,?,?,?,?,?,'{}',?,?,?,'NM',0,0,0,0,'stable',0,0,0,?,?,?,?,?,?,?,1,?,?)`)
    .run(id, providerCard.language, slug, name, normalizeText(name), extension, providerCard.extensionCode, number, providerCard.rarity,
      pokemonHitFamily(providerCard.rarity, name), providerCard.illustration, providerCard.imageHd, providerCard.imageThumb || providerCard.imageHd,
      metaTitle, metaDescription, provider, providerCard.sourceUrl, sourcesJson, refsJson, now, now);
  return { matched:0, created:1, updated:0, id };
}

function tcgcsvCard(group, product) {
  const number = extendedValue(product, ["number","card number"]);
  if (!number) return null;
  const rarity = extendedValue(product, ["rarity"]);
  const name = raw(product?.cleanName || product?.name);
  if (!name) return null;
  const productId = Number(product?.productId || 0);
  if (!productId) return null;
  return {
    provider:"tcgcsv-tcgplayer",
    id:`pokemon-en-tcgplayer-${productId}`,
    language:"en",
    name,
    extension:raw(group?.name),
    extensionCode:raw(group?.abbreviation) || String(group?.groupId || ""),
    number,
    rarity,
    illustration:extendedValue(product, ["artist","illustrator"]),
    imageHd:raw(product?.imageUrl),
    imageThumb:raw(product?.imageUrl),
    sourceUrl:raw(product?.url) || "https://tcgcsv.com",
    externalKey:"tcgplayerProductId",
    externalValue:String(productId),
    refs:{ tcgplayerProductId:String(productId), tcgcsvGroupId:String(group?.groupId || "") },
    provenance:{ groupId:Number(group?.groupId||0), groupName:raw(group?.name), productId, url:raw(product?.url) }
  };
}

export async function syncPokemonTcgcsvCatalog({ groupLimit = 12, reset = false } = {}) {
  const db = getDb(); ensureState(db);
  const provider = "tcgcsv-tcgplayer";
  if (reset) saveState(db, provider, { cursor:"0",status:"idle",stats_json:"{}",error:"",completed_at:"" });
  const state = readState(db, provider);
  const groupsPayload = await fetchJson(`${TCGCSV_BASE}/${TCGCSV_CATEGORY}/groups`);
  const groups = Array.isArray(groupsPayload?.results) ? groupsPayload.results : [];
  if (!groups.length) throw new Error("TCGCSV Pokemon groups unavailable");
  const start = Math.max(0, Number(state.cursor || 0));
  const safeLimit = Math.min(Math.max(Number(groupLimit)||12,1),30);
  const batch = groups.slice(start, start + safeLimit);
  let scannedProducts=0, cardProducts=0, created=0, matched=0, updated=0, failures=0;
  saveState(db, provider, { status:"running",last_run_at:nowIso(),error:"" });
  try {
    for (const group of batch) {
      try {
        const payload = await fetchJson(`${TCGCSV_BASE}/${TCGCSV_CATEGORY}/${Number(group.groupId)}/products`);
        const products = Array.isArray(payload?.results) ? payload.results : [];
        scannedProducts += products.length;
        for (const product of products) {
          const card = tcgcsvCard(group, product);
          if (!card) continue;
          cardProducts += 1;
          const result = upsertProviderCard(db, card);
          created += result.created; matched += result.matched; updated += result.updated;
        }
      } catch (error) {
        failures += 1;
        console.warn(`[pokemon-multisource:tcgcsv] group=${group?.groupId} failed ${error?.message || error}`);
      }
    }
    const next = start + batch.length;
    const complete = next >= groups.length;
    const stats = { groupsTotal:groups.length, groupsProcessed:batch.length, cursor:complete ? 0 : next, scannedProducts, cardProducts, created, matched, updated, failures };
    saveState(db, provider, { cursor:String(complete ? 0 : next),status:complete?"complete":"partial",stats_json:safeJson(stats),completed_at:complete?nowIso():"",error:"" });
    if (created || updated) rebuildFts(db);
    return { ok:true, provider, complete, ...stats, counts:catalogCounts(db) };
  } catch (error) {
    saveState(db, provider, { status:"error",error:error?.message||String(error),last_run_at:nowIso() });
    throw error;
  }
}

function scrydexHeaders() {
  const apiKey = raw(process.env.SCRYDEX_API_KEY);
  const teamId = raw(process.env.SCRYDEX_TEAM_ID);
  return {
    configured:Boolean(apiKey && teamId),
    headers: apiKey && teamId ? { "X-Api-Key":apiKey, "X-Team-ID":teamId } : {}
  };
}
function scrydexImage(card) {
  const images = Array.isArray(card?.images) ? card.images : [];
  const front = images.find((item)=>normalizeText(item?.type)==="front") || images[0] || {};
  return { hd:raw(front.large || front.medium || front.small), thumb:raw(front.small || front.medium || front.large) };
}
function scrydexCard(rawCard) {
  const id = raw(rawCard?.id);
  const name = raw(rawCard?.name);
  const number = raw(rawCard?.number || rawCard?.printed_number);
  if (!id || !name || !number) return null;
  const expansion = rawCard?.expansion || {};
  const language = normalizeLanguage(rawCard?.language_code || rawCard?.language, "en");
  const image = scrydexImage(rawCard);
  return {
    provider:"scrydex",
    id:`pokemon-${language}-scrydex-${id}`,
    language,
    name,
    extension:raw(expansion?.name),
    extensionCode:raw(expansion?.id),
    number,
    rarity:raw(rawCard?.rarity),
    illustration:raw(rawCard?.artist),
    imageHd:image.hd,
    imageThumb:image.thumb,
    sourceUrl:`https://scrydex.com`,
    externalKey:"scrydexId",
    externalValue:id,
    refs:{ scrydexId:id },
    provenance:{ expansionId:raw(expansion?.id), languageCode:raw(rawCard?.language_code), printedNumber:raw(rawCard?.printed_number) }
  };
}
export async function syncPokemonScrydexCatalog({ pageLimit = 10, reset = false } = {}) {
  const db = getDb(); ensureState(db);
  const provider = "scrydex";
  const auth = scrydexHeaders();
  if (!auth.configured) return { ok:true, provider, skipped:true, reason:"SCRYDEX_API_KEY_or_TEAM_ID_missing", counts:catalogCounts(db) };
  if (reset) saveState(db, provider, { cursor:"1",status:"idle",stats_json:"{}",error:"",completed_at:"" });
  const state = readState(db, provider);
  let page = Math.max(1, Number(state.cursor || 1));
  const safeLimit = Math.min(Math.max(Number(pageLimit)||10,1),25);
  let pagesProcessed=0,totalCount=0,scanned=0,created=0,matched=0,updated=0;
  saveState(db, provider, { status:"running",last_run_at:nowIso(),error:"" });
  try {
    for (let i=0;i<safeLimit;i+=1) {
      const url = new URL(`${SCRYDEX_BASE}/cards`);
      url.searchParams.set("page",String(page));
      url.searchParams.set("page_size","100");
      url.searchParams.set("select","id,name,number,printed_number,rarity,artist,images,expansion,language,language_code");
      const payload = await fetchJson(url.toString(), auth.headers);
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      totalCount = Number(payload?.totalCount || payload?.total_count || totalCount || 0);
      if (!rows.length) break;
      scanned += rows.length; pagesProcessed += 1;
      for (const rawCard of rows) {
        const card = scrydexCard(rawCard); if (!card) continue;
        const result = upsertProviderCard(db, card);
        created += result.created; matched += result.matched; updated += result.updated;
      }
      page += 1;
      if (totalCount && (page - 1) * 100 >= totalCount) break;
      if (rows.length < 100) break;
    }
    const complete = Boolean(totalCount && (page - 1) * 100 >= totalCount);
    const stats = { pagesProcessed, page, totalCount, scanned, created, matched, updated };
    saveState(db, provider, { cursor:String(complete?1:page),status:complete?"complete":"partial",stats_json:safeJson(stats),completed_at:complete?nowIso():"",error:"" });
    if (created || updated) rebuildFts(db);
    return { ok:true, provider, complete, ...stats, counts:catalogCounts(db) };
  } catch (error) {
    saveState(db, provider, { status:"error",error:error?.message||String(error),last_run_at:nowIso() });
    throw error;
  }
}

export function getPokemonMultiSourceStatus() {
  const db = getDb(); ensureState(db);
  const states = db.prepare("SELECT provider,cursor,status,stats_json,last_run_at,completed_at,error FROM catalog_sync_state ORDER BY provider").all()
    .map((row)=>({ ...row, stats:parseJson(row.stats_json,{}) }));
  const scrydex = scrydexHeaders();
  return {
    counts:catalogCounts(db),
    providers:{
      tcgdex:{ configured:true, role:"primary multilingual catalog" },
      tcgcsv:{ configured:true, role:"English gap filler / TCGplayer references" },
      scrydex:{ configured:scrydex.configured, role:"optional cross-check and gap filler" },
      pokemonKorea:{ configured:true, role:"Korean official references" },
      zebraDex:{ configured:true, role:"French/Japanese image and price fallback" }
    },
    states
  };
}

export async function syncPokemonMultiSourceCatalog({ tcgcsvGroupLimit=12, scrydexPageLimit=10, reset=false } = {}) {
  const results = [];
  try { results.push(await syncPokemonTcgcsvCatalog({ groupLimit:tcgcsvGroupLimit, reset })); }
  catch (error) { results.push({ ok:false,provider:"tcgcsv-tcgplayer",error:error?.message||String(error) }); }
  try { results.push(await syncPokemonScrydexCatalog({ pageLimit:scrydexPageLimit, reset })); }
  catch (error) { results.push({ ok:false,provider:"scrydex",error:error?.message||String(error) }); }
  return { ok:results.some((item)=>item.ok), results, ...getPokemonMultiSourceStatus(), syncedAt:nowIso() };
}
