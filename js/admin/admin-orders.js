(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  var orders = [];
  var filter = "all";

  function euro(n) { return Number(n || 0).toFixed(2).replace(".", ",") + " €"; }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function orderTotal(o) { return (o.items || []).reduce(function (s, i) { return s + i.qty * i.price; }, 0); }

  function statusSteps(current) {
    var steps = ["À préparer", "En préparation", "Expédiée", "Livrée", "Facturée"];
    var idx = steps.indexOf(current);
    return steps.map(function (s, i) {
      return '<span class="' + (i <= idx ? "active" : "") + '">' + s + "</span>";
    }).join("");
  }

  function renderOrders() {
    var q = (A.qs("#orderSearch").value || "").toLowerCase();
    var list = orders.filter(function (o) {
      var ok = filter === "all" || (filter === "today" ? o.date === todayStr() : o.status === filter);
      var txt = (o.id + o.client + o.email + o.status + (o.tracking || "")).toLowerCase();
      return ok && txt.includes(q);
    });
    A.qs("#orderCards").innerHTML = list.map(function (o) {
      return '<article class="request-card" style="margin-bottom:16px">' +
        '<div class="request-head"><div><h3>' + o.id + "</h3><p>" + o.date + " • " + o.client + "<br>" + o.email + '</p></div><strong>' + euro(orderTotal(o)) + "</strong></div>" +
        '<div class="progress">' + statusSteps(o.status) + "</div>" +
        "<p><b>Livraison :</b> " + (o.shipping || "À définir") + " • <b>Suivi :</b> " + (o.tracking || "Non renseigné") + " • <b>Paiement :</b> " + o.payment + "</p>" +
        '<div class="actions"><button type="button" class="btn btn-secondary" data-doc="' + o.id + '" data-type="bon">Bon commande</button>' +
        '<button type="button" class="btn btn-secondary" data-doc="' + o.id + '" data-type="facture">Facture</button></div></article>';
    }).join("") || "<div class='admin-panel'>Aucune commande.</div>";

    A.qs("#orderCards").querySelectorAll("button[data-doc]").forEach(function (btn) {
      btn.onclick = function () {
        window.open("document-commande.html?id=" + encodeURIComponent(btn.dataset.doc) + "&type=" + encodeURIComponent(btn.dataset.type), "_blank");
      };
    });
  }

  A.renderShell("orders", "Commandes", "Suivi des ventes et documents",
    '<div class="admin-filters">' +
    '<input id="orderSearch" placeholder="Rechercher commande..." oninput="renderOrdersList()">' +
    '<button class="btn btn-secondary" type="button" data-filter="all">Toutes</button>' +
    '<button class="btn btn-secondary" type="button" data-filter="today">Aujourd\'hui</button>' +
    '<button class="btn btn-secondary" type="button" data-filter="À préparer">À préparer</button></div>' +
    '<div id="orderCards"></div>');

  A.qs(".admin-filters").querySelectorAll("button[data-filter]").forEach(function (btn) {
    btn.onclick = function () {
      filter = btn.dataset.filter;
      renderOrders();
    };
  });

  window.renderOrdersList = renderOrders;

  fetch("orders.json", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (d) { orders = d || []; renderOrders(); })
    .catch(function () { orders = []; renderOrders(); });
})();
