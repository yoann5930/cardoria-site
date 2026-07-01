(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function renderOrders(orders) {
    A.qs("#mkOrdersBody").innerHTML = (orders || []).map(function (o) {
      return "<tr><td>" + o.id + "</td><td>" + o.listingTitle + "</td><td>" + o.buyerEmail + "</td><td>" + A.euro(o.total) + "</td><td>" + o.status + " / " + (o.paymentStatus || "—") + "</td><td>" +
        '<input placeholder="Suivi" id="trk-' + o.id + '" value="' + (o.shippingTracking || "") + '" style="width:100px">' +
        '<select data-order="' + o.id + '"><option value="pending">En attente</option><option value="paid">Payé</option><option value="preparing">Préparation</option><option value="shipped">Expédié</option><option value="delivered">Livré</option><option value="cancelled">Annulé</option><option value="refunded">Remboursé</option></select>' +
        '<button type="button" data-inv="' + o.id + '">Facture</button></td></tr>';
    }).join("") || "<tr><td colspan='6'>Aucune commande</td></tr>";

    A.qs("#mkOrdersBody").querySelectorAll("select").forEach(function (sel) {
      var o = orders.find(function (x) { return x.id === sel.dataset.order; });
      sel.value = o?.status || "pending";
      sel.onchange = function () {
        var tracking = document.getElementById("trk-" + sel.dataset.order)?.value;
        A.adminFetch("/api/admin/marketplace/orders/" + sel.dataset.order + "/tracking", {
          method: "PUT", body: JSON.stringify({ status: sel.value, tracking: tracking })
        });
      };
    });
    A.qs("#mkOrdersBody").querySelectorAll("button[data-inv]").forEach(function (btn) {
      btn.onclick = function () {
        window.open(A.BACKEND + "/api/admin/marketplace/orders/" + btn.dataset.inv + "/invoice", "_blank");
      };
    });
  }

  function renderListings(listings) {
    A.qs("#mkListingsBody").innerHTML = (listings || []).slice(0, 50).map(function (l) {
      return "<tr><td>" + l.id + "</td><td>" + l.title + "</td><td>" + (l.statusLabel || l.status) + "</td><td>" + A.euro(l.price) + "</td><td>" + l.stock + "</td></tr>";
    }).join("") || "<tr><td colspan='5'>—</td></tr>";
  }

  A.renderShell("marketplace", "Marketplace v1.0", "Annonces, commandes, vendeurs, litiges, exports comptables",
    '<div id="mkStats" class="admin-kpi-grid" style="margin-bottom:16px"></div>' +
    '<div class="admin-filters"><button class="btn btn-primary" type="button" id="mkExport">Export compta CSV</button>' +
    '<button class="btn btn-secondary" type="button" id="mkAlerts">Alertes prix</button></div>' +
    '<div class="admin-panel"><h2>Configuration</h2><p id="mkConfig"></p></div>' +
    '<div class="admin-panel"><h2>Annonces</h2><table class="admin-table"><thead><tr><th>ID</th><th>Titre</th><th>Statut</th><th>Prix</th><th>Stock</th></tr></thead><tbody id="mkListingsBody"></tbody></table></div>' +
    '<div class="admin-panel"><h2>Vendeurs</h2><table class="admin-table"><thead><tr><th>Nom</th><th>Type</th><th>Ventes</th><th>Note</th><th>Vérifié</th><th></th></tr></thead><tbody id="mkSellersBody"></tbody></table></div>' +
    '<div class="admin-panel"><h2>Commandes</h2><table class="admin-table"><thead><tr><th>ID</th><th>Annonce</th><th>Client</th><th>Total</th><th>Statut</th><th>Actions</th></tr></thead><tbody id="mkOrdersBody"></tbody></table></div>' +
    '<div class="admin-panel"><h2>Litiges</h2><table class="admin-table"><thead><tr><th>ID</th><th>Commande</th><th>Statut</th><th>Raison</th></tr></thead><tbody id="mkDisputesBody"></tbody></table></div>');

  A.adminFetch("/api/admin/marketplace/config").then(function (d) {
    A.qs("#mkConfig").textContent = "SumUp : " + (d.sumup ? "actif" : "off") + " — Paiements SumUp uniquement";
    if (d.stats) {
      A.qs("#mkStats").innerHTML =
        "<div class='admin-kpi'><label>Annonces</label><strong>" + d.stats.listingsActive + "/" + d.stats.listings + "</strong></div>" +
        "<div class='admin-kpi'><label>Commandes payées</label><strong>" + d.stats.ordersPaid + "</strong></div>" +
        "<div class='admin-kpi'><label>CA</label><strong>" + A.euro(d.stats.revenue) + "</strong></div>" +
        "<div class='admin-kpi'><label>Litiges ouverts</label><strong>" + d.stats.disputesOpen + "</strong></div>";
    }
  });

  A.adminFetch("/api/admin/marketplace/listings").then(function (d) { if (d.ok) renderListings(d.listings); });
  A.adminFetch("/api/admin/marketplace/sellers").then(function (d) {
    A.qs("#mkSellersBody").innerHTML = (d.sellers || []).map(function (s) {
      return "<tr><td>" + s.displayName + "</td><td>" + s.sellerType + "</td><td>" + s.salesCount + "</td><td>" + s.ratingAvg + "</td><td>" + (s.verified ? "Oui" : "Non") + "</td><td>" +
        '<button type="button" class="btn btn-secondary" data-vid="' + s.id + '">' + (s.verified ? "Retirer" : "Vérifier") + "</button></td></tr>";
    }).join("");
    A.qs("#mkSellersBody").querySelectorAll("button").forEach(function (btn) {
      btn.onclick = function () {
        var seller = d.sellers.find(function (x) { return x.id === btn.dataset.vid; });
        A.adminFetch("/api/admin/marketplace/sellers/" + btn.dataset.vid + "/verified", {
          method: "PUT", body: JSON.stringify({ verified: !seller.verified })
        }).then(function () { location.reload(); });
      };
    });
  });
  A.adminFetch("/api/admin/marketplace/orders").then(function (d) { if (d.ok) renderOrders(d.orders); });
  A.adminFetch("/api/admin/marketplace/disputes").then(function (d) {
    A.qs("#mkDisputesBody").innerHTML = (d.disputes || []).map(function (x) {
      return "<tr><td>" + x.id + "</td><td>" + x.orderId + "</td><td>" + x.status + "</td><td>" + x.reason + "</td></tr>";
    }).join("") || "<tr><td colspan='4'>Aucun litige</td></tr>";
  });

  A.qs("#mkExport").onclick = function () {
    window.open(A.BACKEND + "/api/admin/marketplace/export/accounting.csv", "_blank");
  };
  A.qs("#mkAlerts").onclick = function () {
    A.adminFetch("/api/admin/marketplace/alerts/process", { method: "POST" }).then(function (r) {
      alert("Alertes : " + (r.notified || 0));
    });
  };
})();
