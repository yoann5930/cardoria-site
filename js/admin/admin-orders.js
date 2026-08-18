(function () {
  "use strict";

  var A = window.CardoriaAdmin;
  if (!A || !A.protectAdmin()) return;

  var orders = [];
  var filter = "all";

  function euro(n) {
    return Number(n || 0).toFixed(2).replace(".", ",") + " €";
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function normalizeItems(items, fallbackAmount, fallbackDescription) {
    if (Array.isArray(items) && items.length) {
      return items.map(function (item, index) {
        return {
          ref: item.ref || item.id || item.listingId || "ITEM-" + (index + 1),
          name: item.name || item.title || item.description || "Article",
          qty: Number(item.qty || item.quantity || 1),
          price: Number(item.price || item.unitPrice || item.unit_price || 0)
        };
      });
    }
    return [{
      ref: "PAYMENT",
      name: fallbackDescription || "Commande Cardoria",
      qty: 1,
      price: Number(fallbackAmount || 0)
    }];
  }

  function marketStatus(status) {
    var map = {
      pending: "Paiement en attente",
      paid: "À préparer",
      preparing: "En préparation",
      shipped: "Expédiée",
      delivered: "Livrée",
      cancelled: "Annulée",
      refunded: "Remboursée"
    };
    return map[status] || status || "À préparer";
  }

  function paymentStatus(status) {
    var map = {
      pending: "Paiement en attente",
      paid: "À préparer",
      failed: "Paiement échoué",
      refunded: "Remboursée"
    };
    return map[status] || status || "Paiement en attente";
  }

  function mapMarketplaceOrder(o) {
    return {
      id: o.id,
      date: (o.createdAt || "").slice(0, 10),
      createdAt: o.createdAt || "",
      client: o.buyerName || "Client",
      email: o.buyerEmail || "",
      address: o.shippingAddress || "",
      items: normalizeItems([{ ref: o.listingId, name: o.listingTitle, qty: o.qty, price: o.unitPrice }]),
      total: Number(o.total || 0),
      payment: o.paymentStatus || "pending",
      status: marketStatus(o.status),
      shipping: o.shippingCarrier || "À définir",
      tracking: o.shippingTracking || "",
      source: "Marketplace"
    };
  }

  function mapPayment(p) {
    var meta = p.metadata || {};
    var items = meta.items || meta.cart || meta.products || [];
    return {
      id: p.orderId || p.id,
      date: (p.createdAt || "").slice(0, 10),
      createdAt: p.createdAt || "",
      client: p.customerName || "Client",
      email: p.customerEmail || "",
      address: meta.shippingAddress || meta.address || "",
      items: normalizeItems(items, p.amount, p.description),
      total: Number(p.amount || 0),
      payment: p.status || "pending",
      status: paymentStatus(p.status),
      shipping: meta.shipping || meta.shippingCarrier || "À définir",
      tracking: meta.tracking || meta.shippingTracking || "",
      source: p.source === "boutique" ? "Boutique" : (p.source || "Paiement")
    };
  }

  function orderTotal(o) {
    if (Number.isFinite(Number(o.total)) && Number(o.total) > 0) return Number(o.total);
    return (o.items || []).reduce(function (sum, item) {
      return sum + Number(item.qty || 0) * Number(item.price || 0);
    }, 0);
  }

  function statusSteps(current) {
    var steps = ["À préparer", "En préparation", "Expédiée", "Livrée", "Facturée"];
    var idx = steps.indexOf(current);
    if (idx === -1) return '<span class="active">' + esc(current) + "</span>";
    return steps.map(function (s, i) {
      return '<span class="' + (i <= idx ? "active" : "") + '">' + esc(s) + "</span>";
    }).join("");
  }

  function renderOrders() {
    var searchInput = A.qs("#orderSearch");
    var cards = A.qs("#orderCards");
    if (!searchInput || !cards) return;

    var q = (searchInput.value || "").toLowerCase();
    var list = orders.filter(function (o) {
      var ok = filter === "all" || (filter === "today" ? o.date === todayStr() : o.status === filter);
      var text = [o.id, o.client, o.email, o.status, o.tracking, o.source].join(" ").toLowerCase();
      return ok && text.includes(q);
    });

    cards.innerHTML = list.map(function (o, index) {
      return '<article class="request-card" style="margin-bottom:16px">' +
        '<div class="request-head"><div><h3>' + esc(o.id) + "</h3><p>" + esc(o.date) + " • " + esc(o.client) + "<br>" + esc(o.email) +
        '<br><span class="admin-badge">' + esc(o.source) + '</span></p></div><strong>' + euro(orderTotal(o)) + "</strong></div>" +
        '<div class="progress">' + statusSteps(o.status) + "</div>" +
        "<p><b>Livraison :</b> " + esc(o.shipping || "À définir") + " • <b>Suivi :</b> " + esc(o.tracking || "Non renseigné") +
        " • <b>Paiement :</b> " + esc(o.payment || "—") + "</p>" +
        '<div class="actions"><button type="button" class="btn btn-secondary" data-order-index="' + index + '" data-type="bon">Bon commande</button>' +
        '<button type="button" class="btn btn-secondary" data-order-index="' + index + '" data-type="facture">Facture</button></div></article>';
    }).join("") || "<div class='admin-panel'>Aucune commande.</div>";

    cards.querySelectorAll("button[data-order-index]").forEach(function (btn) {
      btn.onclick = function () {
        var visibleOrder = list[Number(btn.dataset.orderIndex)];
        if (visibleOrder) openDocument(visibleOrder, btn.dataset.type || "bon");
      };
    });
  }

  function openDocument(order, type) {
    var title = type === "facture" ? "FACTURE" : "BON DE COMMANDE";
    var rows = (order.items || []).map(function (item) {
      return "<tr><td>" + esc(item.ref) + "</td><td>" + esc(item.name) + "</td><td>" + esc(item.qty) + "</td><td>" + euro(item.price) + "</td><td>" + euro(Number(item.qty || 0) * Number(item.price || 0)) + "</td></tr>";
    }).join("");
    var win = window.open("", "_blank");
    if (!win) return;
    var logo = window.location.origin + "/assets/logo/cardoria-premium.png";
    win.document.open();
    win.document.write('<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>' + title + " " + esc(order.id) + '</title><style>body{font-family:Arial,sans-serif;color:#111;padding:32px;max-width:1000px;margin:auto}header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #222;padding-bottom:18px;margin-bottom:24px}header img{width:130px;max-height:90px;object-fit:contain}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{border:1px solid #bbb;padding:8px;text-align:left}th{background:#eee}.meta{display:grid;grid-template-columns:1fr 1fr;gap:20px}.total{text-align:right;font-size:20px;font-weight:700;margin-top:20px}.actions{margin:24px 0}@media print{.actions{display:none}}</style></head><body>' +
      '<div class="actions"><button onclick="window.print()">Imprimer / PDF</button></div><header><div><h1>' + title + '</h1><p>' + esc(order.id) + " — " + esc(order.date) + '</p></div><img src="' + esc(logo) + '" alt="Cardoria"></header>' +
      '<div class="meta"><div><h3>Client</h3><p>' + esc(order.client) + "<br>" + esc(order.email) + "<br>" + esc(order.address || "") + '</p></div><div><h3>Commande</h3><p>Source : ' + esc(order.source) + "<br>Livraison : " + esc(order.shipping) + "<br>Suivi : " + esc(order.tracking || "Non renseigné") + "<br>Paiement : " + esc(order.payment) + '</p></div></div>' +
      '<table><thead><tr><th>Réf.</th><th>Désignation</th><th>Qté</th><th>Prix</th><th>Total</th></tr></thead><tbody>' + rows + '</tbody></table><p class="total">Total : ' + euro(orderTotal(order)) + '</p></body></html>');
    win.document.close();
  }

  function showLoadError(message) {
    var cards = A.qs("#orderCards");
    if (cards) cards.innerHTML = '<div class="admin-panel"><p class="error">' + esc(message) + "</p></div>";
  }

  function loadOrders() {
    Promise.all([
      A.adminFetch("/api/admin/marketplace/orders"),
      A.adminFetch("/api/admin/payments/?limit=200")
    ]).then(function (results) {
      var marketResult = results[0] || {};
      var paymentResult = results[1] || {};
      if (!marketResult.ok && !paymentResult.ok) {
        throw new Error(marketResult.error || paymentResult.error || "Impossible de charger les commandes.");
      }

      var marketOrders = Array.isArray(marketResult.orders) ? marketResult.orders : [];
      var marketIds = new Set(marketOrders.map(function (o) { return o.id; }));
      var payments = Array.isArray(paymentResult.payments) ? paymentResult.payments : [];

      orders = marketOrders.map(mapMarketplaceOrder)
        .concat(payments.filter(function (p) {
          return !p.orderId || !marketIds.has(p.orderId);
        }).map(mapPayment))
        .sort(function (a, b) {
          return String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date));
        });

      renderOrders();
    }).catch(function (error) {
      showLoadError(error.message || "Erreur de chargement des commandes.");
    });
  }

  A.renderShell("orders", "Commandes", "Commandes réelles Cardoria — Marketplace et paiements SumUp",
    '<div class="admin-filters">' +
    '<input id="orderSearch" placeholder="Rechercher commande...">' +
    '<button class="btn btn-secondary" type="button" data-filter="all">Toutes</button>' +
    '<button class="btn btn-secondary" type="button" data-filter="today">Aujourd\'hui</button>' +
    '<button class="btn btn-secondary" type="button" data-filter="À préparer">À préparer</button>' +
    '<button class="btn btn-secondary" type="button" data-filter="En préparation">En préparation</button>' +
    '<button class="btn btn-secondary" type="button" data-filter="Expédiée">Expédiées</button></div>' +
    '<div id="orderCards"><div class="admin-panel">Chargement des commandes…</div></div>');

  A.qs("#orderSearch").addEventListener("input", renderOrders);
  A.qs(".admin-filters").querySelectorAll("button[data-filter]").forEach(function (btn) {
    btn.onclick = function () {
      filter = btn.dataset.filter;
      renderOrders();
    };
  });

  window.renderOrdersList = renderOrders;
  loadOrders();
})();
