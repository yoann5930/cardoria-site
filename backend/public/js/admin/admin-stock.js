(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A || !A.protectAdmin()) return;

  var STOCK_PREFS_TAG = "[STOCK_PREFS]";
  var purchasesById = Object.create(null);
  var inventoryByKey = Object.create(null);
  var saveQueue = Promise.resolve();
  var conditions = ["", "M", "NM", "EX", "GD", "LP", "PL", "PO"];
  var stockFilter = "all";
  var stockQuery = "";
  var lastInventory = [];
  var lastTotals = {};
  var lowStockThreshold = 2;
  var maxStockBase = 100000;

  function esc(v) { return String(v == null ? "" : v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;"); }
  function euro(v) { return Number(v || 0).toFixed(2).replace(".", ",") + " €"; }
  function price(v) { var n = Number(String(v == null ? "" : v).replace(",", ".")); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; }
  function normalizeCondition(v) { var u = String(v || "").trim().toUpperCase(); return conditions.indexOf(u) >= 0 ? u : ""; }
  function nonNegativeInt(v) { if (typeof v === "string" && !/^\d+$/.test(String(v).trim())) return null; var n = Number(v); return Number.isInteger(n) && n >= 0 ? n : null; }
  function positiveWeight(v) { if (v == null || v === "") return null; if (typeof v === "string" && !/^\d+$/.test(String(v).trim())) return null; var n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 30000 ? n : null; }

  function parsePrefs(notes) {
    var m = String(notes || "").match(/\[STOCK_PREFS\]\s*(\{[^\n\r]*\})/);
    if (!m) return {};
    try { var p = JSON.parse(m[1]); return p && typeof p === "object" && !Array.isArray(p) ? p : {}; } catch (_) { return {}; }
  }

  function writePrefs(notes, key, pref) {
    var current = String(notes || ""), prefs = parsePrefs(current), previous = prefs[key] && typeof prefs[key] === "object" ? prefs[key] : {};
    prefs[key] = {
      condition: normalizeCondition(pref.condition !== undefined ? pref.condition : previous.condition),
      boutique: pref.boutique !== undefined ? pref.boutique !== false : previous.boutique !== false,
      boutiquePrice: pref.boutiquePrice !== undefined ? price(pref.boutiquePrice) : price(previous.boutiquePrice),
      stockBase: pref.stockBase !== undefined ? nonNegativeInt(pref.stockBase) : nonNegativeInt(previous.stockBase),
      shippingWeightGrams: pref.shippingWeightGrams !== undefined ? positiveWeight(pref.shippingWeightGrams) : positiveWeight(previous.shippingWeightGrams),
      removed: pref.removed !== undefined ? pref.removed === true : previous.removed === true
    };
    var base = current.replace(/\n?\[STOCK_PREFS\]\s*\{[^\n\r]*\}/g, "").replace(/\s+$/, "");
    var line = STOCK_PREFS_TAG + " " + JSON.stringify(prefs);
    return base ? base + "\n" + line : line;
  }

  function conditionOptions(item) {
    if (item.packaging !== "carte_unite" && item.packaging !== "lot_cartes") return '<option value="">Scellé</option>';
    var labels = { "":"Non renseigné", M:"Mint", NM:"Near Mint", EX:"Excellent", GD:"Good", LP:"Light Played", PL:"Played", PO:"Poor" };
    return conditions.map(function (c) { return '<option value="'+c+'"'+(normalizeCondition(item.conditionCode)===c?' selected':'')+'>'+labels[c]+'</option>'; }).join("");
  }

  function statusLabel(item) {
    if (item.stockRemoved) return '<span class="admin-badge admin-badge--danger">Retiré du stock</span>';
    if (item.inventoryStatus === "catalog_link_required") return '<span class="admin-badge admin-badge--warn">Lien catalogue requis</span>';
    if (item.inventoryStatus === "catalog_price_required") return '<span class="admin-badge admin-badge--warn">Prix catalogue indisponible</span>';
    if (Number(item.oversoldStock || 0) > 0) return '<span class="admin-badge admin-badge--danger">SURVENTE</span>';
    if (Number(item.refundHoldStock || 0) > 0) return '<span class="admin-badge admin-badge--warn">Stock bloqué — remboursement en attente</span>';
    if (Number(item.pendingStock || 0) > 0) return '<span class="admin-badge admin-badge--gold">Réservé</span>';
    if (item.inventoryStatus === "low_stock" || (Number(item.stock || 0) > 0 && Number(item.stock || 0) <= lowStockThreshold)) return '<span class="admin-badge admin-badge--warn">Stock faible</span>';
    if (Number(item.stock || 0) <= 0) return '<span class="admin-badge admin-badge--danger">Épuisé</span>';
    return '<span class="admin-badge admin-badge--ok">Disponible</span>';
  }

  function queuePreferenceSave(item, patch, statusText) {
    saveQueue = saveQueue.then(function () {
      return persistPrefsNow(item, patch, statusText);
    }).catch(function () {});
    return saveQueue;
  }

  async function persistPrefsNow(item, patch, statusText) {
    var row = document.querySelector('[data-stock-row="' + CSS.escape(item.key) + '"]');
    if (!row) return;
    var msg = row.querySelector("[data-save-status]");
    if (msg) msg.textContent = statusText || "Enregistrement...";
    try {
      for (var i = 0; i < (item.purchaseIds || []).length; i++) {
        var id = item.purchaseIds[i], purchase = purchasesById[id];
        if (!purchase) continue;
        var notes = writePrefs(purchase.notes, item.key, patch);
        var d = await A.adminFetch("/api/admin/stock/preferences/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify({ notes: notes }) });
        if (!d || !d.ok) throw new Error(d && d.error || "Enregistrement impossible");
        purchasesById[id] = d.purchase || Object.assign({}, purchase, { notes: notes });
      }
      if (msg) msg.textContent = "Enregistré";
      await load();
    } catch (e) {
      if (msg) msg.textContent = e && e.message ? e.message : "Erreur d'enregistrement";
      console.error("[stock] preference save failed", e);
    }
  }

  async function savePreference(item) {
    var row = document.querySelector('[data-stock-row="' + CSS.escape(item.key) + '"]');
    if (!row) return;
    var condition = row.querySelector("[data-condition]")?.value || "";
    var boutique = row.querySelector("[data-boutique]")?.value !== "no";
    var boutiquePrice = row.querySelector("[data-price]")?.value || "";
    var shippingWeightGrams = row.querySelector("[data-weight]")?.value || "";
    if (shippingWeightGrams !== "" && positiveWeight(shippingWeightGrams) === null) {
      var weightMessage = row.querySelector("[data-save-status]");
      if (weightMessage) weightMessage.textContent = "Poids invalide : entier entre 1 et 30 000 g.";
      window.alert("Poids invalide. Saisissez un nombre entier entre 1 et 30 000 g, ou laissez vide si le poids est inconnu.");
      return;
    }
    if ((item.packaging === "carte_unite" || item.packaging === "lot_cartes") && boutiquePrice !== "" && Number(boutiquePrice) > 0 && Number(boutiquePrice) < 1) {
      boutiquePrice = "1.00";
      var priceInput = row.querySelector("[data-price]");
      if (priceInput) priceInput.value = boutiquePrice;
    }
    await queuePreferenceSave(item, { condition: condition, boutique: boutique, boutiquePrice: boutiquePrice, shippingWeightGrams: shippingWeightGrams }, "Enregistrement...");
  }

  function desiredBaseFromAvailable(item, desiredAvailable) {
    var committed = Number(item.committedStock || 0);
    var newBase = committed + desiredAvailable;
    if (newBase > maxStockBase) return null;
    return newBase;
  }

  async function changeQuantity(item) {
    var currentAvailable = Number(item.stock || 0);
    var raw = window.prompt("Nouvelle quantité disponible pour « " + item.name + " » :", String(currentAvailable));
    if (raw === null) return;
    var desiredAvailable = nonNegativeInt(String(raw).trim());
    if (desiredAvailable === null) {
      window.alert("Quantité invalide. Saisissez un nombre entier supérieur ou égal à 0.");
      return;
    }
    var newBase = desiredBaseFromAvailable(item, desiredAvailable);
    if (newBase === null) {
      window.alert("Quantité trop élevée. Maximum autorisé : " + maxStockBase + ".");
      return;
    }
    await queuePreferenceSave(item, { stockBase: newBase, removed: false }, "Mise à jour du stock...");
  }

  async function removeFromStock(item) {
    var committed = Number(item.committedStock || 0);
    var ok = window.confirm("Retirer « " + item.name + " » du stock Boutique ?\n\nLa quantité disponible passera à 0. L'historique d'achat, les ventes et les écritures comptables seront conservés.");
    if (!ok) return;
    await queuePreferenceSave(item, { stockBase: committed, removed: true, boutique: false }, "Retrait du stock...");
  }

  async function restoreToStock(item) {
    var raw = window.prompt("Quantité disponible à remettre en stock pour « " + item.name + " » :", "1");
    if (raw === null) return;
    var desiredAvailable = nonNegativeInt(String(raw).trim());
    if (desiredAvailable === null) {
      window.alert("Quantité invalide. Saisissez un nombre entier supérieur ou égal à 0.");
      return;
    }
    var newBase = desiredBaseFromAvailable(item, desiredAvailable);
    if (newBase === null) {
      window.alert("Quantité trop élevée. Maximum autorisé : " + maxStockBase + ".");
      return;
    }
    await queuePreferenceSave(item, { stockBase: newBase, removed: false, boutique: true }, "Remise en stock...");
  }

  function matchesFilter(item) {
    if (stockFilter === "available") return Number(item.stock || 0) > 0 && Number(item.oversoldStock || 0) === 0 && item.boutiqueEnabled !== false && !item.stockRemoved;
    if (stockFilter === "low") return item.alertBucket === "low" || item.inventoryStatus === "low_stock";
    if (stockFilter === "out") return item.alertBucket === "out" || item.inventoryStatus === "out_of_stock";
    if (stockFilter === "reserved") return Number(item.pendingStock || 0) > 0;
    if (stockFilter === "oversold") return Number(item.oversoldStock || 0) > 0;
    if (stockFilter === "removed") return item.stockRemoved === true || item.boutiqueEnabled === false;
    if (stockFilter === "missing_weight") return item.boutiqueEnabled !== false && !item.stockRemoved && item.shippingWeightKnown !== true;
    if (stockFilter === "weighted") return item.boutiqueEnabled !== false && !item.stockRemoved && item.shippingWeightKnown === true;
    return true;
  }

  function matchesSearch(item) {
    var q = String(stockQuery || "").trim().toLowerCase();
    if (!q) return true;
    var hay = [item.name, item.key, item.cardId, item.extension, item.number, item.number ? "#" + item.number : ""].join(" ").toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function stockBreakdown(item) {
    var lack = Number(item.oversoldStock || 0);
    return "Base " + Number(item.effectiveBaseStock || item.baseStock || 0) +
      " · réservé " + Number(item.pendingStock || 0) +
      " · vendu " + Number(item.soldStock || 0) +
      " · remboursement " + Number(item.refundHoldStock || 0) +
      (lack ? " · manque " + lack : "");
  }

  function render(inventory, totals) {
    lastInventory = inventory || [];
    lastTotals = totals || {};
    inventoryByKey = Object.create(null);
    lastInventory.forEach(function (i) { inventoryByKey[i.key] = i; });
    var visible = lastInventory.filter(function (i) { return matchesFilter(i) && matchesSearch(i); });
    A.qs("#stockUnits").textContent = String(totals.availableStock || 0);
    A.qs("#stockAvailableProducts").textContent = String(totals.availableProducts || 0);
    A.qs("#stockLow").textContent = String(totals.lowStockProducts || totals.lowStock || 0);
    A.qs("#stockOut").textContent = String(totals.outOfStockProducts || totals.outOfStock || 0);
    A.qs("#stockOversold").textContent = String(totals.oversoldProducts || 0);
    A.qs("#stockValue").textContent = euro(totals.stockValue != null ? totals.stockValue : inventory.reduce(function (s, i) { return s + Number(i.stock || 0) * Number(i.averagePurchaseCost || 0); }, 0));
    A.qs("#stockWeighted").textContent = String(totals.weightedProducts || 0) + " / " + String(totals.activeProductsForWeight || 0);
    A.qs("#stockMissingWeight").textContent = String(totals.missingWeightProducts || 0);
    A.qs("#stockWeightCoverage").textContent = String(totals.weightCoveragePercent == null ? 100 : totals.weightCoveragePercent) + " %";
    if (A.qs("#stockLowThresholdLabel")) A.qs("#stockLowThresholdLabel").textContent = String(lowStockThreshold);

    var summary = A.qs("#stockSummary");
    if (summary) summary.innerHTML = "Acheté : <strong>" + Number(totals.baseStock || 0) + "</strong> · Disponible : <strong>" + Number(totals.availableStock || 0) + "</strong> · Réservé paiement : <strong>" + Number(totals.pendingStock || 0) + "</strong> · Vendu/payé : <strong>" + Number(totals.soldStock || 0) + "</strong> · En remboursement : <strong>" + Number(totals.refundHoldStock || 0) + "</strong>" + (Number(totals.oversoldStock || 0) ? " · <strong style='color:#ff8f8f'>Survente : " + Number(totals.oversoldStock) + "</strong>" : "") + " · Rupture : <strong>" + Number(totals.outOfStockProducts || totals.outOfStock || 0) + "</strong> · Stock faible : <strong>" + Number(totals.lowStockProducts || totals.lowStock || 0) + "</strong> · Poids renseignés : <strong>" + Number(totals.weightedProducts || 0) + "/" + Number(totals.activeProductsForWeight || 0) + "</strong> · Poids manquants : <strong>" + Number(totals.missingWeightProducts || 0) + "</strong> · Couverture poids : <strong>" + Number(totals.weightCoveragePercent == null ? 100 : totals.weightCoveragePercent) + " %</strong>";

    A.qs("#stockRows").innerHTML = visible.map(function (i) {
      var actions = i.stockRemoved
        ? '<button type="button" class="admin-btn admin-btn--small" data-restore-stock>Remettre</button>'
        : '<button type="button" class="admin-btn admin-btn--small" data-edit-stock>Modifier</button> <button type="button" class="admin-btn admin-btn--small admin-btn--danger" data-remove-stock>Supprimer</button>';
      var lastChange = i.latestPurchaseAt ? '<br><small>Dernier achat : ' + esc(i.latestPurchaseAt) + '</small>' : '';
      var weightKnown = i.shippingWeightKnown === true || positiveWeight(i.shippingWeightGrams) !== null;
      var weightBadge = weightKnown
        ? '<span class="admin-badge admin-badge--ok">Poids renseigné</span>'
        : '<span class="admin-badge admin-badge--warn">Poids à renseigner</span>';
      return '<tr data-stock-row="'+esc(i.key)+'"><td><small>'+esc(i.cardId || i.key)+'</small></td><td><strong>'+esc(i.name)+'</strong><br><small>'+esc([i.extension,i.number?"#"+i.number:""].filter(Boolean).join(" · "))+'</small></td><td>'+esc(i.categoryLabel || i.packaging)+'</td><td><select data-condition '+((i.packaging!=="carte_unite"&&i.packaging!=="lot_cartes")?'disabled':'')+'>'+conditionOptions(i)+'</select></td><td>'+euro(i.averagePurchaseCost)+'</td><td><input data-price type="number" min="'+((i.packaging==="carte_unite"||i.packaging==="lot_cartes")?"1":"0.01")+'" step="0.01" value="'+(i.boutiquePrice ? Number(i.boutiquePrice).toFixed(2) : '')+'" placeholder="'+(i.catalogPrice ? Number(i.catalogPrice).toFixed(2) : 'Prix requis')+'"><br><small>'+(i.boutiquePrice?'Prix Admin':i.catalogPrice?'Auto Cardoria '+euro(i.catalogPrice):'Prix catalogue indisponible')+'</small></td><td><input data-weight type="number" min="1" max="30000" step="1" value="'+(i.shippingWeightGrams ? String(i.shippingWeightGrams) : '')+'" placeholder="g" aria-label="Poids unitaire d’expédition en grammes"><br><small>Poids unitaire d’expédition</small><br>'+weightBadge+'</td><td><strong>'+Number(i.stock||0)+'</strong> dispo<br><small>'+esc(stockBreakdown(i))+'</small><br>'+statusLabel(i)+lastChange+'<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">'+actions+'</div></td><td><select data-boutique '+(i.stockRemoved?'disabled':'')+'><option value="yes"'+(i.boutiqueEnabled?' selected':'')+'>Oui</option><option value="no"'+(!i.boutiqueEnabled?' selected':'')+'>Non</option></select></td><td>Achats payés<br><small data-save-status></small></td></tr>';
    }).join("") || '<tr><td colspan="10">'+(stockFilter==="all" && !stockQuery ? "Aucun stock Boutique." : "Aucun produit dans ce filtre.")+'</td></tr>';

    A.qs("#stockRows").querySelectorAll("tr[data-stock-row]").forEach(function (row) {
      var item = inventoryByKey[row.getAttribute("data-stock-row")];
      row.querySelectorAll("select[data-condition],select[data-boutique],input[data-price],input[data-weight]").forEach(function (control) { control.addEventListener("change", function () { savePreference(item); }); });
      row.querySelector("[data-edit-stock]")?.addEventListener("click", function () { changeQuantity(item); });
      row.querySelector("[data-remove-stock]")?.addEventListener("click", function () { removeFromStock(item); });
      row.querySelector("[data-restore-stock]")?.addEventListener("click", function () { restoreToStock(item); });
    });
  }

  async function load() {
    var results = await Promise.all([
      A.adminFetch("/api/admin/accounting/purchases", { cache: "no-store" }),
      A.adminFetch("/api/admin/payments/boutique-inventory", { cache: "no-store" })
    ]);
    var p = results[0], inv = results[1];
    if (!p || !p.ok) throw new Error(p && p.error || "Achats indisponibles");
    if (!inv || !inv.ok) throw new Error(inv && inv.error || "Stock Boutique indisponible");
    if (Number.isFinite(Number(inv.lowStockThreshold))) lowStockThreshold = Number(inv.lowStockThreshold);
    if (Number.isFinite(Number(inv.maxStockBase))) maxStockBase = Number(inv.maxStockBase);

    var missingPriceIds = Array.from(new Set((inv.inventory || []).filter(function (item) {
      return item.cardId && !item.boutiquePrice && Number(item.catalogPrice || 0) <= 0;
    }).map(function (item) { return item.cardId; })));

    if (missingPriceIds.length) {
      try {
        var refreshed = await A.adminFetch("/api/admin/engine/market-prices/visible", {
          method: "POST",
          body: JSON.stringify({ ids: missingPriceIds })
        });
        if (refreshed && refreshed.ok) {
          var updatedInventory = await A.adminFetch("/api/admin/payments/boutique-inventory", { cache: "no-store" });
          if (updatedInventory && updatedInventory.ok) inv = updatedInventory;
        }
      } catch (e) {
        console.warn("[stock] actualisation automatique des prix indisponible", e);
      }
    }

    purchasesById = Object.create(null);
    (p.purchases || []).forEach(function (purchase) { purchasesById[purchase.id] = purchase; });
    render(inv.inventory || [], inv.totals || {});
  }

  A.renderShell("stock", "Stock Boutique", "Source unique : achats Pokémon payés moins réservations, ventes et remboursements",
    '<div class="admin-kpi-grid" style="margin-bottom:16px">' +
      '<div class="admin-kpi"><label>Total unités disponibles</label><strong id="stockUnits">0</strong></div>' +
      '<div class="admin-kpi"><label>Produits disponibles</label><strong id="stockAvailableProducts">0</strong></div>' +
      '<div class="admin-kpi"><label>Produits stock faible</label><strong id="stockLow">0</strong></div>' +
      '<div class="admin-kpi"><label>Produits en rupture</label><strong id="stockOut">0</strong></div>' +
      '<div class="admin-kpi"><label>Produits en survente</label><strong id="stockOversold">0</strong></div>' +
      '<div class="admin-kpi"><label>Valeur du stock</label><strong id="stockValue">0,00 €</strong></div>' +
      '<div class="admin-kpi"><label>Poids renseignés</label><strong id="stockWeighted">0 / 0</strong></div>' +
      '<div class="admin-kpi"><label>Poids manquants</label><strong id="stockMissingWeight">0</strong></div>' +
      '<div class="admin-kpi"><label>Couverture poids</label><strong id="stockWeightCoverage">100 %</strong></div>' +
    '</div>' +
    '<div class="admin-panel"><p id="stockSummary" class="small">Chargement...</p>' +
    '<div class="admin-filters" style="margin:12px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
      '<button type="button" class="btn btn-secondary" data-stock-filter="all">Tous</button>' +
      '<button type="button" class="btn btn-secondary" data-stock-filter="available">Disponible</button>' +
      '<button type="button" class="btn btn-secondary" data-stock-filter="low">Stock faible</button>' +
      '<button type="button" class="btn btn-secondary" data-stock-filter="out">Rupture</button>' +
      '<button type="button" class="btn btn-secondary" data-stock-filter="reserved">Réservé</button>' +
      '<button type="button" class="btn btn-secondary" data-stock-filter="oversold">Survente</button>' +
      '<button type="button" class="btn btn-secondary" data-stock-filter="removed">Retiré de la Boutique</button>' +
      '<button type="button" class="btn btn-secondary" data-stock-filter="missing_weight">Poids manquant</button>' +
      '<button type="button" class="btn btn-secondary" data-stock-filter="weighted">Poids renseigné</button>' +
      '<input id="stockSearch" type="search" placeholder="Nom, référence, extension, numéro" style="min-width:220px;flex:1">' +
    '</div>' +
    '<p class="small">Les cartes liées au catalogue récupèrent automatiquement leur tarif de référence Cardoria. Vous pouvez toujours saisir un prix Admin pour le remplacer. Modifier la quantité change le stock de base pour obtenir la disponibilité voulue, sans écraser les ventes déjà commises. Le retrait conserve l’historique d’achat, les ventes et la comptabilité. Le poids correspond au poids unitaire d’expédition du produit en grammes. Il n’est jamais inventé : s’il manque, la commande reste enregistrable mais une étiquette Colissimo ne pourra pas être créée sans poids réel. Seuil stock faible : <span id="stockLowThresholdLabel">2</span> unités.</p>' +
    '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Réf.</th><th>Nom</th><th>Catégorie</th><th>État</th><th>Prix achat moy.</th><th>Prix Boutique</th><th>Poids (g)</th><th>Stock réel / actions</th><th>Boutique</th><th>Source</th></tr></thead><tbody id="stockRows"></tbody></table></div></div>');

  document.querySelectorAll("[data-stock-filter]").forEach(function (button) {
    button.addEventListener("click", function () {
      stockFilter = button.getAttribute("data-stock-filter") || "all";
      render(lastInventory, lastTotals);
    });
  });
  A.qs("#stockSearch")?.addEventListener("input", function (event) {
    stockQuery = event.target.value || "";
    render(lastInventory, lastTotals);
  });

  load().catch(function (e) { A.qs("#stockRows").innerHTML = '<tr><td colspan="10">Chargement du stock impossible.</td></tr>'; console.error("[stock] load failed", e); });
})();
