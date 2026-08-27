import { getDb, normalizeText, slugify } from "./database.js";
import { ensureDefaultLicenses } from "./licenses.js";

const API = "https://api.tcgdex.net/v2/fr";
const SOURCE = "tcgdex-fr";

function imageUrl(base, quality) {
  if (!base) return "";
  return `${String(base).replace(/\/$/, "")}/${quality}.webp`;
}

function setIdFromCardId(cardId) {
  const id = String(cardId || "");
  const pos = id.lastIndexOf("-");
  return pos > 0 ? id.slice(0, pos) : "";
}

async function fetchJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(API + path, {
      headers: { Accept: "application/json", "User-Agent": "Cardoria/6.0" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`TCGdex ${response.status} ${path}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function syncPokemonCatalog({ force = false } = {}) {
  ensureDefaultLicenses();
  const db = getDb();
  const existing = db.prepare("SELECT COUNT(*) AS c FROM cards WHERE license_slug = 'pokemon' AND active = 1").get()?.c ?? 0;
  if (!force && existing >= 1000) return { ok: true, skipped: true, reason: "already_populated", count: existing, source: SOURCE };

  const [cards, sets] = await Promise.all([fetchJson("/cards"), fetchJson("/sets")]);
  if (!Array.isArray(cards) || cards.length < 1000) throw new Error("TCGdex: catalogue cartes incomplet");
  if (!Array.isArray(sets) || !sets.length) throw new Error("TCGdex: liste des extensions indisponible");

  const setMap = new Map(sets.map((set) => [String(set.id || ""), set]));
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO cards (
      id, license_slug, slug, name, name_normalized, extension, extension_code, number,
      rarity, illustration, image_hd, image_thumb, condition_note,
      avg_price, low_price, high_price, recommended_price, market_trend, trend_percent,
      sales_count, views, meta_title, meta_description, active, created_at, updated_at
    ) VALUES (
      @id, 'pokemon', @slug, @name, @name_normalized, @extension, @extension_code, @number,
      '', '', @image_hd, @image_thumb, 'NM',
      0, 0, 0, 0, 'stable', 0,
      0, 0, @meta_title, @meta_description, 1, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      name_normalized = excluded.name_normalized,
      extension = excluded.extension,
      extension_code = excluded.extension_code,
      number = excluded.number,
      image_hd = excluded.image_hd,
      image_thumb = excluded.image_thumb,
      meta_title = excluded.meta_title,
      meta_description = excluded.meta_description,
      active = 1,
      updated_at = excluded.updated_at
  `);

  let imported = 0;
  let withoutImage = 0;
  const tx = db.transaction(() => {
    for (const raw of cards) {
      if (!raw?.id || !raw?.name) continue;
      const setId = setIdFromCardId(raw.id);
      const set = setMap.get(setId);
      const extension = String(set?.name || setId || "");
      const localId = String(raw.localId ?? "");
      const slug = slugify(`${raw.name}-${extension}-${localId}-${raw.id}`);
      const baseImage = String(raw.image || "");
      if (!baseImage) withoutImage += 1;
      upsert.run({
        id: `pokemon-${raw.id}`,
        slug,
        name: String(raw.name),
        name_normalized: normalizeText(raw.name),
        extension,
        extension_code: setId,
        number: localId,
        image_hd: imageUrl(baseImage, "high"),
        image_thumb: imageUrl(baseImage, "low"),
        meta_title: `${raw.name} — ${extension} | Cardoria`,
        meta_description: `Fiche de la carte Pokémon ${raw.name}${extension ? `, extension ${extension}` : ""}${localId ? `, numéro ${localId}` : ""}.`,
        created_at: now,
        updated_at: now
      });
      imported += 1;
    }

    try {
      db.exec("DELETE FROM cards_fts; INSERT INTO cards_fts(rowid,name,extension,number,rarity,license_slug) SELECT rowid,name,extension,number,rarity,license_slug FROM cards;");
    } catch {}
  });
  tx();

  const count = db.prepare("SELECT COUNT(*) AS c FROM cards WHERE license_slug = 'pokemon' AND active = 1").get()?.c ?? 0;
  return { ok: true, skipped: false, source: SOURCE, imported, count, sets: setMap.size, withoutImage, syncedAt: now };
}
