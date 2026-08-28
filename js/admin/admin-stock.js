(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A || !A.protectAdmin()) return;

  var STOCK_PREFS_TAG = "[STOCK_PREFS]";
  var purchasesById = Object.create(null);
  var inventoryByKey = Object.create(null);
  var conditions = ["", "M", "NM", "EX", "GD", "LP", "PL", "PO"];

  function esc(v) { return String(v == null ? "" : v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;"); }
  function euro(v) { return Number(v || 0).toFixed(2).replace(".", ",") + " €"; }
  function price(v) { var n = Number(String(v == null ? "" : v).replace(",", ".")); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; }
  function normalizeCondition(v) { var u = String(v || "").trim().toUpperCase(); return conditions.indexOf(u) >= 0 ? u : ""; }

  function parsePrefs(notes) {
    var m = String(notes || "").match(/\[STOCK_PREFS\]\s*(\{[^\n\r]*\})/);
    if (!m) return {};
    try { var p = JSON.parse(m[1]); return p && typeof p === "object" && !Array.isArray(p) ? p : {}; } catch (_) { return {}; }
  }

  function writePrefs(notes, key, pref) {
    var current = String(notes || ""), prefs = parsePrefs(current);
    prefs[key] = { condition: normalizeCondition(pref.condition), boutique: pref.boutique !== false, boutiquePrice: price(pref.boutiquePrice) };
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
    if (Number(item.oversoldStock || 0) > 0) return '<span class="admin-badge admin-badge--danger">SURVENTE</span>';
    if (Number(item.refundHoldStock || 0) > 0) return '<span class="admin-badge admin-badge--warn">Remboursement</span>';
    if (Number(item.pendingStock || 0) > 0) return '<span class="admin-badge admin-badge--gold">Réservé</span>';
    if (Number(item.stock || 0) <= 0) return '<span class="admin-badge">Épuisé</span>';
    return '<span class="admin-badge admin-badge--ok">Disponible</span>';
  }

  async function savePreference(item) {
    var row = document.querySelector('[data-stock-row="' + CSS.escape(item.key) + '"]');
    if (!row) return;
    var condition = row.querySelector("[data-condition]")?.value || "";
    var boutique = row.querySelector("[data-boutique]")?.value !== "no";
    var boutiquePrice = row.querySelector("[data-price]")?.value || "";
    var msg = row.querySelector("[data-save-status]");
    if (msg) msg.textContent = "Enregistrement...";
    try {
      for (var i = 0; i < (item.purchaseIds || []).length; i++) {
        var id = item.purchaseIds[i], purchase = purchasesById[id];
        if (!purchase) continue;
        var body = Object.assign({}, purchase, { notes: writePrefs(purchase.notes, item.key, { condition: condition, boutique: boutique, boutiquePrice: boutiquePrice }) });
        var d = await A.adminFetch("/api/admin/accounting/purchases/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(body) });
        if (!d || !d.ok) throw new Error(d && d.error || "Enregistrement impossible");
        purchasesById[id] = d.purchase || body;
      }
      if (msg) msg.textContent = "Enregistré";
      await load();
    } catch (e) { if (msg) msg.textContent = e.message || "Erreur"; }
  }

  function render(inventory, totals) {
    inventoryByKey = Object.create(null);
    inventory.forEach(function (i) { inventoryByKey[i.key] = i; });
    A.qs("#stockUnits").textContent = String(totals.availableStock || 0);
    A.qs("#stockValue").textContent = euro(inventory.reduce(function (s, i) { return s + Number(i.stock || 0) * Number(i.averagePurchaseCost || 0); }, 0));
    A.qs("#stockLinked").textContent = String(inventory.filter(function (i) { return !!i.cardId; }).length) + " / " + inventory.length;
    A.qs("#stockBoutique").textContent = String(inventory.filter(function (i) { return i.boutiqueEnabled; }).length) + " / " + inventory.length;

    var summary = A.qs("#stockSummary");
    if (summary) summary.innerHTML = "Acheté : <strong>" + Number(totals.baseStock || 0) + "</strong> · Disponible : <strong>" + Number(totals.availableStock || 0) + "</strong> · Réservé paiement : <strong>" + Number(totals.pendingStock || 0) + "</strong> · Vendu/payé : <strong>" + Number(totals.soldStock || 0) + "</strong> · En remboursement : <strong>" + Number(totals.refundHoldStock || 0) + "</strong>" + (Number(totals.oversoldStock || 0) ? " · <strong style='color:#ff8f8f'>Survente : " + Number(totals.oversoldStock) + "</strong>" : "");

    A.qs("#stockRows").innerHTML = inventory.map(function (i) {
      return '<tr data-stock-row="'+esc(i.key)+'"><td><small>'+esc(i.cardId || i.key)+'</small></td><td><strong>'+esc(i.name)+'</strong><br><small>'+esc([i.extension,i.number?"#"+i.number:""].filter(Boolean).join(" · "))+'</small></td><td>'+esc(i.categoryLabel || i.packaging)+'</td><td><select data-condition '+((i.packaging!=="carte_unite"&&i.packaging!=="lot_cartes")?'disabled':'')+'>'+conditionOptions(i)+'</select></td><td>'+euro(i.averagePurchaseCost)+'</td><td><input data-price type="number" min="0" step="0.01" value="'+(i.boutiquePrice ? Number(i.boutiquePrice).toFixed(2) : '')+'" placeholder="'+(i.catalogPrice ? Number(i.catalogPrice).toFixed(2) : 'Prix requis')+'"><br><small>'+(i.boutiquePrice?'Prix Admin':i.catalogPrice?'Auto Cardoria '+euro(i.catalogPrice):'Prix requis')+'</small></td><td><strong>'+Number(i.stock||0)+'</strong> dispo<br><small>'+Number(i.pendingStock||0)+' réservé · '+Number(i.soldStock||0)+' vendu'+(Number(i.refundHoldStock||0)?' · '+Number(i.refundHoldStock)+' remboursement':'')+'</small><br>'+statusLabel(i)+'</td><td><select data-boutique><option value="yes"'+(i.boutiqueEnabled?' selected':'')+'>Oui</option><option value="no"'+(!i.boutiqueEnabled?' selected':'')+'>Non</option></select></td><td>Achats payés<br><small data-save-status></small></td></tr>';
    }).join("") || '<tr><td colspan="9">Aucun stock Boutique.</td></tr>';

    A.qs("#stockRows").querySelectorAll("tr[data-stock-row]").forEach(function (row) {
      var item = inventoryByKey[row.getAttribute("data-stock-row")];
      row.querySelectorAll("select,input").forEach(function (control) { control.addEventListener("change", function () { savePreference(item); }); });
    });
  }

  async function load() {
    var results = await Promise.all([
      A.adminFetch("/api/admin/accounting/purchases", { cache: "no-store" }),
      A.adminFetch("/api/admin/payments/boutique-inventory", { cache: "no-store" })
    ]);
    var p = results[0], inv = results[1];
    if (!p.ok) throw new Error(p.error || "Achats indisponibles");
    if (!inv.ok) throw new Error(inv.error || "Stock Boutique indisponible");
    purchasesById = Object.create(null);
    (p.purchases || []).forEach(function (purchase) { purchasesById[purchase.id] = purchase; });
    render(inv.inventory || [], inv.totals || {});
  }

  A.renderShell("stock", "Stock Boutique", "Source unique : achats Pokémon payés moins réservations, ventes et remboursements",
    '<div class="admin-kpi-grid" style="margin-bottom:16px"><div class="admin-kpi"><label>Stock disponible</label><strong id="stockUnits">0</strong></div><div class="admin-kpi"><label>Valeur achat disponible</label><strong id="stockValue">0,00 €</strong></div><div class="admin-kpi"><label>Lié catalogue</label><strong id="stockLinked">0 / 0</strong></div><div class="admin-kpi"><label>Dans Boutique</label><strong id="stockBoutique">0 / 0</strong></div></div>' +
    '<div class="admin-panel"><p id="stockSummary" class="small">Chargement...</p><p class="small">Une commande en attente réserve le stock pendant 30 minutes. Une commande payée retire le stock disponible. Une commande payée annulée garde le stock bloqué jusqu’au remboursement SumUp confirmé, puis le stock revient automatiquement.</p><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Réf.</th><th>Nom</th><th>Catégorie</th><th>État</th><th>Prix achat moy.</th><th>Prix Boutique</th><th>Stock réel</th><th>Boutique</th><th>Source</th></tr></thead><tbody id="stockRows"></tbody></table></div></div>');

  load().catch(function (e) { A.qs("#stockRows").innerHTML = '<tr><td colspan="9">'+esc(e.message || "Chargement impossible")+'</td></tr>'; });
})();
