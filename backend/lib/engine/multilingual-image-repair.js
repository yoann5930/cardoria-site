import { getDb } from "./database.js";
import { repairJapaneseImagesWithJpnCards } from "./jpn-cards-image-repair.js";

const API_ROOT = "https://api.tcgdex.net/v2";
const SUPPORTED = new Set(["fr", "en", "ja", "ko"]);
const CONCURRENCY = 10;
const DEFAULT_BATCH = 500;
const JPN_FALLBACK_BATCH = 250;
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

function ensureRepairColumn(db) {
  const columns = db.prepare("PRAGMA table_info(cards)").all().map((row) => row.name);
  if (!columns.includes("image_repair_checked_at")) db.exec("ALTER TABLE cards ADD COLUMN image_repair_checked_at TEXT DEFAULT ''");
  return db;
}

function rawCardId(card) {
  const language = String(card.language || "").toLowerCase();
  const id = String(card.id || "");
  const prefix = language === "fr" ? "pokemon-" : `pokemon-${language}-`;
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
  const language = String(card.language || "").toLowerCase();
  if (!rawId || !SUPPORTED.has(language)) return null;
  const detail = await fetchCard(language, rawId);
  if (!detail?.image) return null;
  return {
    imageHd: imageUrl(detail.image, "high"),
    imageThumb: imageUrl(detail.image, "low"),
    imageLanguage: language,
    source: "tcgdex-detail-source"
  };
}

function emptyLanguageCounts() {
  return { fr: 0, en: 0, ja: 0, ko: 0 };
}

export function getMultilingualImageRepairStatus() {
  const db = ensureRepairColumn(getDb());
  const rows = db.prepare(`SELECT language,COUNT(*) AS count FROM cards
    WHERE license_slug='pokemon' AND language IN ('fr','en','ja','ko') AND active=1
      AND (COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='')
    GROUP BY language`).all();
  const pendingRows = db.prepare(`SELECT language,COUNT(*) AS count FROM cards
    WHERE license_slug='pokemon' AND language IN ('fr','en','ja','ko') AND active=1
      AND (COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='')
      AND (COALESCE(image_repair_checked_at,'')='' OR image_repair_checked_at<?)
    GROUP BY language`).all(new Date(Date.now() - RETRY_AFTER_MS).toISOString());
  const missing = emptyLanguageCounts();
  const pending = emptyLanguageCounts();
  for (const row of rows) if (SUPPORTED.has(row.language)) missing[row.language] = Number(row.count || 0);
  for (const row of pendingRows) if (SUPPORTED.has(row.language)) pending[row.language] = Number(row.count || 0);
  return {
    missing,
    pending,
    totalMissing: missing.fr + missing.en + missing.ja + missing.ko,
    totalPending: pending.fr + pending.en + pending.ja + pending.ko
  };
}

export async function repairMultilingualImages({ limit = DEFAULT_BATCH } = {}) {
  const db = ensureRepairColumn(getDb());
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_BATCH, 1), 2000);
  const retryBefore = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
  const cards = db.prepare(`SELECT id,language FROM cards
    WHERE license_slug='pokemon' AND language IN ('fr','en','ja','ko') AND active=1
      AND (COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='')
      AND (COALESCE(image_repair_checked_at,'')='' OR image_repair_checked_at<?)
    ORDER BY CASE language WHEN 'fr' THEN 0 WHEN 'ko' THEN 1 WHEN 'ja' THEN 2 ELSE 3 END,
      CASE WHEN COALESCE(image_repair_checked_at,'')='' THEN 0 ELSE 1 END,
      image_repair_checked_at ASC, id
    LIMIT ?`).all(retryBefore, safeLimit);

  let repaired = 0, unresolved = 0;
  if (cards.length) {
    const results = [];
    for (let offset = 0; offset < cards.length; offset += CONCURRENCY) {
      const batch = cards.slice(offset, offset + CONCURRENCY);
      results.push(...await Promise.all(batch.map(async (card) => ({ card, image: await resolveImage(card) }))));
    }

    const now = new Date().toISOString();
    const updateResolved = db.prepare(`UPDATE cards SET
      image_hd=?, image_thumb=?, image_language=?,
      source_image_hd=?, source_image_thumb=?,
      translation_source=CASE WHEN COALESCE(translation_source,'')='' THEN ? ELSE translation_source END,
      image_repair_checked_at=?, updated_at=? WHERE id=?`);
    const markChecked = db.prepare("UPDATE cards SET image_repair_checked_at=? WHERE id=?");
    db.transaction(() => {
      for (const { card, image } of results) {
        if (image) {
          updateResolved.run(
            image.imageHd, image.imageThumb, image.imageLanguage,
            image.imageHd, image.imageThumb,
            image.source, now, now, card.id
          );
          repaired += 1;
        } else {
          markChecked.run(now, card.id);
          unresolved += 1;
        }
      }
    })();
  }

  let jpnFallback = { requested: 0, repaired: 0, unresolved: 0 };
  try {
    jpnFallback = await repairJapaneseImagesWithJpnCards({ limit: Math.min(JPN_FALLBACK_BATCH, safeLimit) });
    repaired += Number(jpnFallback.repaired || 0);
    unresolved += Number(jpnFallback.unresolved || 0);
  } catch (error) {
    console.warn(`[jpn-cards-image-repair] automatic fallback failed: ${error?.message || String(error)}`);
  }

  const status = getMultilingualImageRepairStatus();
  console.log(`[multilingual-image-repair] requested=${cards.length} repaired=${repaired} unresolved=${unresolved} jpn-requested=${jpnFallback.requested || 0} jpn-repaired=${jpnFallback.repaired || 0} remaining=${status.totalMissing} pending=${status.totalPending} FR=${status.missing.fr} EN=${status.missing.en} JA=${status.missing.ja} KO=${status.missing.ko}`);
  return { ok: true, requested: cards.length + Number(jpnFallback.requested || 0), repaired, unresolved, jpnFallback, ...status };
}
