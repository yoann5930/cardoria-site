(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A || !A.protectAdmin()) return;

  var state = { period: "month", source: "", saleStatus: "paid", purchaseStatus: "paid", buyer: "", q: "" };

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]; }); }
  function badge(status) {
    var cls = status === "paid" ? "admin-badge--ok" : status === "refunded" || status === "pending" ? "admin-badge--warn" : status === "failed" || status === "cancelled" ? "admin-badge--danger" : "";
    var labels = { paid: "Payé", pending: "En attente", refunded: "Remboursé", failed: "Échoué", cancelled: "Annulé", other: "Autre" };
    return '<span class="admin-badge ' + cls + '">' + esc(labels[status] || status || "—") + "</span>";
  }
  function buyerLabel(v) { v = String(v || "").toLowerCase(); return v === "yoann" ? "Yoann" : v === "valentin" ? "Valentin" : "Non attribué"; }
  function typeLabel(v) { return v === "consumable" ? "Consommable" : v === "equipment" ? "Matériel" : v === "pokemon_card" ? "Carte Pokémon" : "Ancien achat"; }

  function setText(id, value) { var el = A.qs("#" + id); if (el) el.textContent = value; }

  function renderSummary(s) {
    s = s || {};
    setText("finRevenue", A.euro(s.cardoriaRevenue || 0));
    setText("finBoutique", A.euro(s.boutiqueRevenue || 0));
    setText("finBoutiqueCount", (s.boutiqueSales || 0) + " vente(s)");
    setText("finMarketplaceCommission", A.euro(s.marketplaceCommission || 0));
    setText("finMarketplaceGmv", "GMV : " + A.euro(s.marketplaceGmv || 0));
    setText("finPurchases", A.euro(s.paidPurchaseSpend || 0));
    setText("finPurchaseCount", (s.paidPurchaseCount || 0) + " achat(s) payé(s)");
    setText("finMargin", A.euro(s.commercialMargin || 0));
    setText("finCogs", "Coût articles vendus : " + A.euro(s.boutiqueCogs || 0));
    setText("finCash", A.euro(s.cashCommercialBalance || 0));
    setText("finRefunds", A.euro(s.refundAmount || 0));
    setText("finRefundCount", (s.refundedSales || 0) + " remboursement(s)");
    setText("finStockCost", A.euro(s.stockPurchaseValue || 0));
    setText("finStockRetail", "Valeur vente : " + A.euro(s.stockRetailValue || 0));
    setText("finStockUnits", (s.stockAvailableUnits || 0) + " unité(s) disponibles");
    setText("finPendingPurchases", A.euro(s.pendingPurchaseSpend || 0));
    setText("finPendingPurchaseCount", (s.pendingPurchaseCount || 0) + " achat(s) en attente");

    var byBuyer = s.byBuyer || {};
    A.qs("#buyerSummary").innerHTML = '<div><strong>Yoann</strong><br>' + A.euro(byBuyer.yoann || 0) + '</div>' +
      '<div><strong>Valentin</strong><br>' + A.euro(byBuyer.valentin || 0) + '</div>' +
      '<div><strong>Non attribué</strong><br>' + A.euro(byBuyer.non_attribue || 0) + '</div>';

    var categories = Object.entries(s.byPurchaseCategory || {});
    A.qs("#purchaseCategorySummary").innerHTML = categories.map(function (entry) {
      return '<tr><td>' + esc(entry[0]) + '</td><td><strong>' + A.euro(entry[1]) + '</strong></td></tr>';
    }).join("") || "<tr><td colspan='2'>Aucun achat payé sur la période.</td></tr>";

    A.qs("#financeNotes").innerHTML = '<p><strong>CA Cardoria :</strong> ' + esc(s.notes && s.notes.cardoriaRevenue || "") + '</p>' +
      '<p><strong>GMV Marketplace :</strong> ' + esc(s.notes && s.notes.marketplaceGmv || "") + '</p>' +
      '<p><strong>Marge commerciale :</strong> ' + esc(s.notes && s.notes.commercialMargin || "") + '</p>' +
      '<p><strong>Solde commercial :</strong> ' + esc(s.notes && s.notes.cashCommercialBalance || "") + '</p>';
  }

  function renderSales(rows) {
    A.qs("#salesBody").innerHTML = (rows || []).map(function (s) {
      return "<tr>" +
        "<td><strong>" + esc(s.id) + "</strong><br><small>" + esc(s.paymentReference || "—") + "</small></td>" +
        "<td>" + (s.date ? new Date(s.date).toLocaleString("fr-FR") : "—") + "</td>" +
        "<td>" + esc(s.sourceLabel || s.source) + "<br><small>" + esc(s.provider || "—") + "</small></td>" +
        "<td>" + esc(s.client || "—") + "<br><small>" + esc(s.email || "—") + "</small></td>" +
        "<td>" + A.euro(s.grossAmount || 0) + "</td>" +
        "<td><strong>" + A.euro(s.cardoriaRevenue || 0) + "</strong></td>" +
        "<td>" + (s.source === "marketplace" ? A.euro(s.platformFee || 0) : "—") + "</td>" +
        "<td>" + badge(s.status) + "<br><small>" + esc(s.orderStatus || "—") + "</small></td></tr>";
    }).join("") || "<tr><td colspan='8'>Aucune vente pour ces filtres.</td></tr>";
  }

  function renderPurchases(rows) {
    A.qs("#purchasesBody").innerHTML = (rows || []).map(function (p) {
      return "<tr>" +
        "<td><strong>" + esc(p.id) + "</strong><br><small>" + esc(p.reference || "—") + "</small></td>" +
        "<td>" + esc(p.date || (p.createdAt || "").slice(0, 10)) + "</td>" +
        "<td>" + esc(buyerLabel(p.buyer)) + "</td>" +
        "<td>" + esc(typeLabel(p.purchaseType)) + "<br><small>" + esc(p.category || "—") + "</small></td>" +
        "<td>" + esc(p.seller || "—") + "</td>" +
        "<td>" + esc(p.description || "—") + "</td>" +
        "<td>" + Number(p.quantity || 1) + "</td>" +
        "<td><strong>" + A.euro(p.amount || 0) + "</strong><br><small>" + (p.unitPrice == null ? "—" : A.euro(p.unitPrice) + " / carte") + "</small></td>" +
        "<td>" + badge(p.accountingStatus) + "</td></tr>";
    }).join("") || "<tr><td colspan='9'>Aucun achat pour ces filtres.</td></tr>";
  }

  function queryString(kind) {
    var params = new URLSearchParams();
    params.set("period", state.period);
    if (state.q) params.set("q", state.q);
    if (kind === "sales") {
      if (state.source) params.set("source", state.source);
      if (state.saleStatus) params.set("status", state.saleStatus);
    } else {
      if (state.purchaseStatus) params.set("status", state.purchaseStatus);
      if (state.buyer) params.set("buyer", state.buyer);
    }
    return params.toString();
  }

  function loadAll() {
    Promise.all([
      A.adminFetch("/api/admin/accounting/summary?period=" + encodeURIComponent(state.period)),
      A.adminFetch("/api/admin/accounting/sales?" + queryString("sales")),
      A.adminFetch("/api/admin/accounting/purchases?" + queryString("purchases"))
    ]).then(function (results) {
      if (results[0].ok) renderSummary(results[0].summary);
      if (results[1].ok) renderSales(results[1].sales);
      if (results[2].ok) renderPurchases(results[2].purchases);
    }).catch(function () { alert("Impossible de charger la comptabilité."); });
  }

  async function exportCsv(type) {
    try {
      var token = sessionStorage.getItem("cardoria_session_token") || "";
      var params = new URLSearchParams();
      params.set("type", type);
      params.set("period", state.period);
      if (type === "sales") { if (state.source) params.set("source", state.source); if (state.saleStatus) params.set("status", state.saleStatus); }
      if (type === "purchases") { if (state.purchaseStatus) params.set("status", state.purchaseStatus); if (state.buyer) params.set("buyer", state.buyer); }
      if (state.q && type !== "summary") params.set("q", state.q);
      var res = await fetch(A.BACKEND + "/api/admin/accounting/export.csv?" + params.toString(), { headers: token ? { Authorization: "Bearer " + token } : {}, cache: "no-store" });
      if (!res.ok) throw new Error("Export impossible");
      var blob = await res.blob(), url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = "cardoria-comptabilite-" + type + "-" + state.period + ".csv"; document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) { alert(e.message || "Export impossible"); }
  }

  A.renderShell("accounting", "Comptabilité", "Vue financière Cardoria organisée à partir des ventes réellement payées et des achats réellement payés",
    '<div class="admin-periods" id="financePeriods"><button data-period="day">Jour</button><button data-period="week">Semaine</button><button data-period="month" class="active">Mois</button><button data-period="year">Année</button><button data-period="all">Tout</button></div>' +
    '<div class="admin-kpi-grid">' +
      '<div class="admin-kpi"><label>CA Cardoria</label><strong id="finRevenue">0,00 €</strong><small>Boutique + commissions Marketplace</small></div>' +
      '<div class="admin-kpi"><label>CA Boutique</label><strong id="finBoutique">0,00 €</strong><small id="finBoutiqueCount">0 vente</small></div>' +
      '<div class="admin-kpi"><label>Commission Marketplace</label><strong id="finMarketplaceCommission">0,00 €</strong><small id="finMarketplaceGmv">GMV : 0,00 €</small></div>' +
      '<div class="admin-kpi"><label>Achats Cardoria payés</label><strong id="finPurchases">0,00 €</strong><small id="finPurchaseCount">0 achat</small></div>' +
      '<div class="admin-kpi"><label>Marge commerciale</label><strong id="finMargin">0,00 €</strong><small id="finCogs">Coût articles vendus : 0,00 €</small></div>' +
      '<div class="admin-kpi"><label>Solde commercial trésorerie</label><strong id="finCash">0,00 €</strong><small>CA Cardoria - achats payés période</small></div>' +
      '<div class="admin-kpi"><label>Remboursements ventes</label><strong id="finRefunds">0,00 €</strong><small id="finRefundCount">0 remboursement</small></div>' +
      '<div class="admin-kpi"><label>Valeur achat stock disponible</label><strong id="finStockCost">0,00 €</strong><small id="finStockRetail">Valeur vente : 0,00 €</small><small id="finStockUnits">0 unité</small></div>' +
      '<div class="admin-kpi"><label>Achats en attente</label><strong id="finPendingPurchases">0,00 €</strong><small id="finPendingPurchaseCount">0 achat en attente</small></div>' +
    '</div>' +
    '<div class="admin-panel" id="financeNotes" style="border:1px solid rgba(212,175,55,.25)"></div>' +
    '<div class="admin-grid-2">' +
      '<div class="admin-panel"><h2>Achats payés par acheteur</h2><div id="buyerSummary" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px"></div></div>' +
      '<div class="admin-panel"><h2>Achats payés par catégorie</h2><div class="admin-table-wrap"><table class="admin-table"><tbody id="purchaseCategorySummary"></tbody></table></div></div>' +
    '</div>' +
    '<div class="admin-panel"><h2>Ventes / encaissements</h2>' +
      '<div class="admin-filters"><input id="financeSearch" placeholder="Commande, client, référence paiement..."><select id="financeSource"><option value="">Boutique + Marketplace</option><option value="boutique">Boutique</option><option value="marketplace">Marketplace</option></select><select id="saleStatus"><option value="paid">Payées</option><option value="">Tous statuts</option><option value="pending">En attente</option><option value="refunded">Remboursées</option><option value="failed">Échouées</option></select><button class="btn btn-primary" id="exportSales" type="button">Exporter ventes CSV</button><button class="btn btn-secondary" id="exportSummary" type="button">Exporter synthèse CSV</button></div>' +
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Commande / paiement</th><th>Date</th><th>Source</th><th>Client</th><th>Montant brut</th><th>Revenu Cardoria</th><th>Commission</th><th>Statut</th></tr></thead><tbody id="salesBody"></tbody></table></div>' +
    '</div>' +
    '<div class="admin-panel"><h2>Achats / dépenses Cardoria</h2>' +
      '<div class="admin-filters"><select id="purchaseStatus"><option value="paid">Payés</option><option value="">Tous statuts</option><option value="pending">En attente</option><option value="cancelled">Annulés</option><option value="refunded">Remboursés</option></select><select id="purchaseBuyer"><option value="">Tous acheteurs</option><option value="yoann">Yoann</option><option value="valentin">Valentin</option><option value="non_attribue">Non attribué</option></select><button class="btn btn-primary" id="exportPurchases" type="button">Exporter achats CSV</button></div>' +
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Achat / référence</th><th>Date</th><th>Acheteur</th><th>Type</th><th>Vendeur</th><th>Description</th><th>Qté</th><th>Montant</th><th>Statut</th></tr></thead><tbody id="purchasesBody"></tbody></table></div>' +
    '</div>');

  A.qs("#financePeriods").querySelectorAll("button").forEach(function (btn) {
    btn.onclick = function () {
      A.qs("#financePeriods").querySelectorAll("button").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active"); state.period = btn.dataset.period; loadAll();
    };
  });
  A.qs("#financeSearch").oninput = function () { state.q = this.value; loadAll(); };
  A.qs("#financeSource").onchange = function () { state.source = this.value; loadAll(); };
  A.qs("#saleStatus").onchange = function () { state.saleStatus = this.value; loadAll(); };
  A.qs("#purchaseStatus").onchange = function () { state.purchaseStatus = this.value; loadAll(); };
  A.qs("#purchaseBuyer").onchange = function () { state.buyer = this.value; loadAll(); };
  A.qs("#exportSales").onclick = function () { exportCsv("sales"); };
  A.qs("#exportPurchases").onclick = function () { exportCsv("purchases"); };
  A.qs("#exportSummary").onclick = function () { exportCsv("summary"); };
  loadAll();
})();
