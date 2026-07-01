import { registerSeller } from "./sellers.js";
import { createListing } from "./listings.js";
import { getDb } from "../engine/database.js";

const DEMO_SELLERS = [
  { email: "pro@cardoria.fr", displayName: "Cardoria Pro", sellerType: "professional", bio: "Vendeur professionnel vérifié Cardoria.", verified: 1 },
  { email: "collector@test.fr", displayName: "Thomas M.", sellerType: "individual", bio: "Collectionneur passionné Pokémon & Yu-Gi-Oh!" }
];

const DEMO_LISTINGS = [
  { sellerEmail: "pro@cardoria.fr", title: "Dracaufeu Holo Set de Base", license: "pokemon", cardId: null, condition: "EX", price: 389, negotiable: false, stock: 1, description: "Carte authentifiée Cardoria. Envoi sous sleeve + top loader.", photos: ["https://images.pokemontcg.io/base1/4_hires.png"] },
  { sellerEmail: "pro@cardoria.fr", title: "Pikachu Set de Base FR", license: "pokemon", condition: "NM", price: 11.5, negotiable: true, stock: 3, photos: ["https://images.pokemontcg.io/base1/58_hires.png"] },
  { sellerEmail: "collector@test.fr", title: "Luffy OP01 Leader", license: "onepiece", condition: "NM", price: 42, negotiable: true, stock: 2, description: "Romance Dawn — état mint.", photos: [] },
  { sellerEmail: "collector@test.fr", title: "Blue-Eyes White Dragon LOB", license: "yugioh", condition: "GD", price: 165, negotiable: false, stock: 1, photos: [] }
];

export function seedMarketplaceIfEmpty() {
  const count = getDb().prepare("SELECT COUNT(*) AS c FROM mk_listings").get()?.c ?? 0;
  if (count > 0) return { seeded: false, count };

  const sellerMap = {};
  DEMO_SELLERS.forEach((s) => {
    const seller = registerSeller(s);
    if (s.verified) getDb().prepare("UPDATE mk_sellers SET verified = 1 WHERE id = ?").run(seller.id);
    sellerMap[s.email] = seller.id;
  });

  DEMO_LISTINGS.forEach((l) => {
    try {
      createListing({ ...l, sellerId: sellerMap[l.sellerEmail] });
    } catch (e) {
      console.warn("Marketplace seed:", e.message);
    }
  });

  return { seeded: true, count: getDb().prepare("SELECT COUNT(*) AS c FROM mk_listings").get()?.c ?? 0 };
}
