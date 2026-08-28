import { getDb } from "./database.js";

const API_ROOT = "https://api.tcgdex.net/v2";
const SUPPORTED = new Set(["en", "ja", "ko"]);
const CONCURRENCY = 10;
const DEFAULT_BATCH = 500;

function rawCardId(card) {
  const language = String(card.language || "");
  const prefix = `pokemon-${language}-`;
  const id = String(card.id || "");
  return id.startsWith(prefix) ? id.slice(prefix.length) : "";
}

function imageUrl(base, quality) {
  if (!base) return "";
  return `${String(base).replace(/\/$/, "")}/${quality}.webp`;
}

async function fetchCard(language, rawId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_ROOT}/${language}/cards/${encodeURIComponent(rawId)}`, {
      headers: { Accept: "application/json", "User-Agent": "Cardoria/6.0 image-repair" },
      signal: controller.signal
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveImage(card) {
  const rawId = rawCardId(card);
  if (!rawId) return null;
  const languages = [card.language];
  if (card.language !== "fr") languages.push("fr");
  if (card.language !== "en") languages.push("en");
  for (const language of languages) {
    const detail = await fetchCard(language, rawId);
    if (!detail?.image) continue;
    return {
      imageHd: imageUrl(detail.image, "high"),
      imageThumb: imageUrl(detail.image, "low"),
      imageLanguage: language,
      source: language === card.language ? "tcgdex-detail-source" : `tcgdex-detail-${language}`
    };
  }
  return null;
}

export function getMultilingualImageRepairStatus() {
  const db = getDb();
  const rows = db.prepare(`SELECT language,COUNT(*) AS count FROM cards
    WHERE license_slug='pokemon' AND language IN ('en','ja','ko') AND active=1
      AND (COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='')
    GROUP BY language`).all();
  const missing = { en: 0, ja: 0, ko: 0 };
  for (const row of rows) if (SUPPORTED.has(row.language)) missing[row.language] = Number(row.count || 0);
  return { missing, totalMissing: missing.en + missing.ja + missing.ko };
}

export async function repairMultilingualImages({ limit = DEFAULT_BATCH } = {}) {
  const db = getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_BATCH, 1), 2000);
  const cards = db.prepare(`SELECT id,language FROM cards
    WHERE license_slug='pokemon' AND language IN ('en','ja','ko') AND active=1
      AND (COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='')
    ORDER BY CASE language WHEN 'ko' THEN 0 WHEN 'ja' THEN 1 ELSE 2 END, id
    LIMIT ?`).all(safeLimit);
  if (!cards.length) return { ok: true, requested: 0, repaired: 0, unresolved: 0, ...getMultilingualImageRepairStatus() };

  const resolved = [];
  let unresolved = 0;
  for (let offset = 0; offset < cards.length; offset += CONCURRENCY) {
    const batch = cards.slice(offset, offset + CONCURRENCY);
    const results = await Promise.all(batch.map(async (card) => ({ card, image: await resolveImage(card) })));
    for (const result of results) {
      if (result.image) resolved.push(result);
      else unresolved += 1;
    }
  }

  const update = db.prepare(`UPDATE cards SET
    image_hd=?, image_thumb=?, image_language=?,
    source_image_hd=CASE WHEN ?=language THEN ? ELSE source_image_hd END,
    source_image_thumb=CASE WHEN ?=language THEN ? ELSE source_image_thumb END,
    translation_source=CASE WHEN translation_source='' THEN ? ELSE translation_source END,
    updated_at=? WHERE id=?`);
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const { card, image } of resolved) {
      update.run(
        image.imageHd, image.imageThumb, image.imageLanguage,
        image.imageLanguage, image.imageHd,
        image.imageLanguage, image.imageThumb,
        image.source, now, card.id
      );
    }
  })();

  const status = getMultilingualImageRepairStatus();
  console.log(`[multilingual-image-repair] requested=${cards.length} repaired=${resolved.length} unresolved=${unresolved} remaining=${status.totalMissing} EN=${status.missing.en} JA=${status.missing.ja} KO=${status.missing.ko}`);
  return { ok: true, requested: cards.length, repaired: resolved.length, unresolved, ...status };
}
