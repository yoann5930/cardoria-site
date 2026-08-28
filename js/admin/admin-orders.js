(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  var orders = [];
  var filter = "all";
  var STATUSES = ["À préparer", "En préparation", "Expédiée", "Livrée", "Annulée"];

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function euro(n) { return Number(n || 0).toFixed(2).replace(".", ",") + " €"; }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function orderTotal(o) {
    return Number(o.total || (o.items || []).reduce(function (s, i) {
      return s + Number(i.qty || 0) * Number(i.price || 0);
    }, 0));
  }
  function paymentLabel(o) {
    var map = { paid: "Payé", pending: "En attente", failed: "Échoué", refunded: "Remboursé" };
    return map[o.paymentStatus] || o.payment || o.paymentStatus || "—";
  }
  function paymentClass(o) {
    if (o.paymentStatus === "paid") return "admin-badge--ok";
    if (o.paymentStatus === "failed" || o.paymentStatus === "refunded") return "admin-badge--danger";
    return "admin-badge--gold";
  }
  function statusSteps(current) {
    var steps = ["À préparer", "En préparation", "Expédiée", "Livrée"];
    if (current === "Annulée") return '<span class="active">Annulée</span>';
    var idx = steps.indexOf(current);
    return steps.map(function (s, i) {
      return '<span class="' + (i <= idx ? "active" : "") + '">' + esc(s) + "</span>";
    }).join("");
  }
  function itemRows(items) {
    return (items || []).map(function (item) {
      return '<tr><td>' + esc(item.name || item.ref) + '</td><td>' + esc(item.qty || 1) + '</td><td>' + euro(item.price) + '</td><td>' + euro(Number(item.qty || 1) * Number(item.price || 0)) + '</td></tr>';
    }).join("") || '<tr><td colspan="4">Aucun article</td></tr>';
  }
  function statusOptions(current) {
    return STATUSES.map(function (status) {
      return '<option value="' + esc(status) + '"' + (status === current ? " selected" : "") + '>' + esc(status) + '</option>';
    }).join("");
  }

  function renderOrders() {
    var search = A.qs("#orderSearch");
    var q = ((search && search.value) || "").toLowerCase();
    var list = orders.filter(function (o) {
      var ok = filter === "all" || (filter === "today" ? o.date === todayStr() : o.status === filter);
      var txt = String((o.id || "") + " " + (o.client || "") + " " + (o.email || "") + " " + (o.status || "") + " " + (o.tracking || "") + " " + (o.carrier || "")).toLowerCase();
      return ok && txt.includes(q);
    });

    A.qs("#orderCards").innerHTML = list.map(function (o) {
      var checkout = o.sumupCheckoutId ? '<small style="color:#baaf97">Checkout SumUp : ' + esc(o.sumupCheckoutId) + '</small>' : '';
      var warning = o.paymentReviewRequired
        ? '<div class="admin-panel" style="margin:10px 0;border-color:#b44"><strong style="color:#ff8f8f">Contrôle remboursement requis</strong><br><small>Cette commande payée a été annulée. Vérifie le remboursement SumUp.</small></div>'
        : '';
      return '<article class="request-card" style="margin-bottom:18px" data-order-card="' + esc(o.id) + '">' +
        '<div class="request-head"><div><h3>' + esc(o.id) + '</h3><p>' + esc(o.date || "") + ' • ' + esc(o.client || "Client") + '<br>' + esc(o.email || "") + '</p>' + checkout + '</div><div style="text-align:right"><strong>' + euro(orderTotal(o)) + '</strong><br><span class="admin-badge ' + paymentClass(o) + '">' + esc(paymentLabel(o)) + '</span></div></div>' +
        '<div class="progress">' + statusSteps(o.status) + '</div>' + warning +
        '<details open><summary style="cursor:pointer;color:#ffe18a;margin-bottom:10px">Articles</summary><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Article</th><th>Qté</th><th>PU</th><th>Total</th></tr></thead><tbody>' + itemRows(o.items) + '</tbody></table></div></details>' +
        '<div class="admin-form-grid" style="margin-top:14px">' +
          '<label>Statut<select data-field="status">' + statusOptions(o.status) + '</select></label>' +
          '<label>Mode de livraison<input data-field="shipping" value="' + esc(o.shipping || "Standard") + '" placeholder="Standard"></label>' +
          '<label>Transporteur<input data-field="carrier" value="' + esc(o.carrier || "") + '" placeholder="La Poste, Mondial Relay..."></label>' +
          '<label>Numéro de suivi<input data-field="tracking" value="' + esc(o.tracking || "") + '" placeholder="Suivi colis"></label>' +
          '<label class="admin-form-wide">Adresse de livraison<textarea data-field="address" rows="2" placeholder="Adresse client">' + esc(o.address || "") + '</textarea></label>' +
          '<label class="admin-form-wide">Note interne<textarea data-field="internalNote" rows="3" placeholder="Visible uniquement dans l’admin">' + esc(o.internalNote || "") + '</textarea></label>' +
        '</div>' +
        '<div class="actions" style="margin-top:14px">' +
          '<button type="button" class="btn btn-primary" data-save="' + esc(o.id) + '">Enregistrer</button> ' +
          (o.sumupCheckoutId ? '<button type="button" class="btn btn-secondary" data-sync="' + esc(o.id) + '">Synchroniser SumUp</button> ' : '') +
          '<button type="button" class="btn btn-secondary" data-doc="' + esc(o.id) + '" data-type="bon">Bon commande</button> ' +
          '<button type="button" class="btn btn-secondary" data-doc="' + esc(o.id) + '" data-type="facture">Facture</button>' +
        '</div><p class="small" data-status-message></p>' +
      '</article>';
    }).join("") || '<div class="admin-panel">Aucune commande.</div>';

    bindOrderActions();
  }

  function cardFor(id) {
    return A.qs('[data-order-card="' + CSS.escape(String(id)) + '"]');
  }

  function payloadFromCard(card) {
    function val(name) {
      var node = card.querySelector('[data-field="' + name + '"]');
      return node ? node.value : "";
    }
    return {
      status: val("status"),
      shipping: val("shipping"),
      carrier: val("carrier"),
      tracking: val("tracking"),
      address: val("address"),
      internalNote: val("internalNote")
    };
  }

  function reloadOrders(messageForId, message) {
    return A.adminFetch("/api/admin/payments/boutique-orders", { cache: "no-store" }).then(function (d) {
      orders = d && d.ok ? (d.orders || []) : [];
      renderOrders();
      if (messageForId) {
        var card = cardFor(messageForId);
        var box = card && card.querySelector("[data-status-message]");
        if (box) box.textContent = message || "Mis à jour.";
      }
    });
  }

  function bindOrderActions() {
    A.qs("#orderCards").querySelectorAll("button[data-save]").forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.dataset.save;
        var card = cardFor(id);
        var msg = card && card.querySelector("[data-status-message]");
        if (!card) return;
        if (msg) msg.textContent = "Enregistrement...";
        btn.disabled = true;
        A.adminFetch("/api/admin/payments/boutique-orders/" + encodeURIComponent(id), {
          method: "PUT",
          body: JSON.stringify(payloadFromCard(card))
        }).then(function (d) {
          if (!d.ok) throw new Error(d.error || "Mise à jour impossible");
          return reloadOrders(id, "Commande mise à jour.");
        }).catch(function (e) {
          if (msg) msg.textContent = e.message || "Mise à jour impossible";
        }).finally(function () { btn.disabled = false; });
      };
    });

    A.qs("#orderCards").querySelectorAll("button[data-sync]").forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.dataset.sync;
        var card = cardFor(id);
        var msg = card && card.querySelector("[data-status-message]");
        if (msg) msg.textContent = "Synchronisation SumUp...";
        btn.disabled = true;
        A.adminFetch("/api/admin/payments/boutique-orders/" + encodeURIComponent(id) + "/sync-sumup", {
          method: "POST",
          body: "{}"
        }).then(function (d) {
          if (!d.ok) throw new Error(d.error || "Synchronisation impossible");
          return reloadOrders(id, "SumUp synchronisé : " + (d.status || "OK") + ".");
        }).catch(function (e) {
          if (msg) msg.textContent = e.message || "Synchronisation impossible";
        }).finally(function () { btn.disabled = false; });
      };
    });

    A.qs("#orderCards").querySelectorAll("button[data-doc]").forEach(function (btn) {
      btn.onclick = function () {
        window.open("document-commande.html?id=" + encodeURIComponent(btn.dataset.doc) + "&type=" + encodeURIComponent(btn.dataset.type), "_blank");
      };
    });
  }

  A.renderShell(
    "orders",
    "Commandes Boutique",
    "Préparation, livraison, suivi et contrôle des paiements SumUp",
    '<div class="admin-kpi-grid" style="margin-bottom:16px">' +
      '<div class="admin-kpi"><label>Total commandes</label><strong id="ordersCount">—</strong></div>' +
      '<div class="admin-kpi"><label>À préparer</label><strong id="ordersPrepare">—</strong></div>' +
      '<div class="admin-kpi"><label>Expédiées</label><strong id="ordersShipped">—</strong></div>' +
      '<div class="admin-kpi"><label>CA payé</label><strong id="ordersRevenue">—</strong></div>' +
    '</div>' +
    '<div class="admin-filters"><input id="orderSearch" placeholder="Commande, client, email, suivi..."><button class="btn btn-secondary" type="button" data-filter="all">Toutes</button><button class="btn btn-secondary" type="button" data-filter="today">Aujourd\'hui</button><button class="btn btn-secondary" type="button" data-filter="À préparer">À préparer</button><button class="btn btn-secondary" type="button" data-filter="En préparation">En préparation</button><button class="btn btn-secondary" type="button" data-filter="Expédiée">Expédiées</button><button class="btn btn-secondary" type="button" data-filter="Livrée">Livrées</button><button class="btn btn-secondary" type="button" data-filter="Annulée">Annulées</button></div><div id="orderCards"></div>'
  );

  function updateKpis() {
    var paid = orders.filter(function (o) { return o.paymentStatus === "paid"; });
    A.qs("#ordersCount").textContent = String(orders.length);
    A.qs("#ordersPrepare").textContent = String(orders.filter(function (o) { return o.status === "À préparer"; }).length);
    A.qs("#ordersShipped").textContent = String(orders.filter(function (o) { return o.status === "Expédiée"; }).length);
    A.qs("#ordersRevenue").textContent = euro(paid.reduce(function (sum, o) { return sum + orderTotal(o); }, 0));
  }

  var originalRenderOrders = renderOrders;
  renderOrders = function () {
    updateKpis();
    originalRenderOrders();
  };

  A.qs("#orderSearch").addEventListener("input", renderOrders);
  A.qs(".admin-filters").querySelectorAll("button[data-filter]").forEach(function (btn) {
    btn.onclick = function () { filter = btn.dataset.filter; renderOrders(); };
  });

  reloadOrders();
})();
