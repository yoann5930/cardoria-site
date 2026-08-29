(function (root) {
  "use strict";

  var KEY = "cardoria_purchase_lot_draft_v2";
  var LEGACY_KEY = "cardoria_purchase_lot_cards";

  function now() { return new Date().toISOString(); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function emptyDraft() {
    return { version: 2, active: false, targetQty: 0, cards: [], form: {}, updatedAt: null };
  }
  function safeStorage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }
  function normalizeCard(card) {
    card = card || {};
    var id = String(card.id || "").trim();
    if (!id) return null;
    return {
      id: id,
      name: String(card.name || "Carte Pokémon"),
      extension: String(card.extension || ""),
      number: String(card.number || ""),
      imageThumb: String(card.imageThumb || "")
    };
  }
  function normalizeDraft(raw) {
    var draft = emptyDraft();
    if (!raw || typeof raw !== "object") return draft;
    draft.active = Boolean(raw.active);
    draft.targetQty = Math.max(0, Math.trunc(Number(raw.targetQty) || 0));
    draft.cards = Array.isArray(raw.cards) ? raw.cards.map(normalizeCard).filter(Boolean) : [];
    draft.form = raw.form && typeof raw.form === "object" && !Array.isArray(raw.form) ? raw.form : {};
    draft.updatedAt = raw.updatedAt || null;
    if (draft.cards.length && raw.active !== false) draft.active = true;
    return draft;
  }
  function emit() {
    try {
      if (typeof root.dispatchEvent === "function" && typeof root.CustomEvent === "function") {
        root.dispatchEvent(new root.CustomEvent("cardoria:lot-draft-change", { detail: get() }));
      }
    } catch (e) {}
  }
  function persist(draft) {
    var storage = safeStorage();
    draft = normalizeDraft(draft);
    draft.updatedAt = now();
    if (storage) {
      storage.setItem(KEY, JSON.stringify(draft));
      storage.removeItem(LEGACY_KEY);
    }
    emit();
    return clone(draft);
  }
  function migrateLegacy(storage) {
    if (!storage) return null;
    try {
      var legacy = JSON.parse(storage.getItem(LEGACY_KEY) || "[]");
      if (!Array.isArray(legacy) || !legacy.length) return null;
      var draft = emptyDraft();
      draft.active = true;
      draft.cards = legacy.map(normalizeCard).filter(Boolean);
      draft.updatedAt = now();
      storage.setItem(KEY, JSON.stringify(draft));
      storage.removeItem(LEGACY_KEY);
      return draft;
    } catch (e) { return null; }
  }
  function get() {
    var storage = safeStorage();
    if (!storage) return emptyDraft();
    try {
      var raw = storage.getItem(KEY);
      if (!raw) {
        var migrated = migrateLegacy(storage);
        return clone(migrated || emptyDraft());
      }
      return clone(normalizeDraft(JSON.parse(raw)));
    } catch (e) { return emptyDraft(); }
  }
  function begin(targetQty, form) {
    var draft = get();
    draft.active = true;
    if (Number(targetQty) > 0) draft.targetQty = Math.max(1, Math.trunc(Number(targetQty)));
    if (form && typeof form === "object") draft.form = Object.assign({}, draft.form, form);
    return persist(draft);
  }
  function setTarget(targetQty) {
    var draft = get();
    draft.active = true;
    draft.targetQty = Math.max(1, Math.trunc(Number(targetQty) || 1));
    return persist(draft);
  }
  function setForm(form) {
    var draft = get();
    if (!draft.active) draft.active = true;
    draft.form = Object.assign({}, draft.form, form && typeof form === "object" ? form : {});
    return persist(draft);
  }
  function addCard(card) {
    var normalized = normalizeCard(card);
    if (!normalized) return get();
    var draft = get();
    draft.active = true;
    draft.cards.push(normalized);
    return persist(draft);
  }
  function removeAt(index) {
    var draft = get();
    var i = Math.trunc(Number(index));
    if (i >= 0 && i < draft.cards.length) draft.cards.splice(i, 1);
    return persist(draft);
  }
  function replaceCards(cards) {
    var draft = get();
    draft.active = true;
    draft.cards = Array.isArray(cards) ? cards.map(normalizeCard).filter(Boolean) : [];
    return persist(draft);
  }
  function clear() {
    var storage = safeStorage();
    if (storage) {
      storage.removeItem(KEY);
      storage.removeItem(LEGACY_KEY);
    }
    emit();
    return emptyDraft();
  }

  root.CardoriaLotDraft = {
    KEY: KEY,
    get: get,
    begin: begin,
    setTarget: setTarget,
    setForm: setForm,
    addCard: addCard,
    removeAt: removeAt,
    replaceCards: replaceCards,
    clear: clear
  };
})(typeof window !== "undefined" ? window : globalThis);
