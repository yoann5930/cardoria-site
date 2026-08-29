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
    else { var a = document.createElement("a"); a.href = url; a.download = filename || "cardoria-export"; document.body.appendChild(a); a.click(); a.remove(); }
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  function renderOrders(orders) {
    A.qs("#mkOrdersBody").innerHTML = (orders || []).map(function (o) {
      var canRefund = o.paymentProvider === "paypal" && ["paid", "preparing", "shipped", "delivered"].includes(o.status) && o.paymentStatus === "paid";
      return "<tr><td>" + esc(o.id) + "</td><td>" + esc(o.listingTitle) + "</td><td>" + esc(o.buyerEmail) + "</td><td>" + A.euro(o.total) + "</td><td>" + esc(o.status) + " / " + esc(o.paymentStatus || "—") + "</td><td>" +
        '<input placeholder="Suivi" id="trk-' + esc(o.id) + '" value="' + esc(o.shippingTracking || "") + '" style="width:100px">' +
        '<select data-order="' + esc(o.id) + '"><option value="preparing">Préparation</option><option value="shipped">Expédié</option><option value="delivered">Livré</option><option value="cancelled">Annulé</option></select>' +
        '<button type="button" data-inv="' + esc(o.id) + '">Facture</button>' +
        (canRefund ? '<button type="button" class="btn btn-secondary" data-refund="' + esc(o.id) + '">Rembourser PayPal</button>' : "") + "</td></tr>";
    }).join("") || "<tr><td colspan='6'>Aucune commande</td></tr>";
    A.qs("#mkOrdersBody").querySelectorAll("select[data-order]").forEach(function (sel) {
      var o = orders.find(function (x) { return x.id === sel.dataset.order; });
      sel.value = ["preparing", "shipped", "delivered", "cancelled"].includes(o?.status) ? o.status : "preparing";
      sel.onchange = function () {
        var tracking = document.getElementById("trk-" + sel.dataset.order)?.value;
        A.adminFetch("/api/admin/marketplace/orders/" + encodeURIComponent(sel.dataset.order) + "/tracking", { method: "PUT", body: JSON.stringify({ status: sel.value, tracking: tracking }) }).then(function () { location.reload(); }).catch(function (e) { alert(e.message || "Mise à jour impossible"); });
      };
    });
    A.qs("#mkOrdersBody").querySelectorAll("button[data-inv]").forEach(function (btn) { btn.onclick = function () { openProtected("/api/admin/marketplace/orders/" + encodeURIComponent(btn.dataset.inv) + "/invoice", "", true).catch(function (e) { alert(e.message); }); }; });
    A.qs("#mkOrdersBody").querySelectorAll("button[data-refund]").forEach(function (btn) { btn.onclick = function () { if (!confirm("Confirmer le remboursement PayPal de cette commande ?")) return; A.adminFetch("/api/admin/marketplace/orders/" + encodeURIComponent(btn.dataset.refund) + "/refund", { method: "POST", body: "{}" }).then(function () { location.reload(); }).catch(function (e) { alert(e.message || "Remboursement impossible"); }); }; });
  }

  function moderateListing(id, status) {
    var reason = "";
    if (status !== "active") {
      reason = prompt(status === "removed" ? "Motif du retrait définitif :" : "Motif de suspension :", "") || "";
      if (reason.trim().length < 3) return;
    }
    if (!confirm("Confirmer la modération de cette annonce ?")) return;
    A.adminFetch("/api/admin/marketplace/listings/" + encodeURIComponent(id) + "/moderation", { method: "PUT", body: JSON.stringify({ status: status, reason: reason }) })
      .then(function () { loadListings(); }).catch(function (e) { alert(e.message || "Modération impossible"); });
  }

  function renderListings(listings) {
    A.qs("#mkListingsBody").innerHTML = (listings || []).slice(0, 100).map(function (l) {
      var note = l.moderationLocked ? "<div class='small'>🔒 " + esc(l.moderationReason || "Verrouillé par Cardoria") + "</div>" : "";
      var actions = l.status === "sold" ? "—" :
        '<button type="button" data-mod="active" data-id="' + esc(l.id) + '">Réactiver</button> ' +
        '<button type="button" class="btn btn-secondary" data-mod="suspended" data-id="' + esc(l.id) + '">Suspendre</button> ' +
        '<button type="button" class="btn btn-secondary" data-mod="removed" data-id="' + esc(l.id) + '">Retirer</button>';
      return "<tr><td>" + esc(l.id) + "</td><td>" + esc(l.title) + note + "</td><td>" + esc(l.statusLabel || l.status) + "</td><td>" + A.euro(l.price) + "</td><td>" + esc(l.stock) + "</td><td>" + actions + "</td></tr>";
    }).join("") || "<tr><td colspan='6'>Aucune annonce</td></tr>";
    A.qs("#mkListingsBody").querySelectorAll("button[data-mod]").forEach(function (btn) { btn.onclick = function () { moderateListing(btn.dataset.id, btn.dataset.mod); }; });
  }

  function loadListings() {
    var status = A.qs("#mkListingFilter").value;
    var path = "/api/admin/marketplace/listings" + (status ? "?status=" + encodeURIComponent(status) : "");
    A.adminFetch(path).then(function (d) { if (d.ok) renderListings(d.listings); }).catch(function (e) { A.qs("#mkListingsBody").innerHTML = "<tr><td colspan='6'>" + esc(e.message) + "</td></tr>"; });
  }

  function disputeOptions(value, entries) { return entries.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === value ? " selected" : "") + ">" + x[1] + "</option>"; }).join(""); }
  function renderDisputes(disputes) {
    var statuses = [["open","Ouvert"],["investigating","Analyse"],["waiting_buyer","Attente acheteur"],["waiting_seller","Attente vendeur"],["resolved","Résolu"],["rejected","Rejeté"],["closed","Clos"]];
    var priorities = [["low","Basse"],["normal","Normale"],["high","Haute"],["urgent","Urgente"]];
    var resolutions = [["none","—"],["buyer_refund","Remboursement acheteur"],["seller_favor","Décision vendeur"],["partial_refund","Remboursement partiel"],["agreement","Accord parties"],["insufficient_evidence","Preuves insuffisantes"],["duplicate","Doublon"],["other","Autre"]];
    A.qs("#mkDisputesBody").innerHTML = (disputes || []).map(function (x) {
      return "<tr data-dispute='" + esc(x.id) + "'><td>" + esc(x.id) + "<div class='small'>" + esc(x.orderId) + "</div></td><td>" + esc(x.reason) + "</td><td><select data-dstatus>" + disputeOptions(x.status, statuses) + "</select><select data-dpriority>" + disputeOptions(x.priority || "normal", priorities) + "</select></td><td><select data-dresolution>" + disputeOptions(x.resolutionCode || "none", resolutions) + "</select><input data-dtext placeholder='Résolution' value='" + esc(x.resolution || "") + "'><input data-dnote placeholder='Note interne' value='" + esc(x.adminNote || "") + "'></td><td><button type='button' data-save>Enregistrer</button> <button type='button' class='btn btn-secondary' data-history>Historique</button></td></tr>";
    }).join("") || "<tr><td colspan='5'>Aucun litige</td></tr>";
    A.qs("#mkDisputesBody").querySelectorAll("button[data-save]").forEach(function (btn) {
      btn.onclick = function () {
        var row = btn.closest("tr"); var id = row.dataset.dispute;
        var body = { status: row.querySelector("[data-dstatus]").value, priority: row.querySelector("[data-dpriority]").value, resolutionCode: row.querySelector("[data-dresolution]").value, resolution: row.querySelector("[data-dtext]").value, adminNote: row.querySelector("[data-dnote]").value };
        A.adminFetch("/api/admin/marketplace/disputes/" + encodeURIComponent(id) + "/manage", { method: "PUT", body: JSON.stringify(body) }).then(function () { loadDisputes(); }).catch(function (e) { alert(e.message || "Mise à jour impossible"); });
      };
    });
    A.qs("#mkDisputesBody").querySelectorAll("button[data-history]").forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.closest("tr").dataset.dispute;
        A.adminFetch("/api/admin/marketplace/disputes/" + encodeURIComponent(id) + "/detail").then(function (d) {
          var history = d.dispute?.history || [];
          alert(history.length ? history.map(function (h) { return (h.createdAt || "") + " · " + (h.actor || "") + " · " + (h.fromStatus || "—") + " → " + (h.toStatus || "—") + "\n" + (h.note || ""); }).join("\n\n") : "Aucun historique");
        }).catch(function (e) { alert(e.message); });
      };
    });
  }
  function loadDisputes() { A.adminFetch("/api/admin/marketplace/disputes").then(function (d) { renderDisputes(d.disputes || []); }); }

  A.renderShell("marketplace", "Marketplace", "Annonces, commandes, vendeurs, litiges et paiements PayPal",
    '<div id="mkStats" class="admin-kpi-grid" style="margin-bottom:16px"></div>' +
    '<div class="admin-filters"><button class="btn btn-primary" type="button" id="mkExport">Export compta CSV</button><button class="btn btn-secondary" type="button" id="mkAlerts">Alertes prix</button></div>' +
    '<div class="admin-panel"><h2>Configuration</h2><p id="mkConfig">Chargement…</p></div>' +
    '<div class="admin-panel"><h2>Modération des annonces</h2><div class="admin-filters"><select id="mkListingFilter"><option value="">Tous les statuts</option><option value="active">En ligne</option><option value="draft">Brouillons</option><option value="suspended">Suspendues</option><option value="removed">Retirées</option><option value="sold">Vendues</option></select></div><table class="admin-table"><thead><tr><th>ID</th><th>Titre</th><th>Statut</th><th>Prix</th><th>Stock</th><th>Actions</th></tr></thead><tbody id="mkListingsBody"></tbody></table></div>' +
    '<div class="admin-panel"><h2>Vendeurs</h2><table class="admin-table"><thead><tr><th>Nom</th><th>Type</th><th>Ventes</th><th>Note</th><th>Vérifié</th><th></th></tr></thead><tbody id="mkSellersBody"></tbody></table></div>' +
    '<div class="admin-panel"><h2>Commandes</h2><table class="admin-table"><thead><tr><th>ID</th><th>Annonce</th><th>Client</th><th>Total</th><th>Statut</th><th>Actions</th></tr></thead><tbody id="mkOrdersBody"></tbody></table></div>' +
    '<div class="admin-panel"><h2>Gestion des litiges</h2><table class="admin-table"><thead><tr><th>Litige / commande</th><th>Raison</th><th>Suivi</th><th>Décision</th><th>Actions</th></tr></thead><tbody id="mkDisputesBody"></tbody></table></div>');

  A.adminFetch("/api/admin/marketplace/config").then(function (d) {
    var b = d.boutique || {}, m = d.marketplace || {};
    A.qs("#mkConfig").textContent = "Boutique : SumUp " + (b.configured ? "actif" : "non configuré") + " — Marketplace : PayPal " + (m.configured ? "actif" : "non configuré") + " — Webhook PayPal : " + (m.webhookConfigured ? "actif" : "non configuré") + " — Environnement : " + (m.environment || "—") + " — Étiquettes transporteur : " + (d.carrierLabelsReady ? "actives" : "en attente d’intégration");
    if (d.stats) A.qs("#mkStats").innerHTML = "<div class='admin-kpi'><label>Annonces</label><strong>" + d.stats.listingsActive + "/" + d.stats.listings + "</strong></div><div class='admin-kpi'><label>Commandes payées</label><strong>" + d.stats.ordersPaid + "</strong></div><div class='admin-kpi'><label>CA</label><strong>" + A.euro(d.stats.revenue) + "</strong></div><div class='admin-kpi'><label>Litiges ouverts</label><strong>" + d.stats.disputesOpen + "</strong></div>";
  }).catch(function (e) { A.qs("#mkConfig").textContent = e.message; });

  loadListings(); A.qs("#mkListingFilter").onchange = loadListings;
  A.adminFetch("/api/admin/marketplace/sellers").then(function (d) {
    A.qs("#mkSellersBody").innerHTML = (d.sellers || []).map(function (s) { return "<tr><td>" + esc(s.displayName) + "</td><td>" + esc(s.sellerType) + "</td><td>" + esc(s.salesCount) + "</td><td>" + esc(s.ratingAvg) + "</td><td>" + (s.verified ? "Oui" : "Non") + "</td><td><button type='button' class='btn btn-secondary' data-vid='" + esc(s.id) + "'>" + (s.verified ? "Retirer" : "Vérifier") + "</button></td></tr>"; }).join("") || "<tr><td colspan='6'>Aucun vendeur</td></tr>";
    A.qs("#mkSellersBody").querySelectorAll("button[data-vid]").forEach(function (btn) { btn.onclick = function () { var seller = d.sellers.find(function (x) { return x.id === btn.dataset.vid; }); A.adminFetch("/api/admin/marketplace/sellers/" + encodeURIComponent(btn.dataset.vid) + "/verified", { method: "PUT", body: JSON.stringify({ verified: !seller.verified }) }).then(function () { location.reload(); }); }; });
  });
  A.adminFetch("/api/admin/marketplace/orders").then(function (d) { if (d.ok) renderOrders(d.orders); });
  loadDisputes();
  A.qs("#mkExport").onclick = function () { openProtected("/api/admin/marketplace/export/accounting.csv", "cardoria-marketplace-compta.csv", false).catch(function (e) { alert(e.message); }); };
  A.qs("#mkAlerts").onclick = function () { A.adminFetch("/api/admin/marketplace/alerts/process", { method: "POST" }).then(function (r) { alert("Alertes : " + (r.notified || 0)); }).catch(function (e) { alert(e.message); }); };
})();