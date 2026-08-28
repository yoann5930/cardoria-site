import { getDb, normalizeText, slugify } from "./database.js";

const IMAGE_ROOT = "https://cards.image.pokemonkorea.co.kr/data/wmimages";
const CHECK_RETRY_MS = 30 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12000;
const CONCURRENCY = 8;

const VERIFIED_KOREAN_CARDS = [
  {
    extensionCode: "sv9a",
    number: "053",
    nameFr: "Tauros",
    sourceName: "켄타로스",
    extensionFr: "Heat Wave Arena",
    sourceExtension: "열풍의 아레나",
    rarity: "Commune",
    sourceRarity: "C",
    illustration: "yuu",
    officialDetail: "https://pokemoncard.co.kr/cards",
    officialImage: "https://cards.image.pokemonkorea.co.kr/data/wmimages/SV/SV9a/SV9a_053.png?w=512"
  }
];

function ensureColumns(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(cards)").all().map((row) => row.name));
  const additions = [
    ["korea_official_checked_at", "TEXT DEFAULT ''"],
    ["catalog_source", "TEXT DEFAULT ''"],
    ["catalog_source_url", "TEXT DEFAULT ''"],
    ["image_source", "TEXT DEFAULT ''"],
    ["price_source_note", "TEXT DEFAULT ''"]
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) db.exec(`ALTER TABLE cards ADD COLUMN ${name} ${definition}`);
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_cards_korea_check ON cards(language,korea_official_checked_at,extension_code,active)");
  return db;
}

function normalizeSetCode(value) {
  const raw = String(value || "").trim();
  if (/^sv/i.test(raw)) return `SV${raw.slice(2)}`;
  if (/^s\d/i.test(raw)) return `S${raw.slice(1)}`;
  if (/^sm/i.test(raw)) return `SM${raw.slice(2)}`;
  if (/^xy/i.test(raw)) return `XY${raw.slice(2)}`;
  if (/^bw/i.test(raw)) return `BW${raw.slice(2)}`;
  if (/^dp/i.test(raw)) return `DP${raw.slice(2)}`;
  return raw;
}

function officialFamily(code) {
  if (/^SV/i.test(code)) return "SV";
  if (/^S\d/i.test(code)) return "S";
  if (/^SM/i.test(code)) return "SM";
  if (/^XY/i.test(code)) return "XY";
  if (/^BW/i.test(code)) return "BW";
  if (/^DP/i.test(code)) return "DP";
  return "";
}

function supportedOfficialSet(value) {
  const code = normalizeSetCode(value);
  return Boolean(officialFamily(code));
}

function normalizedNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return raw.padStart(3, "0");
  return raw;
}

function rawIdFromJapaneseId(id) {
  const value = String(id || "");
  return value.startsWith("pokemon-ja-") ? value.slice("pokemon-ja-".length) : "";
}

function koreanIdFromJapaneseId(id) {
  const raw = rawIdFromJapaneseId(id);
  return raw ? `pokemon-ko-${raw}` : "";
}

function imageCandidates(extensionCode, number) {
  const code = normalizeSetCode(extensionCode);
  const family = officialFamily(code);
  const num = normalizedNumber(number);
  if (!family || !code || !num) return [];
  const rawNumber = String(number || "").trim();
  const candidates = [
    `${IMAGE_ROOT}/${family}/${code}/${code}_${num}.png?w=512`,
    `${IMAGE_ROOT}/${family}/${code}/${code}_${rawNumber}.png?w=512`
  ];
  // Some older Korean assets use the same family directory but lowercase or
  // unpadded card numbers. We only accept a candidate after an image response.
  if (family !== "SV" && family !== "S") {
    candidates.push(`${IMAGE_ROOT}/${family}/${code.toLowerCase()}/${code}_${num}.png?w=512`);
    candidates.push(`${IMAGE_ROOT}/${family}/${code}/${code.toLowerCase()}_${num}.png?w=512`);
  }
  return candidates.filter((value, index, array) => value && array.indexOf(value) === index);
}

async function probeImage(url) {
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Range: "bytes=0-256",
        "User-Agent": "Cardoria/6.0 Pokemon-Korea-catalog-audit"
      },
      signal: controller.signal
    });
    if (!response.ok && response.status !== 206) return false;
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    return type.startsWith("image/") || type === "application/octet-stream";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function firstExistingImage(extensionCode, number) {
  for (const url of imageCandidates(extensionCode, number)) {
    if (await probeImage(url)) return url;
  }
  return "";
}

function japaneseCardFor(db, extensionCode, number) {
  const num = String(Number(String(number || "").replace(/^0+/, "")) || 0);
  return db.prepare(`SELECT * FROM cards
    WHERE license_slug='pokemon' AND language='ja' AND lower(extension_code)=lower(?)
      AND (number=? OR ltrim(number,'0')=?) AND active=1
    ORDER BY CASE WHEN number=? THEN 0 ELSE 1 END, id LIMIT 1`).get(extensionCode, number, num, number);
}

function frenchEquivalent(db, japaneseId) {
  const raw = rawIdFromJapaneseId(japaneseId);
  if (!raw) return null;
  return db.prepare("SELECT * FROM cards WHERE id=? AND license_slug='pokemon' AND language='fr' AND active=1 LIMIT 1").get(`pokemon-${raw}`) || null;
}

function proxyMarketSource(ja) {
  const source = String(ja?.market_source || "").toLowerCase();
  if (!Number(ja?.recommended_price || 0)) return "";
  if (source.includes("cardmarket")) return "cardmarket-jp-proxy";
  if (source.includes("zebradex")) return "zebradex-jp-proxy";
  return source ? "japanese-market-proxy" : "";
}

function proxyMarketNote(source) {
  if (source === "cardmarket-jp-proxy") return "Référence de marché japonaise Cardmarket utilisée comme proxy; ce n'est pas un prix de vente coréen certifié.";
  if (source === "zebradex-jp-proxy") return "Cote japonaise ZebraDex utilisée comme proxy; ce n'est pas un prix de vente coréen certifié.";
  if (source) return "Référence de marché japonaise utilisée comme proxy; ce n'est pas un prix de vente coréen certifié.";
  return "";
}

function insertKoreanFromReference(db, ja, verified, imageUrl, now) {
  const fr = ja ? frenchEquivalent(db, ja.id) : null;
  const id = ja ? koreanIdFromJapaneseId(ja.id) : `pokemon-ko-${verified.extensionCode}-${verified.number}`;
  if (!id) return { inserted: 0, id: "" };

  const name = verified.nameFr || fr?.name || ja?.name || "Carte Pokémon coréenne";
  const extension = verified.extensionFr || fr?.extension || ja?.extension || verified.extensionCode || "Extension coréenne";
  const number = verified.number || ja?.number || "";
  const rarity = verified.rarity || fr?.rarity || ja?.rarity || "Non renseignée";
  const hitFamily = fr?.hit_family || ja?.hit_family || "";
  const variants = ja?.variants_json || fr?.variants_json || "{}";
  const recommended = Number(ja?.recommended_price || 0);
  const marketSource = proxyMarketSource(ja);

  const row = {
    id,
    slug: slugify(`ko-${name}-${extension}-${number}-${id}`),
    name,
    name_normalized: normalizeText(name),
    extension,
    extension_code: verified.extensionCode || ja?.extension_code || "",
    number,
    rarity,
    hit_family: hitFamily,
    variants_json: variants,
    illustration: verified.illustration || ja?.illustration || "",
    image_hd: imageUrl,
    image_thumb: imageUrl,
    avg_price: recommended > 0 ? Number(ja?.avg_price || recommended) : 0,
    low_price: recommended > 0 ? Number(ja?.low_price || recommended) : 0,
    high_price: recommended > 0 ? Number(ja?.high_price || recommended) : 0,
    recommended_price: recommended,
    market_avg1: recommended > 0 ? Number(ja?.market_avg1 || 0) : 0,
    market_avg7: recommended > 0 ? Number(ja?.market_avg7 || 0) : 0,
    market_avg30: recommended > 0 ? Number(ja?.market_avg30 || 0) : 0,
    market_source: marketSource,
    market_updated_at: recommended > 0 ? String(ja?.market_updated_at || "") : "",
    market_checked_at: recommended > 0 ? now : "",
    market_trend: ja?.market_trend || "stable",
    trend_percent: Number(ja?.trend_percent || 0),
    meta_title: `${name} — ${extension} · version coréenne | Cardoria`,
    meta_description: `Référence Cardoria en français pour ${name}, ${extension}, carte coréenne ${number}.`,
    source_name: verified.sourceName || "",
    source_extension: verified.sourceExtension || ja?.source_extension || "",
    source_rarity: verified.sourceRarity || ja?.source_rarity || ja?.rarity || "",
    source_image_hd: imageUrl,
    source_image_thumb: imageUrl,
    translation_source: "pokemon-korea-official+reference-fr",
    image_language: imageUrl ? "ko" : "",
    image_source: imageUrl ? "pokemon-korea-official" : "",
    catalog_source: "pokemon-korea-official",
    catalog_source_url: verified.officialDetail || "https://pokemoncard.co.kr/cards",
    price_source_note: proxyMarketNote(marketSource),
    now
  };

  const existing = db.prepare("SELECT id FROM cards WHERE id=? LIMIT 1").get(id);
  const sql = `INSERT INTO cards (
      id,license_slug,language,slug,name,name_normalized,extension,extension_code,number,rarity,hit_family,variants_json,illustration,
      image_hd,image_thumb,condition_note,avg_price,low_price,high_price,recommended_price,market_avg1,market_avg7,market_avg30,
      market_source,market_updated_at,market_checked_at,market_trend,trend_percent,sales_count,views,meta_title,meta_description,
      active,created_at,updated_at,source_name,source_extension,source_rarity,source_image_hd,source_image_thumb,translation_source,
      image_language,image_source,korea_official_checked_at,catalog_source,catalog_source_url,price_source_note)
    VALUES (@id,'pokemon','ko',@slug,@name,@name_normalized,@extension,@extension_code,@number,@rarity,@hit_family,@variants_json,@illustration,
      @image_hd,@image_thumb,'NM',@avg_price,@low_price,@high_price,@recommended_price,@market_avg1,@market_avg7,@market_avg30,
      @market_source,@market_updated_at,@market_checked_at,@market_trend,@trend_percent,0,0,@meta_title,@meta_description,
      1,@now,@now,@source_name,@source_extension,@source_rarity,@source_image_hd,@source_image_thumb,@translation_source,
      @image_language,@image_source,@now,@catalog_source,@catalog_source_url,@price_source_note)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,name_normalized=excluded.name_normalized,extension=excluded.extension,extension_code=excluded.extension_code,
      number=excluded.number,rarity=CASE WHEN excluded.rarity<>'' THEN excluded.rarity ELSE cards.rarity END,
      hit_family=CASE WHEN excluded.hit_family<>'' THEN excluded.hit_family ELSE cards.hit_family END,
      illustration=CASE WHEN excluded.illustration<>'' THEN excluded.illustration ELSE cards.illustration END,
      image_hd=CASE WHEN excluded.image_hd<>'' THEN excluded.image_hd ELSE cards.image_hd END,
      image_thumb=CASE WHEN excluded.image_thumb<>'' THEN excluded.image_thumb ELSE cards.image_thumb END,
      image_language=CASE WHEN excluded.image_hd<>'' THEN 'ko' ELSE cards.image_language END,
      image_source=CASE WHEN excluded.image_hd<>'' THEN 'pokemon-korea-official' ELSE cards.image_source END,
      source_image_hd=CASE WHEN excluded.source_image_hd<>'' THEN excluded.source_image_hd ELSE cards.source_image_hd END,
      source_image_thumb=CASE WHEN excluded.source_image_thumb<>'' THEN excluded.source_image_thumb ELSE cards.source_image_thumb END,
      source_name=CASE WHEN excluded.source_name<>'' THEN excluded.source_name ELSE cards.source_name END,
      source_extension=CASE WHEN excluded.source_extension<>'' THEN excluded.source_extension ELSE cards.source_extension END,
      source_rarity=CASE WHEN excluded.source_rarity<>'' THEN excluded.source_rarity ELSE cards.source_rarity END,
      translation_source=excluded.translation_source,korea_official_checked_at=excluded.korea_official_checked_at,
      catalog_source=excluded.catalog_source,catalog_source_url=CASE WHEN excluded.catalog_source_url<>'' THEN excluded.catalog_source_url ELSE cards.catalog_source_url END,
      avg_price=CASE WHEN excluded.recommended_price>0 AND cards.recommended_price<=0 THEN excluded.avg_price ELSE cards.avg_price END,
      low_price=CASE WHEN excluded.recommended_price>0 AND cards.recommended_price<=0 THEN excluded.low_price ELSE cards.low_price END,
      high_price=CASE WHEN excluded.recommended_price>0 AND cards.recommended_price<=0 THEN excluded.high_price ELSE cards.high_price END,
      recommended_price=CASE WHEN excluded.recommended_price>0 AND cards.recommended_price<=0 THEN excluded.recommended_price ELSE cards.recommended_price END,
      market_source=CASE WHEN excluded.recommended_price>0 AND cards.recommended_price<=0 THEN excluded.market_source ELSE cards.market_source END,
      price_source_note=CASE WHEN excluded.price_source_note<>'' THEN excluded.price_source_note ELSE cards.price_source_note END,
      active=1,updated_at=excluded.updated_at`;
  db.prepare(sql).run(row);
  return { inserted: existing ? 0 : 1, updated: existing ? 1 : 0, id };
}

function insertKoreanFromJapanese(db, ja, imageUrl, now) {
  const fr = frenchEquivalent(db, ja.id);
  const verified = {
    extensionCode: ja.extension_code,
    number: ja.number,
    nameFr: fr?.name || ja.name,
    extensionFr: fr?.extension || ja.extension,
    rarity: fr?.rarity || ja.rarity,
    sourceRarity: ja.source_rarity || ja.rarity,
    illustration: ja.illustration || "",
    sourceExtension: ja.source_extension || ja.extension,
    officialDetail: "https://pokemoncard.co.kr/cards"
  };
  return insertKoreanFromReference(db, ja, verified, imageUrl, now);
}

export function syncKoreanCardmarketProxyPrices() {
  const db = ensureColumns(getDb());
  const now = new Date().toISOString();
  const rows = db.prepare(`SELECT k.id AS ko_id,j.* FROM cards k
    JOIN cards j ON j.id='pokemon-ja-' || substr(k.id,length('pokemon-ko-')+1)
    WHERE k.license_slug='pokemon' AND k.language='ko' AND k.active=1
      AND k.recommended_price<=0 AND j.language='ja' AND j.recommended_price>0`).all();
  const update = db.prepare(`UPDATE cards SET avg_price=?,low_price=?,high_price=?,recommended_price=?,market_avg1=?,market_avg7=?,market_avg30=?,
    market_source=?,market_updated_at=?,market_checked_at=?,market_trend=?,trend_percent=?,price_source_note=?,updated_at=? WHERE id=? AND recommended_price<=0`);
  let updated = 0;
  db.transaction(() => {
    for (const row of rows) {
      const source = proxyMarketSource(row);
      if (!source) continue;
      updated += update.run(Number(row.avg_price || row.recommended_price || 0), Number(row.low_price || row.recommended_price || 0),
        Number(row.high_price || row.recommended_price || 0), Number(row.recommended_price || 0), Number(row.market_avg1 || 0),
        Number(row.market_avg7 || 0), Number(row.market_avg30 || 0), source, String(row.market_updated_at || ""), now,
        String(row.market_trend || "stable"), Number(row.trend_percent || 0), proxyMarketNote(source), now, row.ko_id).changes || 0;
    }
  })();
  if (updated) console.log(`[pokemon-korea-prices] ${updated} Korean card(s) received a verified Japanese market proxy`);
  return { ok: true, updated };
}

function officialSqlPredicate(alias = "j") {
  return `(lower(${alias}.extension_code) LIKE 'sv%' OR lower(${alias}.extension_code) GLOB 's[0-9]*' OR lower(${alias}.extension_code) LIKE 'sm%' OR lower(${alias}.extension_code) LIKE 'xy%' OR lower(${alias}.extension_code) LIKE 'bw%' OR lower(${alias}.extension_code) LIKE 'dp%')`;
}

export function getKoreanOfficialBackfillStatus() {
  const db = ensureColumns(getDb());
  const retryBefore = new Date(Date.now() - CHECK_RETRY_MS).toISOString();
  const ko = Number(db.prepare("SELECT COUNT(*) AS c FROM cards WHERE license_slug='pokemon' AND language='ko' AND active=1").get()?.c || 0);
  const official = Number(db.prepare("SELECT COUNT(*) AS c FROM cards WHERE license_slug='pokemon' AND language='ko' AND active=1 AND catalog_source='pokemon-korea-official'").get()?.c || 0);
  const missingImages = Number(db.prepare("SELECT COUNT(*) AS c FROM cards WHERE license_slug='pokemon' AND language='ko' AND active=1 AND (COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='')").get()?.c || 0);
  const missingPrices = Number(db.prepare("SELECT COUNT(*) AS c FROM cards WHERE license_slug='pokemon' AND language='ko' AND active=1 AND recommended_price<=0").get()?.c || 0);
  const pendingOfficial = Number(db.prepare(`SELECT COUNT(*) AS c FROM cards j
    WHERE j.license_slug='pokemon' AND j.language='ja' AND j.active=1
      AND ${officialSqlPredicate('j')}
      AND NOT EXISTS (SELECT 1 FROM cards k WHERE k.id='pokemon-ko-' || substr(j.id,length('pokemon-ja-')+1) AND k.active=1)
      AND (COALESCE(j.korea_official_checked_at,'')='' OR j.korea_official_checked_at<?)`).get(retryBefore)?.c || 0);
  return { ko, official, missingImages, missingPrices, pendingOfficial };
}

export function verifyKoreanTauros() {
  const db = ensureColumns(getDb());
  const row = db.prepare(`SELECT id,name,extension,extension_code,number,image_hd,recommended_price,market_source,catalog_source
    FROM cards WHERE license_slug='pokemon' AND language='ko' AND lower(extension_code)='sv9a'
      AND (number='053' OR ltrim(number,'0')='53') AND active=1 LIMIT 1`).get();
  return row || null;
}

export async function backfillKoreanOfficialCards({ limit = 120, discover = true } = {}) {
  const db = ensureColumns(getDb());
  const now = new Date().toISOString();
  let added = 0, updated = 0, checked = 0, found = 0;

  for (const verified of VERIFIED_KOREAN_CARDS) {
    const ja = japaneseCardFor(db, verified.extensionCode, verified.number);
    let imageUrl = "";
    if (verified.officialImage && await probeImage(verified.officialImage)) imageUrl = verified.officialImage;
    if (!imageUrl) imageUrl = await firstExistingImage(verified.extensionCode, verified.number);
    const result = insertKoreanFromReference(db, ja, verified, imageUrl, now);
    added += result.inserted || 0;
    updated += result.updated || 0;
    if (imageUrl) found += 1;
  }

  if (discover) {
    const retryBefore = new Date(Date.now() - CHECK_RETRY_MS).toISOString();
    const safeLimit = Math.min(Math.max(Number(limit) || 120, 1), 400);
    const targets = db.prepare(`SELECT j.* FROM cards j
      WHERE j.license_slug='pokemon' AND j.language='ja' AND j.active=1
        AND ${officialSqlPredicate('j')}
        AND COALESCE(j.number,'')<>''
        AND NOT EXISTS (SELECT 1 FROM cards k WHERE k.id='pokemon-ko-' || substr(j.id,length('pokemon-ja-')+1) AND k.active=1)
        AND (COALESCE(j.korea_official_checked_at,'')='' OR j.korea_official_checked_at<?)
      ORDER BY CASE WHEN lower(j.extension_code)='sv9a' THEN 0 WHEN lower(j.extension_code) LIKE 'sv%' THEN 1 WHEN lower(j.extension_code) GLOB 's[0-9]*' THEN 2 ELSE 3 END,
        CASE WHEN COALESCE(j.korea_official_checked_at,'')='' THEN 0 ELSE 1 END,
        j.extension_code DESC,j.id LIMIT ?`).all(retryBefore, safeLimit);

    const mark = db.prepare("UPDATE cards SET korea_official_checked_at=? WHERE id=?");
    for (let offset = 0; offset < targets.length; offset += CONCURRENCY) {
      const batch = targets.slice(offset, offset + CONCURRENCY);
      const results = await Promise.all(batch.map(async (ja) => ({ ja, imageUrl: supportedOfficialSet(ja.extension_code) ? await firstExistingImage(ja.extension_code, ja.number) : "" })));
      db.transaction(() => {
        for (const result of results) {
          checked += 1;
          mark.run(now, result.ja.id);
          if (!result.imageUrl) continue;
          found += 1;
          const write = insertKoreanFromJapanese(db, result.ja, result.imageUrl, now);
          added += write.inserted || 0;
          updated += write.updated || 0;
        }
      })();
    }
  }

  syncKoreanCardmarketProxyPrices();
  try { db.exec("DELETE FROM cards_fts; INSERT INTO cards_fts(rowid,name,extension,number,rarity,license_slug) SELECT rowid,name,extension,number,rarity,license_slug FROM cards;"); } catch {}
  const status = getKoreanOfficialBackfillStatus();
  const tauros = verifyKoreanTauros();
  console.log(`[pokemon-korea-official] checked=${checked} found=${found} added=${added} updated=${updated} KO=${status.ko} official=${status.official} missing-images=${status.missingImages} missing-prices=${status.missingPrices} pending-official=${status.pendingOfficial}`);
  console.log(`[catalog-audit] Tauros KO sv9a 053 ${tauros ? `present image=${tauros.image_hd ? 'yes' : 'no'} price=${Number(tauros.recommended_price || 0).toFixed(2)} source=${tauros.catalog_source || 'unknown'}` : 'MISSING'}`);
  return { ok: true, added, updated, checked, found, status, tauros };
}
