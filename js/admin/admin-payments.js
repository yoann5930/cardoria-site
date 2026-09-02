(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A || !A.protectAdmin()) return;

  var state = { status: "", source: "", q: "", payments: [] };
  var STATUS_LABELS = { pending: "En attente", paid: "Payé", failed: "Échoué", refunded: "Remboursé" };

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]; }); }
  function badge(status) {
    var cls = status === "paid" ? "admin-badge--ok" : status === "failed" ? "admin-badge--danger" : status === "refunded" ? "admin-badge--warn" : "";
    return '<span class="admin-badge ' + cls + '">' + esc(STATUS_LABELS[status] || status || "—") + "</span>";
  }
  function reconciliationBadge(r) {
    var stateName = r && r.state || "unknown";
    var cls = stateName === "ok" ? "admin-badge--ok" : stateName === "mismatch" || stateName === "orphan" ? "admin-badge--danger" : "admin-badge--warn";
    return '<span class="admin-badge ' + cls + '">' + esc(r && r.label || "À vérifier") + "</span>";
  }

  function filteredPayments() {
    var q = String(state.q || "").toLowerCase();
    return state.payments.filter(function (p) {
      if (state.source && p.source !== state.source) return false;
      if (!q) return true;
      return JSON.stringify(p).toLowerCase().includes(q);
    });
  }

  function orderLink(p) {
    return p.source === "boutique" ? "admin-commandes.html" : "admin-marketplace.html";
  }

  function providerLabel(p) {
    var provider = String(p.provider || "").toLowerCase();
    if (provider === "revolut") return "Revolut";
    if (provider === "paypal") return "PayPal";
    if (provider === "sumup") return "Historique SumUp";
    return provider || "—";
  }

  function renderList() {
    var rows = filteredPayments();
    A.qs("#payList").innerHTML = rows.map(function (p) {
      var source = p.source === "boutique" ? "Boutique" : p.source === "live_cardoria" ? "Live Cardoria" : p.source === "live_seller" ? "Live vendeur" : "Marketplace";
      var actions = '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        (p.canSync ? '<button class="btn btn-secondary" type="button" data-sync="' + esc(p.id) + '">Synchroniser</button>' : "") +
        '<a class="btn btn-secondary" href="' + orderLink(p) + '">Commande</a>' +
        (p.canRefund ? '<button class="btn" type="button" data-refund="' + esc(p.id) + '" data-amount="' + Number(p.amount || 0) + '">Rembourser</button>' : "") +
        "</div>";
      return "<tr>" +
        "<td><strong>" + esc(p.id) + "</strong><br><small>" + esc(p.orderId || "—") + "</small></td>" +
        "<td>" + source + "<br><small>" + esc(providerLabel(p)) + "</small></td>" +
        "<td>" + esc(p.customerName || "—") + "<br><small>" + esc(p.customerEmail || "—") + "</small></td>" +
        "<td><strong>" + A.euro(p.amount) + "</strong><br><small>" + esc(p.paymentMethod || "—") + "</small></td>" +
        "<td>" + badge(p.status) + "<br><small>Commande: " + esc(p.orderPaymentStatus || p.orderStatus || "—") + "</small></td>" +
        "<td>" + reconciliationBadge(p.reconciliation) + "</td>" +
        "<td><small>Commande prestataire</small><br>" + esc(p.providerOrderId || p.sumupCheckoutId || "—") + "<br><small>Transaction</small><br>" + esc(p.providerTransactionId || p.sumupTransactionId || "—") + "</td>" +
        "<td>" + (p.createdAt ? new Date(p.createdAt).toLocaleString("fr-FR") : "—") + "</td>" +
        "<td>" + actions + "</td></tr>";
    }).join("") || "<tr><td colspan='9'>Aucun paiement pour ces filtres.</td></tr>";

    A.qs("#payList").querySelectorAll("[data-sync]").forEach(function (btn) {
      btn.onclick = function () { syncPayment(btn.dataset.sync, btn); };
    });
    A.qs("#payList").querySelectorAll("[data-refund]").forEach(function (btn) {
      btn.onclick = function () { refundPayment(btn.dataset.refund, Number(btn.dataset.amount || 0), btn); };
    });
  }

  function renderSummary(summary, configured, environment) {
    summary = summary || {};
    var status = configured ? "ACTIF" : "NON CONFIGURÉ";
    if (configured && environment) status += " · " + String(environment).toUpperCase();
    A.qs("#paymentConfigured").textContent = status;
    A.qs("#paymentConfigured").className = "admin-badge " + (configured ? "admin-badge--ok" : "admin-badge--danger");
    A.qs("#payPaidAmount").textContent = A.euro(summary.paidAmount || 0);
    A.qs("#payPaidCount").textContent = (summary.paid || 0) + " paiement(s)";
    A.qs("#payPendingAmount").textContent = A.euro(summary.pendingAmount || 0);
    A.qs("#payPendingCount").textContent = (summary.pending || 0) + " paiement(s)";
    A.qs("#payRefundedAmount").textContent = A.euro(summary.refundedAmount || 0);
    A.qs("#payRefundedCount").textContent = (summary.refunded || 0) + " remboursement(s)";
    A.qs("#payMismatch").textContent = String((summary.mismatches || 0) + (summary.orphans || 0));
    A.qs("#payMismatchDetail").textContent = (summary.mismatches || 0) + " écart(s) · " + (summary.orphans || 0) + " orphelin(s)";
  }

  function load() {
    var query = state.status ? "?status=" + encodeURIComponent(state.status) : "";
    A.adminFetch("/api/admin/payments/" + query).then(function (d) {
      if (!d.ok) { alert(d.error || "Impossible de charger les paiements."); return; }
      state.payments = d.payments || [];
      renderSummary(d.summary, d.configured, d.environment);
      renderList();
    }).catch(function () { alert("Impossible de charger les paiements Revolut."); });
  }

  function syncPayment(id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = "Sync..."; }
    A.adminFetch("/api/admin/payments/" + encodeURIComponent(id) + "/sync", { method: "POST", body: "{}" }).then(function (d) {
      if (!d.ok) throw new Error(d.error || "Synchronisation impossible");
      load();
    }).catch(function (e) { alert(e.message || "Synchronisation impossible"); if (btn) { btn.disabled = false; btn.textContent = "Synchroniser"; } });
  }

  function refundPayment(id, maxAmount, btn) {
    var answer = prompt("Montant à rembourser en euros. Laisse vide pour un remboursement TOTAL.", "");
    if (answer === null) return;
    var body = {};
    if (String(answer).trim()) {
      var amount = Number(String(answer).replace(",", "."));
      if (!Number.isFinite(amount) || amount <= 0 || amount > maxAmount) { alert("Montant invalide. Maximum : " + A.euro(maxAmount)); return; }
      body.amount = amount;
    }
    if (!confirm(body.amount ? "Confirmer le remboursement de " + A.euro(body.amount) + " ?" : "Confirmer le remboursement TOTAL de " + A.euro(maxAmount) + " ?")) return;
    if (btn) { btn.disabled = true; btn.textContent = "Remboursement..."; }
    A.adminFetch("/api/admin/payments/" + encodeURIComponent(id) + "/refund", { method: "POST", body: JSON.stringify(body) }).then(function (d) {
      if (!d.ok) throw new Error(d.error || "Remboursement impossible");
      alert("Demande de remboursement envoyée à Revolut. Statut : " + (d.status || "en cours"));
      load();
    }).catch(function (e) { alert(e.message || "Remboursement impossible"); if (btn) { btn.disabled = false; btn.textContent = "Rembourser"; } });
  }

  A.renderShell("payments", "Paiements Revolut", "Pilotage des ventes directes Cardoria : Boutique et Live Cardoria",
    '<div class="admin-panel" style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap"><div><h2 style="margin:0 0 6px">État Revolut</h2><p style="margin:0;color:#baaf97">Revolut est réservé aux ventes directes Cardoria. Le Market et les Lives vendeurs utilisent PayPal Multi.</p></div><span id="paymentConfigured" class="admin-badge">...</span></div>' +
    '<div class="admin-kpi-grid">' +
      '<div class="admin-kpi"><label>Encaissé Revolut</label><strong id="payPaidAmount">0,00 €</strong><small id="payPaidCount">0 paiement</small></div>' +
      '<div class="admin-kpi"><label>En attente</label><strong id="payPendingAmount">0,00 €</strong><small id="payPendingCount">0 paiement</small></div>' +
      '<div class="admin-kpi"><label>Remboursé</label><strong id="payRefundedAmount">0,00 €</strong><small id="payRefundedCount">0 remboursement</small></div>' +
      '<div class="admin-kpi"><label>À rapprocher</label><strong id="payMismatch">0</strong><small id="payMismatchDetail">0 écart</small></div>' +
    '</div>' +
    '<div class="admin-filters">' +
      '<input id="paySearch" placeholder="Commande, client, référence prestataire...">' +
      '<select id="paySource"><option value="">Toutes sources historiques</option><option value="boutique">Boutique</option><option value="live_cardoria">Live Cardoria</option><option value="marketplace">Marketplace historique</option></select>' +
      '<select id="payStatus"><option value="">Tous statuts</option><option value="pending">En attente</option><option value="paid">Payés</option><option value="failed">Échoués</option><option value="refunded">Remboursés</option></select>' +
      '<button class="btn btn-primary" type="button" id="payRefresh">Actualiser</button>' +
    '</div>' +
    '<div class="admin-panel"><h2>Historique et rapprochement</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
      '<th>Paiement / commande</th><th>Source / prestataire</th><th>Client</th><th>Montant</th><th>Statut</th><th>Rapprochement</th><th>Références paiement</th><th>Date</th><th>Actions</th>' +
    '</tr></thead><tbody id="payList"></tbody></table></div></div>');

  A.qs("#paySearch").oninput = function () { state.q = this.value; renderList(); };
  A.qs("#paySource").onchange = function () { state.source = this.value; renderList(); };
  A.qs("#payStatus").onchange = function () { state.status = this.value; load(); };
  A.qs("#payRefresh").onclick = load;
  load();
})();