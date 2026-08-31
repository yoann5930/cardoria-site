import { getDb } from "./database.js";

const API_ROOT = "https://www.jpn-cards.com/v2/card";
const DEFAULT_BATCH = 250;
const CONCURRENCY = 5;
const RETRY_AFTER_MS = 12 * 60 * 60 * 1000;
const REQUEST_TIMEOUT = 12000;

function ensureSchema(db) {
  const columns = db.prepare("PRAGMA table_info(cards)").all().map((row) => row.name);
  if (!columns.includes("jpn_cards_checked_at")) db.exec("ALTER TABLE cards ADD COLUMN jpn_cards_checked_at TEXT DEFAULT ''");
  if (!columns.includes("image_source")) db.exec("ALTER TABLE cards ADD COLUMN image_source TEXT DEFAULT ''");
  return db;
}

function normalizeCode(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeNumber(value) {
  const raw = String(value || "").trim().split("/")[0].trim();
  const numeric = raw.match(/^0*(\d+)$/);
  return numeric ? String(Number(numeric[1])) : raw.toLowerCase();
}

function validImageUrl(value) {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) && !/default-card-image/i.test(url);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Cardoria/6.0 jpn-image-repair" },
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

async function queryApi(setCode, printedNumber) {
  const code = encodeURIComponent(String(setCode || ""));
  const number = encodeURIComponent(String(printedNumber || ""));
  const urls = [
    `${API_ROOT}/set_code=${code}&p_no=${number}`,
    `${API_ROOT}/?set_code=${code}&p_no=${number}`
  ];
  for (const url of urls) {
    const payload = await fetchJson(url);
    if (payload && Array.isArray(payload.data)) return payload.data;
  }
  return [];
}

function chooseExactMatch(card, rows) {
  const wantedCode = normalizeCode(card.extension_code);
  const wantedNumber = normalizeNumber(card.number);
  const matches = (rows || []).filter((row) => {
    const rowCode = normalizeCode(row?.setData?.set_code || row?.set_code || row?.setCode || "");
    const rowNumber = normalizeNumber(row?.printedNumber ?? row?.printed_number ?? row?.sequenceNumber ?? "");
    return rowCode === wantedCode && rowNumber === wantedNumber && validImageUrl(row?.imageUrl);
  });
  if (matches.length !== 1) return null;
  return matches[0];
}

async function resolveCard(card) {
  if (!card.extension_code || !card.number) return null;
  const rows = await queryApi(card.extension_code, card.number);
  const matched = chooseExactMatch(card, rows);
  if (!matched) return null;
  return {
    imageUrl: String(matched.imageUrl),
    cardUrl: String(matched.cardUrl || ""),
    sourceId: String(matched.id || matched.uuid || "")
  };
}

export function getJpnCardsImageRepairStatus() {
  const db = ensureSchema(getDb());
  const retryBefore = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
  const row = db.prepare(`SELECT COUNT(*) AS missing,
    SUM(CASE WHEN COALESCE(jpn_cards_checked_at,'')='' OR jpn_cards_checked_at<? THEN 1 ELSE 0 END) AS pending
    FROM cards WHERE license_slug='pokemon' AND language='ja' AND active=1
      AND (COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='')`).get(retryBefore);
  return { missing: Number(row?.missing || 0), pending: Number(row?.pending || 0) };
}

export async function repairJapaneseImagesWithJpnCards({ limit = DEFAULT_BATCH } = {}) {
  const db = ensureSchema(getDb());
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_BATCH, 1), 1000);
  const retryBefore = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
  const cards = db.prepare(`SELECT id,extension_code,number FROM cards
    WHERE license_slug='pokemon' AND language='ja' AND active=1
      AND (COALESCE(image_hd,'')='' OR COALESCE(image_thumb,'')='')
      AND (COALESCE(jpn_cards_checked_at,'')='' OR jpn_cards_checked_at<?)
    ORDER BY CASE WHEN COALESCE(jpn_cards_checked_at,'')='' THEN 0 ELSE 1 END,
      jpn_cards_checked_at ASC, extension_code, CAST(number AS INTEGER), number
    LIMIT ?`).all(retryBefore, safeLimit);

  if (!cards.length) return { ok: true, requested: 0, repaired: 0, unresolved: 0, ...getJpnCardsImageRepairStatus() };

  const results = [];
  for (let offset = 0; offset < cards.length; offset += CONCURRENCY) {
    const batch = cards.slice(offset, offset + CONCURRENCY);
    results.push(...await Promise.all(batch.map(async (card) => ({ card, match: await resolveCard(card) }))));
  }

  const now = new Date().toISOString();
  const update = db.prepare(`UPDATE cards SET image_hd=?,image_thumb=?,image_language='ja',image_source='jpn-cards',
    source_image_hd=CASE WHEN COALESCE(source_image_hd,'')='' THEN ? ELSE source_image_hd END,
    source_image_thumb=CASE WHEN COALESCE(source_image_thumb,'')='' THEN ? ELSE source_image_thumb END,
    jpn_cards_checked_at=?,updated_at=? WHERE id=?`);
  const mark = db.prepare("UPDATE cards SET jpn_cards_checked_at=? WHERE id=?");
  let repaired = 0, unresolved = 0;
  db.transaction(() => {
    for (const { card, match } of results) {
      if (match?.imageUrl) {
        update.run(match.imageUrl, match.imageUrl, match.imageUrl, match.imageUrl, now, now, card.id);
        repaired += 1;
      } else {
        mark.run(now, card.id);
        unresolved += 1;
      }
    }
  })();

  const status = getJpnCardsImageRepairStatus();
  console.log(`[jpn-cards-image-repair] requested=${cards.length} repaired=${repaired} unresolved=${unresolved} remaining=${status.missing} pending=${status.pending}`);
  return { ok: true, requested: cards.length, repaired, unresolved, ...status };
}
