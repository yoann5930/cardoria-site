(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function tokenHeaders() { var t = sessionStorage.getItem("cardoria_session_token") || ""; return t ? { Authorization: "Bearer " + t } : {}; }

  async function openProtected(path, filename, openHtml) {
    var res = await fetch(A.BACKEND + path, { headers: tokenHeaders(), cache: "no-store" });
    if (res.status === 401) { sessionStorage.clear(); location.href = "admin-login.html"; return; }
    if (!res.ok) throw new Error("Document inaccessible");
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    if (openHtml) window.open(url, "_blank", "noopener");
    else {
      var a = document.createElement("a"); a.href = url; a.download = filename || "cardoria-export"; document.body.appendChild(a); a.click(); a.remove();
    }
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  function renderOrders(orders) {
    A.qs("#mkOrdersBody").innerHTML = (orders || []).map(function (o) {
      var canRefund = o.paymentProvider === "paypal" && ["paid", "preparing", "shipped", "delivered"].includes(o.status) && o.paymentStatus === "paid";
      return "<tr><td>" + esc(o.id) + "</td><td>" + esc(o.listingTitle) + "</td><td>" + esc(o.buyerEmail) + "</td><td>" + A.euro(o.total) + "</td><td>" + esc(o.status) + " / " + esc(o.paymentStatus || "—") + "</td><td>" +
        '<input placeholder="Suivi" id="trk-' + esc(o.id) + '" value="' + esc(o.shippingTracking || "") + '" style="width:100px">' +
        '<select data-order="' + esc(o.id) + '"><option value="preparing">Préparation</option><option value="shipped">Expédié</option><option value="delivered">Livré</option><option value="cancelled">Annulé</option></select>' +
        '<button type="button" data-inv="' + esc(o.id) + '">Facture</button>' +
        (canRefund ? '<button type="button" class="btn btn-secondary" data-refund="' + esc(o.id) + '">Rembourser PayPal</button>' : "") +
        "</td></tr>";
    }).join("") || "<tr><td colspan='6'>Aucune commande</td></tr>";

    A.qs("#mkOrdersBody").querySelectorAll("select[data-order]").forEach(function (sel) {
      var o = orders.find(function (x) { return x.id === sel.dataset.order; });
      sel.value = ["preparing", "shipped", "delivered", "cancelled"].includes(o?.status) ? o.status : "preparing";
      sel.onchange = function () {
        var tracking = document.getElementById("trk-" + sel.dataset.order)?.value;
        A.adminFetch("/api/admin/marketplace/orders/" + encodeURIComponent(sel.dataset.order) + "/tracking", {
          method: "PUT", body: JSON.stringify({ status: sel.value, tracking: tracking })
        }).then(function () { location.reload(); }).catch(function (e) { alert(e.message || "Mise à jour impossible"); });
      };
    });
    A.qs("#mkOrdersBody").querySelectorAll("button[data-inv]").forEach(function (btn) {
      btn.onclick = function () { openProtected("/api/admin/marketplace/orders/" + encodeURIComponent(btn.dataset.inv) + "/invoice", "", true).catch(function (e) { alert(e.message); }); };
    });
    A.qs("#mkOrdersBody").querySelectorAll("button[data-refund]").forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm("Confirmer le remboursement PayPal de cette commande ?")) return;
        A.adminFetch("/api/admin/marketplace/orders/" + encodeURIComponent(btn.dataset.refund) + "/refund", { method: "POST", body: "{}" })
          .then(function () { location.reload(); }).catch(function (e) { alert(e.message || "Remboursement impossible"); });
      };
    });
  }

  function renderListings(listings) {
    A.qs("#mkListingsBody").innerHTML = (listings || []).slice(0, 50).map(function (l) {
      return "<tr><td>" + esc(l.id) + "</td><td>" + esc(l.title) + "</td><td>" + esc(l.statusLabel || l.status) + "</td><td>" + A.euro(l.price) + "</td><td>" + esc(l.stock) + "</td></tr>";
    }).join("") || "<tr><td colspan='5'>—</td></tr>";
  }

  A.renderShell("marketplace", "Marketplace", "Annonces, commandes, vendeurs, litiges et paiements PayPal",
    '<div id="mkStats" class="admin-kpi-grid" style="margin-bottom:16px"></div>' +
    '<div class="admin-filters"><button class="btn btn-primary" type="button" id="mkExport">Export compta CSV</button>' +
    '<button class="btn btn-secondary" type="button" id="mkAlerts">Alertes prix</button></div>' +
    '<div class="admin-panel"><h2>Configuration</h2><p id="mkConfig">Chargement…</p></div>' +
    '<div class="admin-panel"><h2>Annonces</h2><table class="admin-table"><thead><tr><th>ID</th><th>Titre</th><th>Statut</th><th>Prix</th><th>Stock</th></tr></thead><tbody id="mkListingsBody"></tbody></table></div>' +
    '<div class="admin-panel"><h2>Vendeurs</h2><table class="admin-table"><thead><tr><th>Nom</th><th>Type</th><th>Ventes</th><th>Note</th><th>Vérifié</th><th></th></tr></thead><tbody id="mkSellersBody"></tbody></table></div>' +
    '<div class="admin-panel"><h2>Commandes</h2><table class="admin-table"><thead><tr><th>ID</th><th>Annonce</th><th>Client</th><th>Total</th><th>Statut</th><th>Actions</th></tr></thead><tbody id="mkOrdersBody"></tbody></table></div>' +
    '<div class="admin-panel"><h2>Litiges</h2><table class="admin-table"><thead><tr><th>ID</th><th>Commande</th><th>Statut</th><th>Raison</th></tr></thead><tbody id="mkDisputesBody"></tbody></table></div>');

  A.adminFetch("/api/admin/marketplace/config").then(function (d) {
    var b = d.boutique || {}, m = d.marketplace || {};
    A.qs("#mkConfig").textContent = "Boutique : SumUp " + (b.configured ? "actif" : "non configuré") + " — Marketplace : PayPal " + (m.configured ? "actif" : "non configuré") + " — Webhook PayPal : " + (m.webhookConfigured ? "actif" : "non configuré") + " — Environnement : " + (m.environment || "—") + " — Étiquettes transporteur : " + (d.carrierLabelsReady ? "actives" : "en attente d’intégration");
    if (d.stats) A.qs("#mkStats").innerHTML = "<div class='admin-kpi'><label>Annonces</label><strong>" + d.stats.listingsActive + "/" + d.stats.listings + "</strong></div><div class='admin-kpi'><label>Commandes payées</label><strong>" + d.stats.ordersPaid + "</strong></div><div class='admin-kpi'><label>CA</label><strong>" + A.euro(d.stats.revenue) + "</strong></div><div class='admin-kpi'><label>Litiges ouverts</label><strong>" + d.stats.disputesOpen + "</strong></div>";
  }).catch(function (e) { A.qs("#mkConfig").textContent = e.message; });

  A.adminFetch("/api/admin/marketplace/listings").then(function (d) { if (d.ok) renderListings(d.listings); });
  A.adminFetch("/api/admin/marketplace/sellers").then(function (d) {
    A.qs("#mkSellersBody").innerHTML = (d.sellers || []).map(function (s) {
      return "<tr><td>" + esc(s.displayName) + "</td><td>" + esc(s.sellerType) + "</td><td>" + esc(s.salesCount) + "</td><td>" + esc(s.ratingAvg) + "</td><td>" + (s.verified ? "Oui" : "Non") + "</td><td><button type='button' class='btn btn-secondary' data-vid='" + esc(s.id) + "'>" + (s.verified ? "Retirer" : "Vérifier") + "</button></td></tr>";
    }).join("") || "<tr><td colspan='6'>Aucun vendeur</td></tr>";
    A.qs("#mkSellersBody").querySelectorAll("button[data-vid]").forEach(function (btn) {
      btn.onclick = function () {
        var seller = d.sellers.find(function (x) { return x.id === btn.dataset.vid; });
        A.adminFetch("/api/admin/marketplace/sellers/" + encodeURIComponent(btn.dataset.vid) + "/verified", { method: "PUT", body: JSON.stringify({ verified: !seller.verified }) }).then(function () { location.reload(); });
      };
    });
  });
  A.adminFetch("/api/admin/marketplace/orders").then(function (d) { if (d.ok) renderOrders(d.orders); });
  A.adminFetch("/api/admin/marketplace/disputes").then(function (d) {
    A.qs("#mkDisputesBody").innerHTML = (d.disputes || []).map(function (x) { return "<tr><td>" + esc(x.id) + "</td><td>" + esc(x.orderId) + "</td><td>" + esc(x.status) + "</td><td>" + esc(x.reason) + "</td></tr>"; }).join("") || "<tr><td colspan='4'>Aucun litige</td></tr>";
  });

  A.qs("#mkExport").onclick = function () { openProtected("/api/admin/marketplace/export/accounting.csv", "cardoria-marketplace-compta.csv", false).catch(function (e) { alert(e.message); }); };
  A.qs("#mkAlerts").onclick = function () { A.adminFetch("/api/admin/marketplace/alerts/process", { method: "POST" }).then(function (r) { alert("Alertes : " + (r.notified || 0)); }).catch(function (e) { alert(e.message); }); };
})();