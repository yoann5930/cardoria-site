(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A || !A.protectAdmin()) return;

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

  function add(map, item) {
    var key = item.key;
    var qty = Math.max(1, Math.trunc(Number(item.stock) || 1));
    var unitCost = Math.max(0, Number(item.price) || 0);
    if (!map[key]) {
      map[key] = {
        id: item.id,
        name: item.name || "Achat Pokémon",
        extension: item.extension || "",
        number: item.number || "",
        category: item.category || "Carte Pokémon",
        condition: item.condition || "Non renseigné",
        packaging: item.packaging || "carte_unite",
        price: round2(unitCost),
        stock: qty,
        linked: !!item.linked,
        source: "Achats",
        latestPurchaseAt: item.latestPurchaseAt || "",
        totalCost: unitCost * qty
      };
      return;
    }
    var current = map[key];
    current.stock += qty;
    current.totalCost += unitCost * qty;
    current.price = current.stock ? round2(current.totalCost / current.stock) : 0;
    current.linked = current.linked || !!item.linked;
    if (String(item.latestPurchaseAt || "") > String(current.latestPurchaseAt || "")) current.latestPurchaseAt = item.latestPurchaseAt;
  }

  async function buildStock(purchases) {
    var map = Object.create(null);
    var paid = (purchases || []).filter(isStockPurchase);
    var cardIds = [];

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
            add(map, {
              key: lotId ? "card:" + lotId : "purchase:" + p.id + ":" + i,
              id: lotId || p.id + ":" + (i + 1),
              name: lotCard && lotCard.name ? lotCard.name : (p.description || "Carte Pokémon du lot"),
              extension: lotCard && lotCard.extension || "",
              number: lotCard && lotCard.number || "",
              category: lotCard && (lotCard.hitFamily || lotCard.rarity) || "Carte Pokémon",
              condition: p.condition || p.cardCondition || "Non renseigné",
              packaging: packaging,
              price: unitCost,
              stock: 1,
              linked: !!lotCard,
              latestPurchaseAt: purchaseDate
            });
          }
        } else {
          add(map, {
            key: "purchase:" + p.id + ":lot",
            id: p.id,
            name: p.description || "Lot de cartes Pokémon",
            category: "Lot de cartes",
            condition: "Non renseigné",
            packaging: packaging,
            price: unitCost,
            stock: qty,
            linked: false,
            latestPurchaseAt: purchaseDate
          });
        }
        return;
      }

      if (packaging === "carte_unite" || !p.packaging) {
        var cardId = catalogCardId(p.reference);
        var card = cards[cardId] || null;
        add(map, {
          key: cardId ? "card:" + cardId : "purchase:" + p.id,
          id: cardId || p.id,
          name: card && card.name ? card.name : (p.description || "Carte Pokémon"),
          extension: card && card.extension || "",
          number: card && card.number || "",
          category: card && (card.hitFamily || card.rarity) || "Carte Pokémon",
          condition: p.condition || p.cardCondition || "Non renseigné",
          packaging: packaging,
          price: unitCost,
          stock: qty,
          linked: !!card,
          latestPurchaseAt: purchaseDate
        });
        return;
      }

      add(map, {
        key: "purchase:" + p.id + ":sealed",
        id: p.id,
        name: p.description || "Produit Pokémon scellé",
        category: "Produit scellé",
        condition: "Scellé",
        packaging: packaging,
        price: unitCost,
        stock: qty,
        linked: false,
        latestPurchaseAt: purchaseDate
      });
    });

    return Object.keys(map).map(function (key) { return map[key]; }).sort(function (a, b) {
      return String(b.latestPurchaseAt || "").localeCompare(String(a.latestPurchaseAt || "")) || String(a.name || "").localeCompare(String(b.name || ""), "fr");
    });
  }

  function renderStock(products) {
    var refs = products.length;
    var units = products.reduce(function (sum, p) { return sum + Number(p.stock || 0); }, 0);
    var value = products.reduce(function (sum, p) { return sum + Number(p.price || 0) * Number(p.stock || 0); }, 0);
    var linked = products.filter(function (p) { return p.linked; }).length;
    A.qs("#stockRefs").textContent = refs;
    A.qs("#stockUnits").textContent = units;
    A.qs("#stockValue").textContent = euro(value);
    A.qs("#stockLinked").textContent = linked + " / " + refs;

    A.qs("#stockRows").innerHTML = products.map(function (p) {
      var cardMeta = [p.extension, p.number ? "#" + p.number : ""].filter(Boolean).join(" · ");
      return "<tr>" +
        "<td><small>" + esc(p.id) + "</small></td>" +
        "<td><strong>" + esc(p.name) + "</strong>" + (cardMeta ? "<br><small>" + esc(cardMeta) + "</small>" : "") + "</td>" +
        "<td>" + esc(p.category) + "</td>" +
        "<td>" + esc(p.condition) + "</td>" +
        "<td>" + euro(p.price) + "</td>" +
        "<td><strong>" + esc(p.stock) + "</strong></td>" +
        "<td>" + (p.linked ? "Catalogue lié" : "Achat enregistré") + "</td>" +
        "</tr>";
    }).join("") || "<tr><td colspan='7'>Aucun achat Pokémon payé à mettre en stock.</td></tr>";
  }

  A.renderShell("stock", "Stock", "Inventaire construit automatiquement depuis les achats Pokémon payés",
    '<div class="admin-kpi-grid">' +
      '<div class="admin-kpi"><label>Références</label><strong id="stockRefs">0</strong><small>lignes de stock</small></div>' +
      '<div class="admin-kpi"><label>Unités en stock</label><strong id="stockUnits">0</strong><small>cartes et produits</small></div>' +
      '<div class="admin-kpi"><label>Valeur d\'achat</label><strong id="stockValue">0,00 €</strong><small>coût d\'acquisition</small></div>' +
      '<div class="admin-kpi"><label>Liées au catalogue</label><strong id="stockLinked">0 / 0</strong><small>identification exacte</small></div>' +
    '</div>' +
    '<div class="admin-panel"><p class="small">Le stock se met à jour automatiquement : seuls les achats payés sont comptés. Un achat annulé, remboursé ou supprimé est retiré du stock au prochain chargement.</p>' +
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Réf.</th><th>Nom</th><th>Catégorie</th><th>État</th><th>Prix achat moy.</th><th>Stock</th><th>Source</th></tr></thead><tbody id="stockRows"></tbody></table></div></div>');

  A.adminFetch("/api/admin/accounting/purchases")
    .then(function (data) {
      if (!data || !data.ok) throw new Error(data && data.error || "Impossible de charger les achats.");
      return buildStock(data.purchases || []);
    })
    .then(renderStock)
    .catch(function (error) {
      A.qs("#stockRows").innerHTML = "<tr><td colspan='7'>Erreur de chargement du stock : " + esc(error.message || error) + "</td></tr>";
    });
})();
