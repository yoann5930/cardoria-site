/**
 * Données initiales du moteur Cardoria — une sélection par licence.
 */
import { ensureDefaultLicenses } from "./licenses.js";
import { createCard, searchCards } from "./cards.js";
import { getDb } from "./database.js";

const SEED_CARDS = [
  { license: "pokemon", name: "Dracaufeu Holo", extension: "Set de Base", extensionCode: "BS", number: "004/102", rarity: "Holo Rare", illustration: "Mitsuhiro Arita", avgPrice: 420, imageHd: "https://images.pokemontcg.io/base1/4_hires.png", salesHistory: [{ date: "2026-06-15", price: 395, condition: "EX" }, { date: "2026-05-20", price: 410, condition: "NM" }] },
  { license: "pokemon", name: "Pikachu", extension: "Set de Base", number: "058/102", rarity: "Commune", illustration: "Atsuko Nishida", avgPrice: 12.5, imageHd: "https://images.pokemontcg.io/base1/58_hires.png" },
  { license: "yugioh", name: "Dragon Blanc aux Yeux Bleus", extension: "Légende du Dragon Blanc", number: "LOB-001", rarity: "Ultra Rare", illustration: "Kazuki Takahashi", avgPrice: 185, imageHd: "" },
  { license: "onepiece", name: "Monkey D. Luffy", extension: "Romance Dawn", number: "OP01-001", rarity: "Leader", illustration: "Eiichiro Oda", avgPrice: 45, imageHd: "" },
  { license: "lorcana", name: "Elsa", extension: "The First Chapter", number: "041/204", rarity: "Legendary", illustration: "Disney", avgPrice: 28, imageHd: "" },
  { license: "magic", name: "Black Lotus", extension: "Alpha", number: "232", rarity: "Rare", illustration: "Christopher Rush", avgPrice: 85000, imageHd: "" },
  { license: "dragonball", name: "Son Goku", extension: "Galactic Battle", number: "BT1-001", rarity: "Leader", illustration: "Akira Toriyama", avgPrice: 22, imageHd: "" },
  { license: "sports", name: "Kylian Mbappé", extension: "Panini Prizm 2024", number: "001", rarity: "Base", illustration: "Panini", avgPrice: 35, imageHd: "" },
  { license: "pokemon", name: "Mewtwo GX", extension: "Shining Legends", number: "078/073", rarity: "Secret Rare", illustration: "5ban Graphics", avgPrice: 95, imageHd: "" },
  { license: "yugioh", name: "Exodia l'Interdit", extension: "Légende du Dragon Blanc", number: "LOB-124", rarity: "Ultra Rare", illustration: "Kazuki Takahashi", avgPrice: 55, imageHd: "" }
];

export function seedEngineIfEmpty() {
  ensureDefaultLicenses();
  const count = getDb().prepare("SELECT COUNT(*) AS c FROM cards").get()?.c ?? 0;
  if (count > 0) return { seeded: false, count };

  SEED_CARDS.forEach((c) => {
    try { createCard(c); } catch (e) { console.warn("Seed skip:", c.name, e.message); }
  });

  return { seeded: true, count: searchCards({ limit: 1 }).pagination.total || SEED_CARDS.length };
}
