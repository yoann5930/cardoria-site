(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A || !A.protectAdmin()) return;

  var STOCK_PREFS_TAG = "[STOCK_PREFS]";
  var CONDITION_OPTIONS = [
    { value: "", label: "Non renseigné" },
    { value: "M", label: "M — Mint" },
    { value: "NM", label: "NM — Near Mint" },
    { value: "EX", label: "EX — Excellent" },
    { value: "GD", label: "GD — Good" },
    { value: "LP", label: "LP — Light Played" },
    { value: "PL", label: "PL — Played" },
    { value: "PO", label: "PO — Poor" }
  ];
  var CONDITION_MULTIPLIERS = { M: 1.15, NM: 1, EX: 0.85, GD: 0.65, LP: 0.75, PL: 0.55, PO: 0.2 };
  var purchasesById = Object.create(null);
  var productsByKey = Object.create(null);
  var currentProducts = [];

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function euro(n) { return Number(n || 0).toFixed(2).replace(".", ",") + " €"; }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function positive(n) { n = Number(n || 0); return Number.isFinite(n) && n > 0 ? n : 0; }

  function normalizeCondition(value) {
    var raw = String(value || "").trim();
    if (!raw || /non renseign/i.test(raw)) return "";
    var upper = raw.toUpperCase();
    if (["M", "NM", "EX", "GD", "LP", "PL", "PO"].indexOf(upper) >= 0) return upper;
    var lower = raw.toLowerCase();
    if (lower === "mint") return "M";
    if (lower === "near mint") return "NM";
    if (lower === "excellent") return "EX";
    if (lower === "good" || lower === "bon") return "GD";
    if (lower === "light played" || lower === "lightly played") return "LP";
    if (lower === "played" || lower === "joué" || lower === "joue" || lower === "mp") return "PL";
    if (lower === "poor" || lower === "mauvais" || lower === "dmg") return "PO";
    return "";
  }

  function parseStockPrefs(notes) {
    var match = String(notes || "").match(/\[STOCK_PREFS\]\s*(\{[^\n\r]*\})/);
    if (!match) return {};
    try {
      var parsed = JSON.parse(match[1]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { return {}; }
  }

  function normalizedSoldOverride(value) {
    if (value === null || value === undefined || value === "") return null;
    var number = Math.trunc(Number(value));
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function readLinePreference(purchase, key) {
    var pref = parseStockPrefs(purchase && purchase.notes)[key];
    if (!pref || typeof pref !== "object") return null;
    return {
      condition: normalizeCondition(pref.condition),
      marketEnabled: pref.market === true,
      soldOverride: normalizedSoldOverride(pref.sold)
    };
  }

  function writeLinePreference(notes, key, preference) {
    var current = String(notes || "");
    var prefs = parseStockPrefs(current);
    var previous = prefs[key] && typeof prefs[key] === "object" ? prefs[key] : {};
    var next = {
      condition: normalizeCondition(preference.condition !== undefined ? preference.condition : previous.condition),
      market: preference.marketEnabled !== undefined ? preference.marketEnabled === true : previous.market === true
    };
    var sold = preference.soldOverride !== undefined ? normalizedSoldOverride(preference.soldOverride) : normalizedSoldOverride(previous.sold);
    if (sold !== null) next.sold = sold;
    prefs[key] = next;
    var base = current.replace(/\n?\[STOCK_PREFS\]\s*\{[^\n\r]*\}/g, "").replace(/\s+$/, "");
    var line = STOCK_PREFS_TAG + " " + JSON.stringify(prefs);
    return base ? base + "\n" + line : line;
  }

  function referenceId(reference, prefix) {
    var value = String(reference || "").trim();
    return value.indexOf(prefix) === 0 ? value.slice(prefix.length) : "";
  }
  function catalogCardId(reference) { return referenceId(reference, "catalog-card:"); }
  function catalogSealedId(reference) { return referenceId(reference, "sealed-product:"); }

  function lotCardIds(purchase) {
    if (Array.isArray(purchase.lotCards) && purchase.lotCards.length) return purchase.lotCards.filter(Boolean);
    var match = String(purchase.notes || "").match(/\[LOT_CARDS\]\s*(\[[^\n\r]*\])/);
    if (!match) return [];
    try { var ids = JSON.parse(match[1]); return Array.isArray(ids) ? ids.filter(Boolean) : []; }
    catch (_) { return []; }
  }

  function isStockPurchase(p) {
    if (String(p.status || "paid") !== "paid") return false;
    if (p.purchaseType === "pokemon_card") return true;
    return String(p.license || "").toLowerCase() === "pokemon" && ["cartes", "lots", "boosters"].indexOf(String(p.category || "").toLowerCase()) >= 0;
  }

  async function resolveCard(id) {
    if (!id) return null;
    var response = await A.adminFetch("/api/admin/engine/cards/" + encodeURIComponent(id));
    return response && response.ok ? response.card : null;
  }
  async function resolveSealed(id) {
    if (!id) return null;
    var response = await A.adminFetch("/api/admin/engine/sealed/" + encodeURIComponent(id));
    return response && response.ok ? response.reference : null;
  }

  function isExternalSource(source) {
    var name = String(source || "").trim().toLowerCase();
    return !!name && name !== "cardoria" && name !== "manual" && name.indexOf("cardoria-") !== 0;
  }

  function externalSources(card) {
    return ((card && card.priceSources) || []).filter(function (source) {
      return isExternalSource(source.source) && positive(source.price);
    });
  }

  function median(values) {
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    if (!sorted.length) return 0;
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function cardMarketPrice(card) {
    if (!card) return 0;
    var sources = externalSources(card);
    if (sources.length) return round2(median(sources.map(function (source) { return Number(source.price); })));
    if (card.market && isExternalSource(card.market.source)) {
      return positive(card.market.avg7) || positive(card.market.avg30) || positive(card.market.avg1) || 0;
    }
    return 0;
  }

  function cardMarketSourceLabel(card) {
    if (!card) return "Référence carte non reliée";
    var names = [];
    externalSources(card).forEach(function (source) {
      if (source.source && names.indexOf(source.source) < 0) names.push(source.source);
    });
    if (names.length) return names.slice(0, 3).join(" + ") + (names.length > 3 ? " +…" : "");
    if (card.market && isExternalSource(card.market.source) && card.market.source) return card.market.source;
    return "Aucune source marché externe fiable";
  }

  function sealedMarketPrice(reference) {
    if (!reference) return 0;
    var source = reference.priceSource || reference.source || "";
    return isExternalSource(source) ? positive(reference.marketPrice) : 0;
  }

  function sealedMarketSourceLabel(reference) {
    if (!reference) return "Référence scellée non reliée";
    var source = reference.priceSource || reference.source || "";
    return isExternalSource(source) && source ? source : "Aucune source marché externe fiable";
  }

  function add(map, item) {
    var key = item.key;
    var qty = Math.max(1, Math.trunc(Number(item.quantity) || 1));
    var unitCost = Math.max(0, Number(item.price) || 0);
    var preference = item.preference || null;
    if (!map[key]) {
      map[key] = {
        key: key,
        id: item.id,
        cardId: item.cardId || "",
        card: item.card || null,
        sealedId: item.sealedId || "",
        sealedRef: item.sealedRef || null,
        name: item.name || "Achat Pokémon",
        extension: item.extension || "",
        number: item.number || "",
        category: item.category || "Carte Pokémon",
        condition: preference ? preference.condition : normalizeCondition(item.condition),
        marketEnabled: preference ? preference.marketEnabled : false,
        soldOverride: preference ? preference.soldOverride : null,
        preferenceApplied: !!preference,
        packaging: item.packaging || "carte_unite",
        purchasePrice: round2(unitCost),
        quantityPurchased: qty,
        linked: !!item.linked,
        latestPurchaseAt: item.latestPurchaseAt || "",
        totalCost: unitCost * qty,
        purchaseIds: item.purchaseId ? [item.purchaseId] : [],
        marketPrice: 0,
        salePrice: 0,
        salePriceSource: "",
        salePriceNote: "",
        sold: 0,
        soldAutomatic: 0,
        remainingQuantity: qty
      };
      return;
    }
    var current = map[key];
    current.quantityPurchased += qty;
    current.totalCost += unitCost * qty;
    current.purchasePrice = current.quantityPurchased ? round2(current.totalCost / current.quantityPurchased) : 0;
    current.linked = current.linked || !!item.linked;
    if (!current.card && item.card) current.card = item.card;
    if (!current.sealedRef && item.sealedRef) current.sealedRef = item.sealedRef;
    if (!current.sealedId && item.sealedId) current.sealedId = item.sealedId;
    if (item.purchaseId && current.purchaseIds.indexOf(item.purchaseId) < 0) current.purchaseIds.push(item.purchaseId);
    if (!current.preferenceApplied && preference) {
      current.condition = preference.condition;
      current.marketEnabled = preference.marketEnabled;
      current.soldOverride = preference.soldOverride;
      current.preferenceApplied = true;
    }
    if (String(item.latestPurchaseAt || "") > String(current.latestPurchaseAt || "")) current.latestPurchaseAt = item.latestPurchaseAt;
  }

  function enrichProduct(product) {
    if (product.sealedRef) {
      product.marketPrice = sealedMarketPrice(product.sealedRef);
      product.salePriceSource = sealedMarketSourceLabel(product.sealedRef);
    } else {
      product.marketPrice = cardMarketPrice(product.card);
      product.salePriceSource = cardMarketSourceLabel(product.card);
    }

    product.soldAutomatic = Math.max(0, Math.trunc(Number(product.card && product.card.salesStats && product.card.salesStats.inventoryUnits || 0)));
    product.sold = product.soldOverride !== null && product.soldOverride !== undefined ? Math.max(0, Math.trunc(Number(product.soldOverride) || 0)) : product.soldAutomatic;
    product.remainingQuantity = Math.max(0, Number(product.quantityPurchased || 0) - product.sold);

    var condition = normalizeCondition(product.condition);
    if (!product.marketPrice) {
      product.salePrice = 0;
      product.salePriceNote = "À vérifier — aucune source marché externe fiable";
      return product;
    }
    if (product.sealedRef) {
      product.salePrice = product.marketPrice;
      product.salePriceNote = "Prix marché scellé — aucun ajustement d'état appliqué";
      return product;
    }
    if (!condition) {
      product.salePrice = product.marketPrice;
      product.salePriceNote = "Prix marché non ajusté — renseigner l'état";
      return product;
    }
    product.salePrice = round2(product.marketPrice * (CONDITION_MULTIPLIERS[condition] || 1));
    product.salePriceNote = "Marché ajusté selon l'état " + condition;
    return product;
  }

  async function buildStock(purchases) {
    var map = Object.create(null);
    var paid = (purchases || []).filter(isStockPurchase);
    var cardIds = [];
    var sealedIds = [];
    purchasesById = Object.create(null);
    (purchases || []).forEach(function (purchase) { if (purchase && purchase.id) purchasesById[purchase.id] = purchase; });

    paid.forEach(function (purchase) {
      if (String(purchase.packaging || "carte_unite") === "lot_cartes") {
        lotCardIds(purchase).forEach(function (id) { if (id && cardIds.indexOf(id) < 0) cardIds.push(id); });
        return;
      }
      var cardId = catalogCardId(purchase.reference);
      var sealedId = catalogSealedId(purchase.reference);
      if (cardId && cardIds.indexOf(cardId) < 0) cardIds.push(cardId);
      if (sealedId && sealedIds.indexOf(sealedId) < 0) sealedIds.push(sealedId);
    });

    var resolved = await Promise.all([
      Promise.all(cardIds.map(async function (id) { return [id, await resolveCard(id)]; })),
      Promise.all(sealedIds.map(async function (id) { return [id, await resolveSealed(id)]; }))
    ]);
    var cards = Object.create(null), sealed = Object.create(null);
    resolved[0].forEach(function (pair) { cards[pair[0]] = pair[1]; });
    resolved[1].forEach(function (pair) { sealed[pair[0]] = pair[1]; });

    paid.forEach(function (purchase) {
      var qty = Math.max(1, Math.trunc(Number(purchase.quantity) || 1));
      var amount = Math.max(0, Number(purchase.amount) || 0);
      var unitCost = qty ? amount / qty : amount;
      var packaging = String(purchase.packaging || "carte_unite");
      var purchaseDate = purchase.date || purchase.createdAt || "";

      if (packaging === "lot_cartes") {
        var ids = lotCardIds(purchase);
        if (ids.length) {
          for (var i = 0; i < qty; i += 1) {
            var lotId = ids[i] || "";
            var card = cards[lotId] || null;
            var key = lotId ? "card:" + lotId : "purchase:" + purchase.id + ":" + i;
            add(map, {
              key: key, id: lotId || purchase.id + ":" + (i + 1), cardId: lotId, card: card,
              name: card && card.name ? card.name : (purchase.description || "Carte Pokémon du lot"),
              extension: card && card.extension || "", number: card && card.number || "",
              category: card && (card.hitFamily || card.rarity) || "Carte Pokémon",
              condition: purchase.condition || purchase.cardCondition || "", preference: readLinePreference(purchase, key),
              packaging: packaging, price: unitCost, quantity: 1, linked: !!card, latestPurchaseAt: purchaseDate, purchaseId: purchase.id
            });
          }
        } else {
          var fallbackKey = "purchase:" + purchase.id + ":lot";
          add(map, { key: fallbackKey, id: purchase.id, name: purchase.description || "Lot de cartes Pokémon", category: "Lot de cartes",
            condition: purchase.condition || purchase.cardCondition || "", preference: readLinePreference(purchase, fallbackKey), packaging: packaging,
            price: unitCost, quantity: qty, linked: false, latestPurchaseAt: purchaseDate, purchaseId: purchase.id });
        }
        return;
      }

      if (packaging === "carte_unite" || !purchase.packaging) {
        var cardId = catalogCardId(purchase.reference);
        var singleCard = cards[cardId] || null;
        var cardKey = cardId ? "card:" + cardId : "purchase:" + purchase.id;
        add(map, {
          key: cardKey, id: cardId || purchase.id, cardId: cardId, card: singleCard,
          name: singleCard && singleCard.name ? singleCard.name : (purchase.description || "Carte Pokémon"),
          extension: singleCard && singleCard.extension || "", number: singleCard && singleCard.number || "",
          category: singleCard && (singleCard.hitFamily || singleCard.rarity) || "Carte Pokémon",
          condition: purchase.condition || purchase.cardCondition || "", preference: readLinePreference(purchase, cardKey),
          packaging: packaging, price: unitCost, quantity: qty, linked: !!singleCard, latestPurchaseAt: purchaseDate, purchaseId: purchase.id
        });
        return;
      }

      var sealedId = catalogSealedId(purchase.reference);
      var sealedRef = sealed[sealedId] || null;
      var sealedKey = sealedId ? "sealed:" + sealedId : "purchase:" + purchase.id + ":sealed";
      add(map, {
        key: sealedKey,
        id: sealedId || purchase.id,
        sealedId: sealedId,
        sealedRef: sealedRef,
        name: sealedRef && sealedRef.name ? sealedRef.name : (purchase.description || "Produit Pokémon scellé"),
        extension: sealedRef && sealedRef.extension || "",
        category: "Produit scellé",
        condition: "",
        preference: readLinePreference(purchase, sealedKey),
        packaging: packaging,
        price: unitCost,
        quantity: qty,
        linked: !!sealedRef,
        latestPurchaseAt: purchaseDate,
        purchaseId: purchase.id
      });
    });

    return Object.keys(map).map(function (key) { return enrichProduct(map[key]); }).sort(function (a, b) {
      return String(b.latestPurchaseAt || "").localeCompare(String(a.latestPurchaseAt || "")) || String(a.name || "").localeCompare(String(b.name || ""), "fr");
    });
  }

  function conditionSelect(product) {
    var isCard = product.packaging === "carte_unite" || product.packaging === "lot_cartes";
    if (!isCard) return '<select disabled><option>Scellé</option></select>';
    return '<select data-stock-condition="' + esc(product.key) + '">' + CONDITION_OPTIONS.map(function (option) {
      return '<option value="' + esc(option.value) + '"' + (option.value === normalizeCondition(product.condition) ? ' selected' : '') + '>' + esc(option.label) + '</option>';
    }).join("") + '</select>';
  }

  function marketSelect(product) {
    return '<select data-stock-market="' + esc(product.key) + '">' +
      '<option value="no"' + (!product.marketEnabled ? ' selected' : '') + '>Non</option>' +
      '<option value="yes"' + (product.marketEnabled ? ' selected' : '') + '>Oui</option>' +
      '</select><br><small data-stock-save="' + esc(product.key) + '" style="color:#baaf97">Enregistré</small>';
  }

  function soldControl(product) {
    var source = product.soldOverride !== null && product.soldOverride !== undefined ? "ajustement manuel" : (product.cardId && product.card ? "ventes Cardoria automatiques" : "à renseigner si vendu");
    return '<input data-stock-sold="' + esc(product.key) + '" type="number" min="0" step="1" value="' + esc(product.sold) + '" style="width:82px">' +
      '<br><small>' + esc(source) + '</small>';
  }

  function setRowBusy(key, busy) {
    ["stock-condition", "stock-market", "stock-sold"].forEach(function (name) {
      var node = document.querySelector('[data-' + name + '="' + CSS.escape(key) + '"]');
      if (node) node.disabled = !!busy;
    });
  }

  function setSaveStatus(key, text, error) {
    var node = document.querySelector('[data-stock-save="' + CSS.escape(key) + '"]');
    if (!node) return;
    node.textContent = text;
    node.style.color = error ? "#ff7373" : "#baaf97";
  }

  async function saveRowPreference(product, preference) {
    var ids = (product.purchaseIds || []).slice();
    if (!ids.length) throw new Error("Aucun achat lié à cette ligne de stock.");
    setRowBusy(product.key, true);
    setSaveStatus(product.key, "Enregistrement…", false);
    try {
      for (var i = 0; i < ids.length; i += 1) {
        var id = ids[i];
        var purchase = purchasesById[id];
        if (!purchase) continue;
        var body = Object.assign({}, purchase, { notes: writeLinePreference(purchase.notes, product.key, preference) });
        var response = await A.adminFetch("/api/admin/accounting/purchases/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(body) });
        if (!response || !response.ok) throw new Error(response && response.error || "Enregistrement impossible.");
        purchasesById[id] = response.purchase || body;
      }
      if (preference.condition !== undefined) product.condition = normalizeCondition(preference.condition);
      if (preference.marketEnabled !== undefined) product.marketEnabled = preference.marketEnabled === true;
      if (preference.soldOverride !== undefined) product.soldOverride = normalizedSoldOverride(preference.soldOverride);
      product.preferenceApplied = true;
      enrichProduct(product);
      renderStock(currentProducts, true);
      setSaveStatus(product.key, "Enregistré ✓", false);
    } finally {
      setRowBusy(product.key, false);
    }
  }

  function bindStockControls() {
    document.querySelectorAll("[data-stock-condition]").forEach(function (select) {
      select.addEventListener("change", function () {
        var key = select.getAttribute("data-stock-condition");
        var product = productsByKey[key];
        if (!product) return;
        var previous = product.condition;
        saveRowPreference(product, { condition: select.value, marketEnabled: product.marketEnabled, soldOverride: product.soldOverride }).catch(function (error) {
          product.condition = previous;
          enrichProduct(product);
          renderStock(currentProducts, true);
          alert(error.message || "Enregistrement impossible.");
        });
      });
    });
    document.querySelectorAll("[data-stock-market]").forEach(function (select) {
      select.addEventListener("change", function () {
        var key = select.getAttribute("data-stock-market");
        var product = productsByKey[key];
        if (!product) return;
        var previous = product.marketEnabled;
        saveRowPreference(product, { condition: product.condition, marketEnabled: select.value === "yes", soldOverride: product.soldOverride }).catch(function (error) {
          product.marketEnabled = previous;
          renderStock(currentProducts, true);
          alert(error.message || "Enregistrement impossible.");
        });
      });
    });
    document.querySelectorAll("[data-stock-sold]").forEach(function (input) {
      input.addEventListener("change", function () {
        var key = input.getAttribute("data-stock-sold");
        var product = productsByKey[key];
        if (!product) return;
        var previous = product.soldOverride;
        var requested = Math.max(0, Math.trunc(Number(input.value) || 0));
        saveRowPreference(product, { condition: product.condition, marketEnabled: product.marketEnabled, soldOverride: requested }).catch(function (error) {
          product.soldOverride = previous;
          enrichProduct(product);
          renderStock(currentProducts, true);
          alert(error.message || "Enregistrement impossible.");
        });
      });
    });
  }

  function renderStock(products, preserveMap) {
    currentProducts = products;
    if (!preserveMap) {
      productsByKey = Object.create(null);
      products.forEach(function (product) { productsByKey[product.key] = product; });
    }

    var active = products.filter(function (product) { return Number(product.remainingQuantity || 0) > 0; });
    var refs = active.length;
    var units = active.reduce(function (sum, product) { return sum + Number(product.remainingQuantity || 0); }, 0);
    var acquisition = active.reduce(function (sum, product) { return sum + Number(product.purchasePrice || 0) * Number(product.remainingQuantity || 0); }, 0);
    var priced = active.filter(function (product) { return positive(product.salePrice); });
    var saleValue = priced.reduce(function (sum, product) { return sum + Number(product.salePrice || 0) * Number(product.remainingQuantity || 0); }, 0);
    var margin = priced.reduce(function (sum, product) { return sum + (Number(product.salePrice || 0) - Number(product.purchasePrice || 0)) * Number(product.remainingQuantity || 0); }, 0);
    var sold = products.reduce(function (sum, product) { return sum + Number(product.sold || 0); }, 0);
    var withoutPrice = active.length - priced.length;

    A.qs("#stockRefs").textContent = refs;
    A.qs("#stockUnits").textContent = units;
    A.qs("#stockBuyValue").textContent = euro(acquisition);
    A.qs("#stockSaleValue").textContent = euro(saleValue);
    A.qs("#stockSaleValueNote").textContent = withoutPrice ? withoutPrice + " ligne(s) à vérifier — non incluses" : "toutes les lignes en stock sont tarifées";
    A.qs("#stockMargin").textContent = euro(margin);
    A.qs("#stockSold").textContent = sold;

    A.qs("#stockRows").innerHTML = products.map(function (product) {
      var meta = [product.extension, product.number ? "#" + product.number : ""].filter(Boolean).join(" · ");
      var remaining = Number(product.remainingQuantity || 0);
      var totalStock = positive(product.salePrice) ? euro(product.salePrice * remaining) : "<strong>À vérifier</strong>";
      var marginValue = positive(product.salePrice) ? euro((product.salePrice - product.purchasePrice) * remaining) : "<strong>À vérifier</strong>";
      var marketPrice = positive(product.marketPrice) ? euro(product.marketPrice) : "<strong>À vérifier</strong>";
      var salePrice = positive(product.salePrice) ? euro(product.salePrice) : "<strong>À vérifier</strong>";
      var quantityNote = product.sold ? "<br><small>Achetées : " + esc(product.quantityPurchased) + "</small>" : "";
      var warning = product.sold > product.quantityPurchased ? "<br><small style='color:#ff9b9b'>Ventes enregistrées supérieures aux achats disponibles</small>" : "";
      return "<tr>" +
        "<td><strong>" + esc(product.name) + "</strong>" + (meta ? "<br><small>" + esc(meta) + "</small>" : "") + warning + "</td>" +
        "<td>" + conditionSelect(product) + "</td>" +
        "<td>" + euro(product.purchasePrice) + "</td>" +
        "<td>" + marketPrice + "<br><small>" + esc(product.salePriceSource) + "</small></td>" +
        "<td>" + salePrice + "<br><small>" + esc(product.salePriceNote || "") + "</small></td>" +
        "<td><strong>" + esc(remaining) + "</strong>" + quantityNote + "</td>" +
        "<td>" + totalStock + "</td>" +
        "<td>" + marginValue + "</td>" +
        "<td>" + soldControl(product) + "</td>" +
        "<td>" + marketSelect(product) + "</td>" +
        "</tr>";
    }).join("") || "<tr><td colspan='10'>Aucun achat Pokémon payé à mettre en stock.</td></tr>";
    bindStockControls();
  }

  A.renderShell("stock", "Stock & prix", "Stock Cardoria restant, valeur marché externe, prix conseillé, marge potentielle et sorties de stock prouvées",
    '<div class="admin-kpi-grid">' +
      '<div class="admin-kpi"><label>Références en stock</label><strong id="stockRefs">0</strong><small>lignes avec quantité restante</small></div>' +
      '<div class="admin-kpi"><label>Unités en stock</label><strong id="stockUnits">0</strong><small>achetées - vendues Cardoria</small></div>' +
      '<div class="admin-kpi"><label>Valeur achat stock</label><strong id="stockBuyValue">0,00 €</strong><small>coût Cardoria du stock restant</small></div>' +
      '<div class="admin-kpi"><label>Valeur vente connue</label><strong id="stockSaleValue">0,00 €</strong><small id="stockSaleValueNote">prix fiables uniquement</small></div>' +
      '<div class="admin-kpi"><label>Marge potentielle</label><strong id="stockMargin">0,00 €</strong><small>stock restant, avant frais de vente</small></div>' +
      '<div class="admin-kpi"><label>Vendu</label><strong id="stockSold">0</strong><small>ventes cartes prouvées + ajustements enregistrés</small></div>' +
    '</div>' +
    '<div class="admin-panel">' +
      '<p class="small"><strong>Montant marché</strong> : médiane des sources marché externes enregistrées pour une carte, ou prix marché externe de la référence scellée liée. Les sources internes <code>cardoria</code> et <code>manual</code> sont exclues. Sans source externe positive, le prix reste « À vérifier ».</p>' +
      '<p class="small"><strong>Prix vente conseillé</strong> : montant marché ajusté selon l’état pour une carte ; prix marché sans ajustement d’état pour un produit scellé. <strong>Quantité</strong> : achats payés moins sorties de stock Cardoria enregistrées. Les ventes Marketplace de vendeurs tiers et les simples estimations ne retirent pas de stock Cardoria.</p>' +
      '<p class="small"><strong>Vendu</strong> : les cartes liées utilisent automatiquement les ventes Cardoria prouvées. Pour un scellé ou une référence non reliée, saisis explicitement le nombre vendu ; cet ajustement est enregistré dans l’achat et n’est jamais deviné.</p>' +
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Carte / produit Pokémon</th><th>État</th><th>Montant achat Cardoria</th><th>Montant marché</th><th>Prix vente conseillé</th><th>Quantité en stock</th><th>Total stock</th><th>Marge</th><th>Vendu</th><th>Market</th></tr></thead><tbody id="stockRows"></tbody></table></div>' +
    '</div>');

  A.adminFetch("/api/admin/accounting/purchases")
    .then(function (data) {
      if (!data || !data.ok) throw new Error(data && data.error || "Impossible de charger les achats.");
      return buildStock(data.purchases || []);
    })
    .then(function (products) { renderStock(products, false); })
    .catch(function (error) {
      A.qs("#stockRows").innerHTML = "<tr><td colspan='10'>Erreur de chargement du stock : " + esc(error.message || error) + "</td></tr>";
    });
})();