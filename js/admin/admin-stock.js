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
  var purchasesById = Object.create(null);
  var productsByKey = Object.create(null);

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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
    if (lower === "played" || lower === "joué" || lower === "joue") return "PL";
    if (lower === "poor" || lower === "mauvais") return "PO";
    return "";
  }

  function parseStockPrefs(notes) {
    var match = String(notes || "").match(/\[STOCK_PREFS\]\s*(\{[^\n\r]*\})/);
    if (!match) return {};
    try {
      var parsed = JSON.parse(match[1]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (e) { return {}; }
  }

  function readLinePreference(purchase, key) {
    var prefs = parseStockPrefs(purchase && purchase.notes);
    var pref = prefs[key];
    if (!pref || typeof pref !== "object") return null;
    return { condition: normalizeCondition(pref.condition), marketEnabled: pref.market === true };
  }

  function writeLinePreference(notes, key, preference) {
    var current = String(notes || "");
    var prefs = parseStockPrefs(current);
    prefs[key] = { condition: normalizeCondition(preference.condition), market: preference.marketEnabled === true };
    var base = current.replace(/\n?\[STOCK_PREFS\]\s*\{[^\n\r]*\}/g, "").replace(/\s+$/, "");
    var line = STOCK_PREFS_TAG + " " + JSON.stringify(prefs);
    return base ? base + "\n" + line : line;
  }

  function catalogCardId(reference) {
    var value = String(reference || "").trim(), prefix = "catalog-card:";
    return value.indexOf(prefix) === 0 ? value.slice(prefix.length) : "";
  }

  function lotCardIds(purchase) {
    if (Array.isArray(purchase.lotCards) && purchase.lotCards.length) return purchase.lotCards.filter(Boolean);
    var match = String(purchase.notes || "").match(/\[LOT_CARDS\]\s*(\[[^\n\r]*\])/);
    if (!match) return [];
    try { var ids = JSON.parse(match[1]); return Array.isArray(ids) ? ids.filter(Boolean) : []; }
    catch (e) { return []; }
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

  function baseMarketPrice(card) {
    if (!card) return 0;
    return positive(card.prices && card.prices.recommended) ||
      positive(card.market && card.market.avg7) ||
      positive(card.market && card.market.avg30) ||
      positive(card.prices && card.prices.avg) || 0;
  }

  function marketSourceLabel(card) {
    if (!card) return "Non relié";
    var sources = (card.priceSources || []).filter(function (s) { return positive(s.price); });
    if (sources.length) {
      var names = [];
      sources.forEach(function (s) { if (s.source && names.indexOf(s.source) < 0) names.push(s.source); });
      return names.slice(0, 3).join(" + ") + (names.length > 3 ? " +…" : "");
    }
    return card.market && card.market.source ? card.market.source : "Prix indisponible";
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
        name: item.name || "Achat Pokémon",
        extension: item.extension || "",
        number: item.number || "",
        category: item.category || "Carte Pokémon",
        condition: preference ? preference.condition : normalizeCondition(item.condition),
        marketEnabled: preference ? preference.marketEnabled : false,
        preferenceApplied: !!preference,
        packaging: item.packaging || "carte_unite",
        purchasePrice: round2(unitCost),
        quantity: qty,
        linked: !!item.linked,
        latestPurchaseAt: item.latestPurchaseAt || "",
        totalCost: unitCost * qty,
        purchaseIds: item.purchaseId ? [item.purchaseId] : [],
        marketPrice: baseMarketPrice(item.card),
        salePrice: 0,
        salePriceSource: marketSourceLabel(item.card),
        sold: Number(item.card && item.card.salesStats && item.card.salesStats.count || 0)
      };
      return;
    }
    var current = map[key];
    current.quantity += qty;
    current.totalCost += unitCost * qty;
    current.purchasePrice = current.quantity ? round2(current.totalCost / current.quantity) : 0;
    current.linked = current.linked || !!item.linked;
    if (!current.card && item.card) current.card = item.card;
    if (item.purchaseId && current.purchaseIds.indexOf(item.purchaseId) < 0) current.purchaseIds.push(item.purchaseId);
    if (!current.preferenceApplied && preference) {
      current.condition = preference.condition;
      current.marketEnabled = preference.marketEnabled;
      current.preferenceApplied = true;
    }
    if (String(item.latestPurchaseAt || "") > String(current.latestPurchaseAt || "")) current.latestPurchaseAt = item.latestPurchaseAt;
  }

  async function enrichSalePrice(product) {
    if (!product.cardId || !product.card) {
      product.marketPrice = 0;
      product.salePrice = 0;
      product.salePriceSource = "Référence marché non reliée";
      return product;
    }
    product.marketPrice = baseMarketPrice(product.card);
    product.sold = Number(product.card.salesStats && product.card.salesStats.count || 0);
    product.salePriceSource = marketSourceLabel(product.card);

    var condition = normalizeCondition(product.condition);
    if (!condition) {
      product.salePrice = product.marketPrice;
      product.salePriceNote = product.marketPrice ? "Prix marché non ajusté — renseigner l'état" : "Prix marché indisponible";
      return product;
    }

    var result = await A.adminFetch("/api/admin/engine/estimate-price", {
      method: "POST",
      body: JSON.stringify({ cardId: product.cardId, condition: condition })
    });
    if (result && result.ok && result.estimate && positive(result.estimate.recommended)) {
      product.salePrice = positive(result.estimate.recommended);
      product.salePriceNote = "Ajusté selon l'état " + condition;
      if (Array.isArray(result.estimate.sources) && result.estimate.sources.length) {
        var src = [];
        result.estimate.sources.forEach(function (s) { if (s.source && src.indexOf(s.source) < 0) src.push(s.source); });
        if (src.length) product.salePriceSource = src.slice(0, 3).join(" + ") + (src.length > 3 ? " +…" : "");
      }
    } else {
      product.salePrice = product.marketPrice;
      product.salePriceNote = product.marketPrice ? "Prix marché de référence" : "Prix marché indisponible";
    }
    return product;
  }

  async function buildStock(purchases) {
    var map = Object.create(null), paid = (purchases || []).filter(isStockPurchase), cardIds = [];
    purchasesById = Object.create(null);
    (purchases || []).forEach(function (purchase) { if (purchase && purchase.id) purchasesById[purchase.id] = purchase; });

    paid.forEach(function (p) {
      if (String(p.packaging || "carte_unite") === "lot_cartes") {
        lotCardIds(p).forEach(function (id) { if (id && cardIds.indexOf(id) < 0) cardIds.push(id); });
      } else {
        var id = catalogCardId(p.reference);
        if (id && cardIds.indexOf(id) < 0) cardIds.push(id);
      }
    });

    var resolvedPairs = await Promise.all(cardIds.map(async function (id) { return [id, await resolveCard(id)]; }));
    var cards = Object.create(null);
    resolvedPairs.forEach(function (pair) { cards[pair[0]] = pair[1]; });

    paid.forEach(function (p) {
      var qty = Math.max(1, Math.trunc(Number(p.quantity) || 1));
      var amount = Math.max(0, Number(p.amount) || 0);
      var unitCost = qty ? amount / qty : amount;
      var packaging = String(p.packaging || "carte_unite"), purchaseDate = p.date || p.createdAt || "";

      if (packaging === "lot_cartes") {
        var ids = lotCardIds(p);
        if (ids.length) {
          for (var i = 0; i < qty; i += 1) {
            var lotId = ids[i] || "", lotCard = cards[lotId] || null;
            var lotKey = lotId ? "card:" + lotId : "purchase:" + p.id + ":" + i;
            add(map, { key: lotKey, id: lotId || p.id + ":" + (i + 1), cardId: lotId, card: lotCard,
              name: lotCard && lotCard.name ? lotCard.name : (p.description || "Carte Pokémon du lot"),
              extension: lotCard && lotCard.extension || "", number: lotCard && lotCard.number || "",
              category: lotCard && (lotCard.hitFamily || lotCard.rarity) || "Carte Pokémon",
              condition: p.condition || p.cardCondition || "", preference: readLinePreference(p, lotKey), packaging: packaging,
              price: unitCost, quantity: 1, linked: !!lotCard, latestPurchaseAt: purchaseDate, purchaseId: p.id });
          }
        } else {
          var fallbackKey = "purchase:" + p.id + ":lot";
          add(map, { key: fallbackKey, id: p.id, name: p.description || "Lot de cartes Pokémon", category: "Lot de cartes",
            condition: p.condition || p.cardCondition || "", preference: readLinePreference(p, fallbackKey), packaging: packaging,
            price: unitCost, quantity: qty, linked: false, latestPurchaseAt: purchaseDate, purchaseId: p.id });
        }
        return;
      }

      if (packaging === "carte_unite" || !p.packaging) {
        var cardId = catalogCardId(p.reference), card = cards[cardId] || null;
        var cardKey = cardId ? "card:" + cardId : "purchase:" + p.id;
        add(map, { key: cardKey, id: cardId || p.id, cardId: cardId, card: card,
          name: card && card.name ? card.name : (p.description || "Carte Pokémon"), extension: card && card.extension || "", number: card && card.number || "",
          category: card && (card.hitFamily || card.rarity) || "Carte Pokémon", condition: p.condition || p.cardCondition || "",
          preference: readLinePreference(p, cardKey), packaging: packaging, price: unitCost, quantity: qty, linked: !!card,
          latestPurchaseAt: purchaseDate, purchaseId: p.id });
        return;
      }

      var sealedKey = "purchase:" + p.id + ":sealed";
      add(map, { key: sealedKey, id: p.id, name: p.description || "Produit Pokémon scellé", category: "Produit scellé",
        condition: "", preference: readLinePreference(p, sealedKey), packaging: packaging, price: unitCost, quantity: qty,
        linked: false, latestPurchaseAt: purchaseDate, purchaseId: p.id });
    });

    var products = Object.keys(map).map(function (key) { return map[key]; });
    await Promise.all(products.map(enrichSalePrice));
    return products.sort(function (a, b) {
      return String(b.latestPurchaseAt || "").localeCompare(String(a.latestPurchaseAt || "")) || String(a.name || "").localeCompare(String(b.name || ""), "fr");
    });
  }

  function conditionSelect(p) {
    var isCard = p.packaging === "carte_unite" || p.packaging === "lot_cartes";
    if (!isCard) return '<select disabled><option>Scellé</option></select>';
    return '<select data-stock-condition="' + esc(p.key) + '">' + CONDITION_OPTIONS.map(function (option) {
      return '<option value="' + esc(option.value) + '"' + (option.value === normalizeCondition(p.condition) ? ' selected' : '') + '>' + esc(option.label) + '</option>';
    }).join('') + '</select>';
  }

  function marketSelect(p) {
    return '<select data-stock-market="' + esc(p.key) + '">' +
      '<option value="no"' + (!p.marketEnabled ? ' selected' : '') + '>Non</option>' +
      '<option value="yes"' + (p.marketEnabled ? ' selected' : '') + '>Oui</option>' +
      '</select><br><small data-stock-save="' + esc(p.key) + '" style="color:#baaf97">Enregistré</small>';
  }

  function setRowBusy(key, busy) {
    var condition = document.querySelector('[data-stock-condition="' + CSS.escape(key) + '"]');
    var market = document.querySelector('[data-stock-market="' + CSS.escape(key) + '"]');
    if (condition) condition.disabled = !!busy;
    if (market) market.disabled = !!busy;
  }
  function setSaveStatus(key, text, isError) {
    var el = document.querySelector('[data-stock-save="' + CSS.escape(key) + '"]');
    if (!el) return;
    el.textContent = text; el.style.color = isError ? "#ff7373" : "#baaf97";
  }

  async function saveRowPreference(product, nextPreference) {
    var ids = (product.purchaseIds || []).slice();
    if (!ids.length) throw new Error("Aucun achat lié à cette ligne de stock.");
    setRowBusy(product.key, true); setSaveStatus(product.key, "Enregistrement…", false);
    try {
      for (var i = 0; i < ids.length; i += 1) {
        var id = ids[i], purchase = purchasesById[id];
        if (!purchase) continue;
        var body = Object.assign({}, purchase, { notes: writeLinePreference(purchase.notes, product.key, nextPreference) });
        var response = await A.adminFetch("/api/admin/accounting/purchases/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(body) });
        if (!response || !response.ok) throw new Error(response && response.error || "Enregistrement impossible.");
        purchasesById[id] = response.purchase || body;
      }
      product.condition = normalizeCondition(nextPreference.condition);
      product.marketEnabled = nextPreference.marketEnabled === true;
      product.preferenceApplied = true;
      await enrichSalePrice(product);
      renderStock(Object.keys(productsByKey).map(function (key) { return productsByKey[key]; }), true);
    } catch (error) {
      setSaveStatus(product.key, "Erreur d’enregistrement", true); throw error;
    } finally { setRowBusy(product.key, false); }
  }

  function bindStockControls() {
    document.querySelectorAll("[data-stock-condition]").forEach(function (select) {
      select.addEventListener("change", function () {
        var product = productsByKey[select.getAttribute("data-stock-condition")];
        if (!product) return;
        var previous = normalizeCondition(product.condition);
        saveRowPreference(product, { condition: select.value, marketEnabled: product.marketEnabled }).catch(function () { select.value = previous; });
      });
    });
    document.querySelectorAll("[data-stock-market]").forEach(function (select) {
      select.addEventListener("change", function () {
        var product = productsByKey[select.getAttribute("data-stock-market")];
        if (!product) return;
        var previous = product.marketEnabled ? "yes" : "no";
        saveRowPreference(product, { condition: product.condition, marketEnabled: select.value === "yes" }).catch(function () { select.value = previous; });
      });
    });
  }

  function renderStock(products, preserveMap) {
    if (!preserveMap) {
      productsByKey = Object.create(null);
      products.forEach(function (p) { productsByKey[p.key] = p; });
    }
    var refs = products.length;
    var units = products.reduce(function (sum, p) { return sum + Number(p.quantity || 0); }, 0);
    var acquisition = products.reduce(function (sum, p) { return sum + Number(p.purchasePrice || 0) * Number(p.quantity || 0); }, 0);
    var saleValue = products.reduce(function (sum, p) { return sum + Number(p.salePrice || 0) * Number(p.quantity || 0); }, 0);
    var margin = saleValue - acquisition;
    var sold = products.reduce(function (sum, p) { return sum + Number(p.sold || 0); }, 0);
    A.qs("#stockRefs").textContent = refs;
    A.qs("#stockUnits").textContent = units;
    A.qs("#stockBuyValue").textContent = euro(acquisition);
    A.qs("#stockSaleValue").textContent = euro(saleValue);
    A.qs("#stockMargin").textContent = euro(margin);
    A.qs("#stockSold").textContent = sold;

    A.qs("#stockRows").innerHTML = products.map(function (p) {
      var meta = [p.extension, p.number ? "#" + p.number : ""].filter(Boolean).join(" · ");
      var unitMargin = p.salePrice > 0 ? round2(p.salePrice - p.purchasePrice) : 0;
      var totalMargin = p.salePrice > 0 ? round2(unitMargin * p.quantity) : 0;
      var totalStock = p.salePrice > 0 ? round2(p.salePrice * p.quantity) : 0;
      return "<tr>" +
        "<td><strong>" + esc(p.name) + "</strong>" + (meta ? "<br><small>" + esc(meta) + "</small>" : "") + "</td>" +
        "<td>" + conditionSelect(p) + "</td>" +
        "<td><strong>" + euro(p.purchasePrice) + "</strong></td>" +
        "<td>" + (p.marketPrice > 0 ? "<strong>" + euro(p.marketPrice) + "</strong>" : "<span style='color:#baaf97'>Indisponible</span>") + "<br><small>" + esc(p.salePriceSource) + "</small></td>" +
        "<td>" + (p.salePrice > 0 ? "<strong>" + euro(p.salePrice) + "</strong>" : "<span style='color:#ffb3b3'>À vérifier</span>") + "<br><small>" + esc(p.salePriceNote || "") + "</small></td>" +
        "<td><strong>" + esc(p.quantity) + "</strong></td>" +
        "<td><strong>" + (p.salePrice > 0 ? euro(totalStock) : "—") + "</strong></td>" +
        "<td>" + (p.salePrice > 0 ? "<strong>" + euro(unitMargin) + "</strong><br><small>Total " + euro(totalMargin) + "</small>" : "—") + "</td>" +
        "<td><strong>" + esc(p.sold) + "</strong><br><small>ventes Cardoria enregistrées</small></td>" +
        "<td>" + marketSelect(p) + "</td>" +
        "</tr>";
    }).join("") || "<tr><td colspan='10'>Aucun achat Pokémon payé à mettre en stock.</td></tr>";
    bindStockControls();
  }

  A.renderShell("stock", "Stock & prix de vente", "Coût Cardoria, valeur marché, prix conseillé, marge et ventes enregistrées",
    '<div class="admin-kpi-grid">' +
      '<div class="admin-kpi"><label>Références</label><strong id="stockRefs">0</strong><small>lignes</small></div>' +
      '<div class="admin-kpi"><label>Quantité</label><strong id="stockUnits">0</strong><small>unités achetées</small></div>' +
      '<div class="admin-kpi"><label>Valeur achat</label><strong id="stockBuyValue">0,00 €</strong><small>coût Cardoria</small></div>' +
      '<div class="admin-kpi"><label>Valeur de vente stock</label><strong id="stockSaleValue">0,00 €</strong><small>prix conseillé × quantité</small></div>' +
      '<div class="admin-kpi"><label>Marge potentielle</label><strong id="stockMargin">0,00 €</strong><small>avant frais de vente</small></div>' +
      '<div class="admin-kpi"><label>Vendu</label><strong id="stockSold">0</strong><small>ventes internes enregistrées</small></div>' +
    '</div>' +
    '<div class="admin-panel"><p class="small"><strong>Prix marché</strong> = référence disponible dans le moteur Cardoria. <strong>Prix vente conseillé</strong> = prix agrégé multi-sources ajusté selon l’état lorsque celui-ci est renseigné. Si aucune source fiable n’existe, Cardoria affiche « À vérifier » et ne fabrique pas de prix.</p>' +
      '<p class="small">Sources actuellement exploitables selon les cartes : Cardmarket/TCGdex, TCGplayer/TCGCSV, ZebraDex et autres sources enregistrées. eBay n’est utilisé que lorsqu’une source eBay valide est effectivement présente. Les annonces Leboncoin ne sont pas assimilées à des ventes réalisées.</p>' +
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Carte Pokémon</th><th>État</th><th>Montant achat Cardoria</th><th>Montant marché</th><th>Prix vente conseillé</th><th>Quantité</th><th>Total stock</th><th>Marge</th><th>Vendu</th><th>Market</th></tr></thead><tbody id="stockRows"></tbody></table></div></div>');

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
