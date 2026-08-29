(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function renderDashboard(d) {
    return "<div class='admin-kpi-grid'>" +
      "<div class='admin-kpi'><label>Transactions</label><strong>" + (d.transactions || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Cartes suivies</label><strong>" + (d.cardsTracked || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Tx 7 jours</label><strong>" + (d.transactionsLast7Days || 0) + "</strong></div>" +
      "<div class='admin-kpi'><label>Liquidité moy.</label><strong>" + (d.avgLiquidityIndex || 0) + "/100</strong></div>" +
      "</div>";
  }

  function renderStats(s) {
    if (!s) return "<p>Aucune statistique.</p>";
    var ev = s.evolution || {};
    var idx = s.indices || {};
    return "<table class='admin-table' style='font-size:13px;margin-top:12px'>" +
      "<tr><th>Prix moyen</th><td>" + A.euro(s.avgPrice) + "</td></tr>" +
      "<tr><th>Prix médian</th><td>" + A.euro(s.medianPrice) + "</td></tr>" +
      "<tr><th>Min / Max</th><td>" + A.euro(s.minPrice) + " — " + A.euro(s.maxPrice) + "</td></tr>" +
      "<tr><th>Volume ventes</th><td>" + (s.volume || 0) + "</td></tr>" +
      "<tr><th>Rachat moyen</th><td>" + A.euro(s.buybackAvg) + " (" + (s.buybackVolume || 0) + " tx)</td></tr>" +
      "<tr><th>Historique interne moy.</th><td>" + A.euro(s.internalAvg) + "</td></tr>" +
      "<tr><th>Évol. 7 j</th><td>" + (ev.days7 ?? 0) + " %</td></tr>" +
      "<tr><th>Évol. 30 j</th><td>" + (ev.days30 ?? 0) + " %</td></tr>" +
      "<tr><th>Évol. 90 j</th><td>" + (ev.days90 ?? 0) + " %</td></tr>" +
      "<tr><th>Évol. 1 an</th><td>" + (ev.days1y ?? 0) + " %</td></tr>" +
      "<tr><th>Indice liquidité</th><td>" + (idx.liquidity ?? "—") + " / 100</td></tr>" +
      "<tr><th>Indice demande</th><td>" + (idx.demand ?? "—") + " / 100</td></tr>" +
      "<tr><th>Indice rareté</th><td>" + (idx.rarity ?? "—") + " / 100</td></tr>" +
      "</table>";
  }

  function renderTransactions(list) {
    return (list || []).map(function (t) {
      return "<tr><td>" + (t.transactionAt || "").slice(0, 10) + "</td><td>" + t.type + "</td><td>" +
        (t.salePrice != null ? A.euro(t.salePrice) : "—") + "</td><td>" +
        (t.buybackPrice != null ? A.euro(t.buybackPrice) : "—") + "</td><td>" +
        (t.condition || "—") + "</td><td>" + (t.channel || "") + "</td><td style='font-size:11px;color:#baaf97'>" +
        (t.seller || "") + " → " + (t.buyer || "") + "</td></tr>";
    }).join("") || "<tr><td colspan='7'>Aucune transaction</td></tr>";
  }

  function loadCardStats(cardId) {
    if (!cardId) return;
    A.qs("#cardStatsBox").innerHTML = "Chargement…";
    A.adminFetch("/api/admin/market/stats/" + encodeURIComponent(cardId)).then(function (d) {
      if (!d.ok) {
        A.qs("#cardStatsBox").innerHTML = "<div class='admin-panel'>" + (d.error || "Erreur") + "</div>";
        return;
      }
      A.qs("#cardStatsBox").innerHTML =
        "<h3 style='color:#ffe18a'>" + (d.card?.name || cardId) + "</h3>" +
        renderStats(d.stats) +
        "<h4 style='color:#ffe18a;margin-top:16px'>Transactions récentes</h4>" +
        "<table class='admin-table' style='font-size:12px'><thead><tr><th>Date</th><th>Type</th><th>Vente</th><th>Rachat</th><th>État</th><th>Canal</th><th>Parties</th></tr></thead><tbody>" +
        renderTransactions(d.transactions) + "</tbody></table>";
    });
  }

  function loadDashboard() {
    A.adminFetch("/api/admin/market/dashboard").then(function (d) {
      if (d.ok && A.qs("#marketDash")) A.qs("#marketDash").innerHTML = renderDashboard(d.dashboard);
    });
    A.adminFetch("/api/admin/market/transactions?limit=25").then(function (d) {
      if (d.ok && A.qs("#txList")) {
        A.qs("#txList").innerHTML = renderTransactions(d.transactions);
      }
    });
  }

  A.renderShell("marche", "Données marché Cardoria", "Collecte, statistiques et indices — alimentation automatique de l'IA",
    "<div id='marketDash'></div>" +
    "<div class='admin-filters' style='margin-top:16px'>" +
    "<input id='cardSearch' placeholder='Rechercher une carte…' style='min-width:220px'>" +
    "<button class='btn btn-primary' type='button' id='searchCard'>Rechercher</button>" +
    "<button class='btn btn-secondary' type='button' id='recomputeAll'>Recalculer tout</button></div>" +
    "<div id='searchResults' style='margin-top:10px'></div>" +
    "<div class='admin-panel' style='margin-top:16px'><h3 style='color:#ffe18a'>Ajouter une transaction</h3>" +
    "<div class='admin-filters' style='flex-wrap:wrap;gap:10px'>" +
    "<label>ID carte<input id='txCardId' placeholder='pokemon-pikachu-vmax'></label>" +
    "<label>Prix vente €<input type='number' step='0.01' id='txPrice'></label>" +
    "<label>Rachat €<input type='number' step='0.01' id='txBuyback'></label>" +
    "<label>État<input id='txCondition' placeholder='Near Mint'></label>" +
    "<label>Langue<input id='txLang' placeholder='FR'></label>" +
    "<label>Vendeur<input id='txSeller'></label>" +
    "<label>Acheteur<input id='txBuyer'></label>" +
    "<label>Délai vente (j)<input type='number' id='txDelay'></label>" +
    "</div><button class='btn btn-primary' type='button' id='addTx' style='margin-top:10px'>Enregistrer</button></div>" +
    "<div id='cardStatsBox' style='margin-top:16px'></div>" +
    "<div class='admin-panel' style='margin-top:16px'><h3 style='color:#ffe18a'>Dernières transactions globales</h3>" +
    "<table class='admin-table' style='font-size:12px'><thead><tr><th>Date</th><th>Type</th><th>Vente</th><th>Rachat</th><th>État</th><th>Canal</th><th>Parties</th></tr></thead><tbody id='txList'></tbody></table></div>");

  A.qs("#searchCard").onclick = function () {
    var q = A.qs("#cardSearch").value.trim();
    if (!q) return;
    A.adminFetch("/api/admin/market/search?q=" + encodeURIComponent(q)).then(function (d) {
      A.qs("#searchResults").innerHTML = (d.cards || []).map(function (c) {
        return "<button type='button' class='btn btn-secondary' style='margin:4px' data-id='" + c.id + "'>" + c.name + " (" + c.extension + ")</button>";
      }).join("") || "<span style='color:#baaf97'>Aucune carte</span>";
      A.qs("#searchResults").querySelectorAll("button").forEach(function (btn) {
        btn.onclick = function () {
          A.qs("#txCardId").value = btn.dataset.id;
          loadCardStats(btn.dataset.id);
        };
      });
    });
  };

  A.qs("#addTx").onclick = function () {
    var cardId = A.qs("#txCardId").value.trim();
    if (!cardId) { alert("ID carte requis."); return; }
    A.adminFetch("/api/admin/market/transactions", {
      method: "POST",
      body: JSON.stringify({
        cardId: cardId,
        salePrice: A.qs("#txPrice").value ? Number(A.qs("#txPrice").value) : undefined,
        buybackPrice: A.qs("#txBuyback").value ? Number(A.qs("#txBuyback").value) : undefined,
        condition: A.qs("#txCondition").value,
        language: A.qs("#txLang").value,
        seller: A.qs("#txSeller").value,
        buyer: A.qs("#txBuyer").value,
        daysToSell: A.qs("#txDelay").value ? Number(A.qs("#txDelay").value) : undefined
      })
    }).then(function (d) {
      alert(d.ok ? "Transaction enregistrée." : (d.error || "Erreur"));
      if (d.ok) { loadCardStats(cardId); loadDashboard(); }
    });
  };

  A.qs("#recomputeAll").onclick = function () {
    A.adminFetch("/api/admin/market/recompute-all", { method: "POST", body: "{}" }).then(function (d) {
      alert(d.ok ? "Recalcul : " + d.recomputed + " cartes" : (d.error || "Erreur"));
      loadDashboard();
    });
  };

  loadDashboard();
})();
