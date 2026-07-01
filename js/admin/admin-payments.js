(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  var STATUS_LABELS = {
    pending: "En attente",
    paid: "Payé",
    failed: "Échoué",
    refunded: "Remboursé"
  };

  function badge(status) {
    var cls = status === "paid" ? "admin-badge--ok" : status === "failed" ? "admin-badge--danger" : status === "refunded" ? "admin-badge--warn" : "";
    return '<span class="admin-badge ' + cls + '">' + (STATUS_LABELS[status] || status) + "</span>";
  }

  function renderList(payments) {
    A.qs("#payList").innerHTML = (payments || []).map(function (p) {
      var source = p.source === "boutique" ? "Boutique" : "Marketplace";
      return "<tr><td>" + p.id + "</td><td>" + source + "</td><td>" + p.orderId + "</td><td>" +
        (p.customerEmail || "—") + "</td><td>" + A.euro(p.amount) + "</td><td>" + badge(p.status) + "</td><td>" +
        (p.sumupCheckoutId || "—") + "</td><td style='font-size:12px;color:#baaf97'>" +
        (p.createdAt ? p.createdAt.slice(0, 16).replace("T", " ") : "—") + "</td></tr>";
    }).join("") || "<tr><td colspan='8'>Aucun paiement enregistré</td></tr>";
  }

  function load(status) {
    var q = status ? "?status=" + encodeURIComponent(status) : "";
    A.adminFetch("/api/admin/payments" + q).then(function (d) {
      if (!d.ok) return;
      A.qs("#payConfig").textContent = "SumUp : " + (d.configured ? "actif" : "non configuré") +
        " — Total affiché : " + (d.payments || []).length;
      renderList(d.payments);
    });
  }

  A.renderShell("payments", "Paiements SumUp", "Historique boutique et marketplace — statuts en attente / payé / échoué / remboursé",
    '<div class="admin-panel"><p id="payConfig">Chargement…</p></div>' +
    '<div class="admin-filters admin-periods">' +
    '<button type="button" data-s="" class="active">Tous</button>' +
    '<button type="button" data-s="pending">En attente</button>' +
    '<button type="button" data-s="paid">Payés</button>' +
    '<button type="button" data-s="failed">Échoués</button>' +
    '<button type="button" data-s="refunded">Remboursés</button></div>' +
    '<div class="admin-panel"><h2>Historique des paiements</h2>' +
    '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
    "<th>ID</th><th>Source</th><th>Commande</th><th>Client</th><th>Montant</th><th>Statut</th><th>Checkout SumUp</th><th>Date</th>" +
    "</tr></thead><tbody id='payList'></tbody></table></div></div>");

  A.qs(".admin-periods").querySelectorAll("button").forEach(function (btn) {
    btn.onclick = function () {
      A.qs(".admin-periods").querySelectorAll("button").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      load(btn.dataset.s);
    };
  });

  load("");
})();
