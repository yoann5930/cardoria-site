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

  function euro(n) {
    return Number(n || 0).toFixed(2).replace(".", ",") + " €";
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function positivePrice(value) {
    var number = Number(String(value == null ? "" : value).replace(",", "."));
    return Number.isFinite(number) && number > 0 ? round2(number) : null;
  }

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
    } catch (e) {
      return {};
    }
  }

  function readLinePreference(purchase, key) {
    var prefs = parseStockPrefs(purchase && purchase.notes);
    var pref = prefs[key];
    if (!pref || typeof pref !== "object" || Array.isArray(pref)) return null;
    return {
      condition: normalizeCondition(pref.condition),
      boutiqueEnabled: pref.boutique === false ? false : true,
      boutiquePrice: positivePrice(pref.boutiquePrice)
    };
  }

  function writeLinePreference(notes, key, preference) {
    var current = String(notes || "");
    var prefs = parseStockPrefs(current);
    prefs[key] = {
      condition: normalizeCondition(preference.condition),
      boutique: preference.boutiqueEnabled !== false,
      boutiquePrice: positivePrice(preference.boutiquePrice)
    };
    var base = current.replace(/\n?\[STOCK_PREFS\]\s*\{[^\n\r]*\}/g, "").replace(/\s+$/, "");
    var line = STOCK_PREFS_TAG + " " + JSON.stringify(prefs);
    return base ? base + "\n" + line : line;
  }

  function catalogCardId(reference) {
    var value = String(reference || "").trim();
    var prefix = "catalog-card:";
    return value.indexOf(prefix) === 0 ? value.slice(prefix.length) : "";
  }

  function lotCardIds(purchase) {
    if (Array.isArray(purchase.lotCards) && purchase.lotCards.length) return purchase.lotCards.filter(Boolean);
    var match = String(purchase.notes || "").match(/\[LOT_CARDS\]\s*(\[[^\n\r]*\])/);
    if (!match) return [];
    try {
      var ids = JSON.parse(match[1]);
      return Array.isArray(ids) ? ids.filter(Boolean) : [];
    } catch (e) {
      return [];
    }
  }

  function isStockPurchase(p) {
    if (String(p.status || "paid") !== "paid") return false;
    if (p.purchaseType === "pokemon_card") return true;
    return String(p.license || "").toLowerCase() === "pokemon" && ["cartes", "lots", "boosters"].indexOf(String(p.category || "").toLowerCase()) >= 0;
  }

  async function resolveCard(id) {
    if (!id) return null;
    try {
      var response = await A.adminFetch("/api/admin/engine/cards/" + encodeURIComponent(id));
      return response && response.ok ? response.card : null;
    } catch (e) {
      return null;
    }
  }

  function cardRecommendedPrice(card) {
    if (!card) return null;
    return positivePrice(card.prices && (card.prices.recommended != null ? card.prices.recommended : card.prices.avg));
  }

  function add(map, item) {
    var key = item.key;
    var qty = Math.max(1, Math.trunc(Number(item.stock) || 1));
    var unitCost = Math.max(0, Number(item.price) || 0);
    var preference = item.preference || null;
    if (!map[key]) {
      map[key] = {
        key: key,
        id: item.id,
        name: item.name || "Achat Pokémon",
        extension: item.extension || "",
        number: item.number || "",
        category: item.category || "Carte Pokémon",
        condition: preference ? preference.condition : normalizeCondition(item.condition),
        boutiqueEnabled: preference ? preference.boutiqueEnabled !== false : true,
        boutiquePrice: preference ? positivePrice(preference.boutiquePrice) : null,
        catalogPrice: positivePrice(item.catalogPrice),
        preferenceApplied: !!preference,
        packaging: item.packaging || "carte_unite",
        price: round2(unitCost),
        stock: qty,
        linked: !!item.linked,
        source: "Achats",
        latestPurchaseAt: item.latestPurchaseAt || "",
        totalCost: unitCost * qty,
        purchaseIds: item.purchaseId ? [item.purchaseId] : []
      };
      return;
    }
    var current = map[key];
    current.stock += qty;
    current.totalCost += unitCost * qty;
    current.price = current.stock ? round2(current.totalCost / current.stock) : 0;
    current.linked = current.linked || !!item.linked;
    if (!current.catalogPrice && item.catalogPrice) current.catalogPrice = positivePrice(item.catalogPrice);
    if (item.purchaseId && current.purchaseIds.indexOf(item.purchaseId) < 0) current.purchaseIds.push(item.purchaseId);
    if (!current.preferenceApplied && preference) {
      current.condition = preference.condition;
      current.boutiqueEnabled = preference.boutiqueEnabled !== false;
      current.boutiquePrice = positivePrice(preference.boutiquePrice);
      current.preferenceApplied = true;
    }
    if (String(item.latestPurchaseAt || "") > String(current.latestPurchaseAt || "")) current.latestPurchaseAt = item.latestPurchaseAt;
  }

  async function buildStock(purchases) {
    var map = Object.create(null);
    var paid = (purchases || []).filter(isStockPurchase);
    var cardIds = [];

    purchasesById = Object.create(null);
    (purchases || []).forEach(function (purchase) {
      if (purchase && purchase.id) purchasesById[purchase.id] = purchase;
    });

    paid.forEach(function (p) {
      if (String(p.packaging || "carte_unite") === "lot_cartes") {
        lotCardIds(p).forEach(function (id) { if (id && cardIds.indexOf(id) < 0) cardIds.push(id); });
      } else {
        var id = catalogCardId(p.reference);
        if (id && cardIds.indexOf(id) < 0) cardIds.push(id);
      }
    });

    var resolvedPairs = await Promise.all(cardIds.map(async function (id) {
      return [id, await resolveCard(id)];
    }));
    var cards = Object.create(null);
    resolvedPairs.forEach(function (pair) { cards[pair[0]] = pair[1]; });

    paid.forEach(function (p) {
      var qty = Math.max(1, Math.trunc(Number(p.quantity) || 1));
      var amount = Math.max(0, Number(p.amount) || 0);
      var unitCost = qty ? amount / qty : amount;
      var packaging = String(p.packaging || "carte_unite");
      var purchaseDate = p.date || p.createdAt || "";

      if (packaging === "lot_cartes") {
        var ids = lotCardIds(p);
        if (ids.length) {
          for (var i = 0; i < qty; i += 1) {
            var lotId = ids[i] || "";
            var lotCard = cards[lotId] || null;
            var lotKey = lotId ? "card:" + lotId : "purchase:" + p.id + ":" + i;
            add(map, {
              key: lotKey,
              id: lotId || p.id + ":" + (i + 1),
              name: lotCard && lotCard.name ? lotCard.name : (p.description || "Carte Pokémon du lot"),
              extension: lotCard && lotCard.extension || "",
              number: lotCard && lotCard.number || "",
              category: lotCard && (lotCard.hitFamily || lotCard.rarity) || "Carte Pokémon",
              condition: p.condition || p.cardCondition || "",
              preference: readLinePreference(p, lotKey),
              catalogPrice: cardRecommendedPrice(lotCard),
              packaging: packaging,
              price: unitCost,
              stock: 1,
              linked: !!lotCard,
              latestPurchaseAt: purchaseDate,
              purchaseId: p.id
            });
          }
        } else {
          var lotFallbackKey = "purchase:" + p.id + ":lot";
          add(map, {
            key: lotFallbackKey,
            id: p.id,
            name: p.description || "Lot de cartes Pokémon",
            category: "Lot de cartes",
            condition: p.condition || p.cardCondition || "",
            preference: readLinePreference(p, lotFallbackKey),
            packaging: packaging,
            price: unitCost,
            stock: qty,
            linked: false,
            latestPurchaseAt: purchaseDate,
            purchaseId: p.id
          });
        }
        return;
      }

      if (packaging === "carte_unite" || !p.packaging) {
        var cardId = catalogCardId(p.reference);
        var card = cards[cardId] || null;
        var cardKey = cardId ? "card:" + cardId : "purchase:" + p.id;
        add(map, {
          key: cardKey,
          id: cardId || p.id,
          name: card && card.name ? card.name : (p.description || "Carte Pokémon"),
          extension: card && card.extension || "",
          number: card && card.number || "",
          category: card && (card.hitFamily || card.rarity) || "Carte Pokémon",
          condition: p.condition || p.cardCondition || "",
          preference: readLinePreference(p, cardKey),
          catalogPrice: cardRecommendedPrice(card),
          packaging: packaging,
          price: unitCost,
          stock: qty,
          linked: !!card,
          latestPurchaseAt: purchaseDate,
          purchaseId: p.id
        });
        return;
      }

      var sealedKey = "purchase:" + p.id + ":sealed";
      add(map, {
        key: sealedKey,
        id: p.id,
        name: p.description || "Produit Pokémon scellé",
        category: "Produit scellé",
        condition: "",
        preference: readLinePreference(p, sealedKey),
        packaging: packaging,
        price: unitCost,
        stock: qty,
        linked: false,
        latestPurchaseAt: purchaseDate,
        purchaseId: p.id
      });
    });

    return Object.keys(map).map(function (key) { return map[key]; }).sort(function (a, b) {
      return String(b.latestPurchaseAt || "").localeCompare(String(a.latestPurchaseAt || "")) || String(a.name || "").localeCompare(String(b.name || ""), "fr");
    });
  }

  function conditionSelect(p) {
    var isCard = p.packaging === "carte_unite" || p.packaging === "lot_cartes";
    if (!isCard) return '<select disabled aria-label="État du produit"><option>Scellé</option></select>';
    return '<select data-stock-condition="' + esc(p.key) + '" aria-label="État de ' + esc(p.name) + '">' + CONDITION_OPTIONS.map(function (option) {
      return '<option value="' + esc(option.value) + '"' + (option.value === normalizeCondition(p.condition) ? ' selected' : '') + '>' + esc(option.label) + '</option>';
    }).join('') + '</select>';
  }

  function boutiqueSelect(p) {
    return '<select data-stock-boutique="' + esc(p.key) + '" aria-label="Mise en Boutique de ' + esc(p.name) + '">' +
      '<option value="yes"' + (p.boutiqueEnabled ? ' selected' : '') + '>Oui</option>' +
      '<option value="no"' + (!p.boutiqueEnabled ? ' selected' : '') + '>Non</option>' +
      '</select>';
  }

  function boutiquePriceInput(p) {
    var saved = positivePrice(p.boutiquePrice);
    var autoPrice = positivePrice(p.catalogPrice);
    var placeholder = autoPrice ? String(autoPrice.toFixed(2)).replace(".", ",") : "Prix requis";
    var note = saved ? "Prix Boutique enregistré" : (autoPrice ? "Auto Cardoria : " + euro(autoPrice) : "Renseigne un prix pour vendre");
    return '<input type="number" min="0" step="0.01" inputmode="decimal" data-stock-price="' + esc(p.key) + '" value="' + (saved ? esc(saved.toFixed(2)) : '') + '" placeholder="' + esc(placeholder) + '" style="width:110px" aria-label="Prix Boutique de ' + esc(p.name) + '"><br>' +
      '<small data-stock-price-note="' + esc(p.key) + '" style="color:#baaf97">' + esc(note) + '</small>';
  }

  function setRowBusy(key, busy) {
    var condition = document.querySelector('[data-stock-condition="' + CSS.escape(key) + '"]');
    var boutique = document.querySelector('[data-stock-boutique="' + CSS.escape(key) + '"]');
    var price = document.querySelector('[data-stock-price="' + CSS.escape(key) + '"]');
    if (condition) condition.disabled = !!busy;
    if (boutique) boutique.disabled = !!busy;
    if (price) price.disabled = !!busy;
  }

  function setSaveStatus(key, text, isError) {
    var el = document.querySelector('[data-stock-save="' + CSS.escape(key) + '"]');
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? "#ff7373" : "#baaf97";
  }

  function refreshPriceNote(product) {
    var el = document.querySelector('[data-stock-price-note="' + CSS.escape(product.key) + '"]');
    if (!el) return;
    if (positivePrice(product.boutiquePrice)) el.textContent = "Prix Boutique enregistré";
    else if (positivePrice(product.catalogPrice)) el.textContent = "Auto Cardoria : " + euro(product.catalogPrice);
    else el.textContent = "Renseigne un prix pour vendre";
  }

  async function saveRowPreference(product, nextPreference) {
    var ids = (product.purchaseIds || []).slice();
    if (!ids.length) throw new Error("Aucun achat lié à cette ligne de stock.");
    setRowBusy(product.key, true);
    setSaveStatus(product.key, "Enregistrement…", false);
    try {
      for (var i = 0; i < ids.length; i += 1) {
        var id = ids[i];
        var purchase = purchasesById[id];
        if (!purchase) continue;
        var body = Object.assign({}, purchase, {
          notes: writeLinePreference(purchase.notes, product.key, nextPreference)
        });
        var response = await A.adminFetch("/api/admin/accounting/purchases/" + encodeURIComponent(id), {
          method: "PUT",
          body: JSON.stringify(body)
        });
        if (!response || !response.ok) throw new Error(response && response.error || "Enregistrement impossible.");
        purchasesById[id] = response.purchase || body;
      }
      product.condition = normalizeCondition(nextPreference.condition);
      product.boutiqueEnabled = nextPreference.boutiqueEnabled !== false;
      product.boutiquePrice = positivePrice(nextPreference.boutiquePrice);
      product.preferenceApplied = true;
      refreshPriceNote(product);
      setSaveStatus(product.key, "Enregistré ✓", false);
    } catch (error) {
      setSaveStatus(product.key, "Erreur d’enregistrement", true);
      throw error;
    } finally {
      setRowBusy(product.key, false);
    }
  }

  function bindStockControls() {
    document.querySelectorAll("[data-stock-condition]").forEach(function (select) {
      select.addEventListener("change", function () {
        var product = productsByKey[select.getAttribute("data-stock-condition")];
        if (!product) return;
        var previous = normalizeCondition(product.condition);
        saveRowPreference(product, {
          condition: select.value,
          boutiqueEnabled: product.boutiqueEnabled,
          boutiquePrice: product.boutiquePrice
        }).catch(function () {
          select.value = previous;
        });
      });
    });

    document.querySelectorAll("[data-stock-boutique]").forEach(function (select) {
      select.addEventListener("change", function () {
        var product = productsByKey[select.getAttribute("data-stock-boutique")];
        if (!product) return;
        var previous = product.boutiqueEnabled ? "yes" : "no";
        saveRowPreference(product, {
          condition: product.condition,
          boutiqueEnabled: select.value === "yes",
          boutiquePrice: product.boutiquePrice
        }).catch(function () {
          select.value = previous;
        });
      });
    });

    document.querySelectorAll("[data-stock-price]").forEach(function (input) {
      input.addEventListener("change", function () {
        var product = productsByKey[input.getAttribute("data-stock-price")];
        if (!product) return;
        var previous = positivePrice(product.boutiquePrice);
        var nextPrice = positivePrice(input.value);
        saveRowPreference(product, {
          condition: product.condition,
          boutiqueEnabled: product.boutiqueEnabled,
          boutiquePrice: nextPrice
        }).then(function () {
          input.value = nextPrice ? nextPrice.toFixed(2) : "";
        }).catch(function () {
          input.value = previous ? previous.toFixed(2) : "";
        });
      });
    });
  }

  function renderStock(products) {
    var refs = products.length;
    var units = products.reduce(function (sum, p) { return sum + Number(p.stock || 0); }, 0);
    var value = products.reduce(function (sum, p) { return sum + Number(p.price || 0) * Number(p.stock || 0); }, 0);
    var linked = products.filter(function (p) { return p.linked; }).length;
    var boutiqueCount = products.filter(function (p) { return p.boutiqueEnabled; }).length;
    A.qs("#stockRefs").textContent = refs;
    A.qs("#stockUnits").textContent = units;
    A.qs("#stockValue").textContent = euro(value);
    A.qs("#stockLinked").textContent = linked + " / " + refs;
    A.qs("#stockBoutique").textContent = boutiqueCount + " / " + refs;

    productsByKey = Object.create(null);
    products.forEach(function (product) { productsByKey[product.key] = product; });

    A.qs("#stockRows").innerHTML = products.map(function (p) {
      var cardMeta = [p.extension, p.number ? "#" + p.number : ""].filter(Boolean).join(" · ");
      return "<tr>" +
        "<td><small>" + esc(p.id) + "</small></td>" +
        "<td><strong>" + esc(p.name) + "</strong>" + (cardMeta ? "<br><small>" + esc(cardMeta) + "</small>" : "") + "</td>" +
        "<td>" + esc(p.category) + "</td>" +
        "<td>" + conditionSelect(p) + "</td>" +
        "<td>" + euro(p.price) + "</td>" +
        "<td>" + boutiquePriceInput(p) + "</td>" +
        "<td><strong>" + esc(p.stock) + "</strong></td>" +
        "<td>" + boutiqueSelect(p) + '<br><small data-stock-save="' + esc(p.key) + '" style="color:#baaf97">Enregistré</small></td>' +
        "<td>" + (p.linked ? "Catalogue lié" : "Achat enregistré") + "</td>" +
        "</tr>";
    }).join("") || "<tr><td colspan='9'>Aucun achat Pokémon payé à mettre en stock.</td></tr>";
    bindStockControls();
  }

  A.renderShell("stock", "Stock", "Inventaire des achats Cardoria relié directement à la Boutique",
    '<div class="admin-kpi-grid">' +
      '<div class="admin-kpi"><label>Références</label><strong id="stockRefs">0</strong><small>lignes de stock</small></div>' +
      '<div class="admin-kpi"><label>Unités en stock</label><strong id="stockUnits">0</strong><small>cartes et produits</small></div>' +
      '<div class="admin-kpi"><label>Valeur d\'achat</label><strong id="stockValue">0,00 €</strong><small>coût d\'acquisition</small></div>' +
      '<div class="admin-kpi"><label>Liées au catalogue</label><strong id="stockLinked">0 / 0</strong><small>identification exacte</small></div>' +
      '<div class="admin-kpi"><label>Dans la Boutique</label><strong id="stockBoutique">0 / 0</strong><small>références autorisées</small></div>' +
    '</div>' +
    '<div class="admin-panel"><p class="small">Le stock se met à jour automatiquement depuis les achats Pokémon payés. Un achat annulé, remboursé ou supprimé est retiré au prochain chargement.</p>' +
      '<p class="small"><strong>État</strong> : état réel de la carte. <strong>Prix Boutique</strong> : prix de vente public ; si le champ est vide et que la carte est liée au catalogue, Cardoria utilise son prix recommandé. <strong>Boutique</strong> : Oui pour afficher et vendre la ligne sur la Boutique Cardoria, Non pour la garder uniquement en stock interne.</p>' +
      '<p class="small"><strong>Important :</strong> le Market/Marketplace est désormais séparé de ce stock. Cette page pilote uniquement le stock Cardoria et la Boutique.</p>' +
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Réf.</th><th>Nom</th><th>Catégorie</th><th>État</th><th>Prix achat moy.</th><th>Prix Boutique</th><th>Stock</th><th>Boutique</th><th>Source</th></tr></thead><tbody id="stockRows"></tbody></table></div></div>');

  A.adminFetch("/api/admin/accounting/purchases")
    .then(function (data) {
      if (!data || !data.ok) throw new Error(data && data.error || "Impossible de charger les achats.");
      return buildStock(data.purchases || []);
    })
    .then(renderStock)
    .catch(function (error) {
      A.qs("#stockRows").innerHTML = "<tr><td colspan='9'>Erreur de chargement du stock : " + esc(error.message || error) + "</td></tr>";
    });
})();