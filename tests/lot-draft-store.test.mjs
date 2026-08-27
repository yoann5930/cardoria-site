import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

function loadStore(storage = new MemoryStorage()) {
  const window = {
    localStorage: storage,
    dispatchEvent() {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  };
  const source = fs.readFileSync(new URL("../js/admin/admin-lot-draft-store.js", import.meta.url), "utf8");
  vm.runInNewContext(source, { window, globalThis: window, Date, JSON, Math, Number, String, Boolean, Array, Object });
  return { Store: window.CardoriaLotDraft, storage };
}

test("lot draft persists cards, target and form across reloads", () => {
  const storage = new MemoryStorage();
  let { Store } = loadStore(storage);
  Store.begin(3, { pSeller: "Vendeur" });
  Store.addCard({ id: "pokemon-a", name: "A", extension: "Set", number: "1" });
  Store.addCard({ id: "pokemon-b", name: "B", extension: "Set", number: "2" });
  Store.setForm({ pAmount: "12.50" });

  ({ Store } = loadStore(storage));
  const draft = Store.get();
  assert.equal(draft.active, true);
  assert.equal(draft.targetQty, 3);
  assert.equal(draft.cards.length, 2);
  assert.equal(draft.cards[0].id, "pokemon-a");
  assert.equal(draft.form.pSeller, "Vendeur");
  assert.equal(draft.form.pAmount, "12.50");
});

test("duplicate cards are preserved because a lot may contain duplicates", () => {
  const { Store } = loadStore();
  Store.begin(2);
  Store.addCard({ id: "pokemon-a", name: "A" });
  Store.addCard({ id: "pokemon-a", name: "A" });
  assert.equal(Store.get().cards.length, 2);
});

test("removing one card does not clear the remaining draft", () => {
  const { Store } = loadStore();
  Store.begin(2, { pSeller: "X" });
  Store.addCard({ id: "pokemon-a" });
  Store.addCard({ id: "pokemon-b" });
  Store.removeAt(0);
  const draft = Store.get();
  assert.equal(draft.active, true);
  assert.equal(draft.cards.length, 1);
  assert.equal(draft.cards[0].id, "pokemon-b");
  assert.equal(draft.form.pSeller, "X");
});

test("clear is the only store operation that erases the lot draft", () => {
  const { Store, storage } = loadStore();
  Store.begin(1);
  Store.addCard({ id: "pokemon-a" });
  assert.ok(storage.getItem(Store.KEY));
  Store.clear();
  assert.equal(storage.getItem(Store.KEY), null);
  assert.equal(Store.get().cards.length, 0);
  assert.equal(Store.get().active, false);
});

test("legacy lot cards are migrated automatically", () => {
  const storage = new MemoryStorage();
  storage.setItem("cardoria_purchase_lot_cards", JSON.stringify([{ id: "pokemon-old", name: "Old" }]));
  const { Store } = loadStore(storage);
  const draft = Store.get();
  assert.equal(draft.cards.length, 1);
  assert.equal(draft.cards[0].id, "pokemon-old");
  assert.equal(storage.getItem("cardoria_purchase_lot_cards"), null);
  assert.ok(storage.getItem(Store.KEY));
});

test("catalogue no longer renders a lot draft window", () => {
  const source = fs.readFileSync(new URL("../js/admin/admin-catalog-purchase-link.js", import.meta.url), "utf8");
  assert.equal(source.includes("cardoriaLotDraft"), false);
  assert.equal(source.includes("Lot en préparation"), false);
  assert.equal(source.includes("Ajouter au lot"), true);
});
