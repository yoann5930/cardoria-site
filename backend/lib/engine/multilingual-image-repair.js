import { getDb } from "./database.js";

const API_ROOT = "https://api.tcgdex.net/v2";
const SUPPORTED = new Set(["en", "ja", "ko"]);
const CONCURRENCY = 10;
const DEFAULT_BATCH = 500;
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

function ensureRepairColumn(db) {
  const columns = db.prepare("PRAGMA table_info(cards)").all().map((row) => row.name);
  if (!columns.includes("image_repair_checked_at")) db.exec("ALTER TABLE cards ADD COLUMN image_repair_checked_at TEXT DEFAULT ''");
  return db;
}

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
  const db = ensureRepairColumn(getDb());
  const rows = db.prepare(`SELECT language,COUNT(*) AS count FROM cards
    WHERE license_slug='pokemon' AND language IN ('en','ja','ko') AND active=1
      AND (COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='')
    GROUP BY language`).all();
  const pendingRows = db.prepare(`SELECT language,COUNT(*) AS count FROM cards
    WHERE license_slug='pokemon' AND language IN ('en','ja','ko') AND active=1
      AND (COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='')
      AND (COALESCE(image_repair_checked_at,'')='' OR image_repair_checked_at<?)
    GROUP BY language`).all(new Date(Date.now() - RETRY_AFTER_MS).toISOString());
  const missing = { en: 0, ja: 0, ko: 0 };
  const pending = { en: 0, ja: 0, ko: 0 };
  for (const row of rows) if (SUPPORTED.has(row.language)) missing[row.language] = Number(row.count || 0);
  for (const row of pendingRows) if (SUPPORTED.has(row.language)) pending[row.language] = Number(row.count || 0);
  return {
    missing,
    pending,
    totalMissing: missing.en + missing.ja + missing.ko,
    totalPending: pending.en + pending.ja + pending.ko
  };
}

export async function repairMultilingualImages({ limit = DEFAULT_BATCH } = {}) {
  const db = ensureRepairColumn(getDb());
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_BATCH, 1), 2000);
  const retryBefore = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
  const cards = db.prepare(`SELECT id,language FROM cards
    WHERE license_slug='pokemon' AND language IN ('en','ja','ko') AND active=1
      AND (COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='')
      AND (COALESCE(image_repair_checked_at,'')='' OR image_repair_checked_at<?)
    ORDER BY CASE language WHEN 'ko' THEN 0 WHEN 'ja' THEN 1 ELSE 2 END,
      CASE WHEN COALESCE(image_repair_checked_at,'')='' THEN 0 ELSE 1 END,
      image_repair_checked_at ASC, id
    LIMIT ?`).all(retryBefore, safeLimit);
  if (!cards.length) return { ok: true, requested: 0, repaired: 0, unresolved: 0, ...getMultilingualImageRepairStatus() };

  const results = [];
  for (let offset = 0; offset < cards.length; offset += CONCURRENCY) {
    const batch = cards.slice(offset, offset + CONCURRENCY);
    results.push(...await Promise.all(batch.map(async (card) => ({ card, image: await resolveImage(card) }))));
  }

  const now = new Date().toISOString();
  const updateResolved = db.prepare(`UPDATE cards SET
    image_hd=?, image_thumb=?, image_language=?,
    source_image_hd=CASE WHEN ?=language THEN ? ELSE source_image_hd END,
    source_image_thumb=CASE WHEN ?=language THEN ? ELSE source_image_thumb END,
    translation_source=CASE WHEN translation_source='' THEN ? ELSE translation_source END,
    image_repair_checked_at=?, updated_at=? WHERE id=?`);
  const markChecked = db.prepare("UPDATE cards SET image_repair_checked_at=? WHERE id=?");
  let repaired = 0, unresolved = 0;
  db.transaction(() => {
    for (const { card, image } of results) {
      if (image) {
        updateResolved.run(
          image.imageHd, image.imageThumb, image.imageLanguage,
          image.imageLanguage, image.imageHd,
          image.imageLanguage, image.imageThumb,
          image.source, now, now, card.id
        );
        repaired += 1;
      } else {
        markChecked.run(now, card.id);
        unresolved += 1;
      }
    }
  })();

  const status = getMultilingualImageRepairStatus();
  console.log(`[multilingual-image-repair] requested=${cards.length} repaired=${repaired} unresolved=${unresolved} remaining=${status.totalMissing} pending=${status.totalPending} EN=${status.missing.en} JA=${status.missing.ja} KO=${status.missing.ko}`);
  return { ok: true, requested: cards.length, repaired, unresolved, ...status };
}
