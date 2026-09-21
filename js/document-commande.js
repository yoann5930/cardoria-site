(function () {
  "use strict";

  const API = window.CARDORIA_BACKEND || window.location.origin;
  const TOKEN_KEY = "cardoria_session_token";

  function qs(id) { return document.getElementById(id); }
  function euro(value) { return Number(value || 0).toFixed(2).replace(".", ",") + " €"; }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char];
    });
  }
  function lines(value) {
    return esc(value).replace(/\r?\n/g, "<br>");
  }
  function orderTotal(order) {
    const explicit = Number(order?.total);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;
    return (order?.items || []).reduce((sum, item) => sum + Number(item.qty || 1) * Number(item.price || 0), 0);
  }
  function shippingLabel(order) {
    return order?.carrier || order?.shipping || "À renseigner";
  }

  window.toggleMenu = function () {
    qs("menu")?.classList.toggle("open");
  };

  function renderError(title, message) {
    const page = qs("documentPage");
    if (!page) return;
    page.innerHTML =
      '<section class="panel">' +
      '<h1>' + esc(title) + '</h1>' +
      '<p>' + esc(message) + '</p>' +
      '<p class="no-print"><a class="primary" href="/admin-commandes.html">Retour aux commandes</a></p>' +
      '</section>';
  }

  function renderOrder(order, type) {
    const page = qs("documentPage");
    if (!page) return;

    const rows = (order.items || []).map(function (item) {
      const qty = Number(item.qty || 1);
      const price = Number(item.price || 0);
      return '<tr>' +
        '<td>' + esc(item.ref || "") + '</td>' +
        '<td>' + esc(item.name || item.ref || "Article") + '</td>' +
        '<td>' + qty + '</td>' +
        '<td>' + euro(price) + '</td>' +
        '<td>' + euro(qty * price) + '</td>' +
      '</tr>';
    }).join("") || '<tr><td colspan="5">Aucun article.</td></tr>';

    const tracking = order.tracking ? esc(order.tracking) : "Suivi à renseigner";
    const clientAddress = lines(order.address || "");
    const title = type === "facture" ? "FACTURE" : "BON DE COMMANDE";

    page.innerHTML =
      '<section class="panel">' +
        '<div class="request-head">' +
          '<div><h1>' + title + '</h1><p>' + esc(order.id) + '</p></div>' +
          '<img src="/assets/logo/cardoria-premium.png" style="width:130px" alt="Cardoria" onerror="this.onerror=null;this.src=\'/logo-cardoria.jpg\'">' +
        '</div>' +
        '<div class="grid">' +
          '<div><h3>Cardoria</h3><p>Email : Cardoria59330@gmail.com</p></div>' +
          '<div><h3>Client</h3><p>' + esc(order.client || "") + '<br>' + esc(order.email || "") + (clientAddress ? '<br>' + clientAddress : '') + '</p></div>' +
          '<div><h3>Livraison</h3><p>' + esc(shippingLabel(order)) + '<br>' + tracking + '</p></div>' +
        '</div>' +
        '<div class="table-wrap"><table><thead><tr><th>Réf.</th><th>Désignation</th><th>Qté</th><th>Prix</th><th>Total</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<h2>Total : ' + euro(orderTotal(order)) + '</h2>' +
        '<button class="primary no-print" type="button" onclick="window.print()">Imprimer / PDF</button>' +
      '</section>';

    document.title = title + " " + order.id + " | Cardoria";
  }

  async function loadDocument() {
    const page = qs("documentPage");
    if (!page) return;

    const params = new URLSearchParams(window.location.search);
    const id = String(params.get("id") || "").trim();
    const type = params.get("type") === "facture" ? "facture" : "bon";
    if (!id) {
      renderError("Commande introuvable", "Aucun identifiant de commande n'a été fourni.");
      return;
    }

    const token = sessionStorage.getItem(TOKEN_KEY) || "";
    if (!token) {
      renderError("Connexion administrateur requise", "Reconnectez-vous à l'administration pour ouvrir ce document.");
      return;
    }

    page.innerHTML = '<section class="panel"><p>Chargement de la commande ' + esc(id) + '…</p></section>';

    try {
      const response = await fetch(API + "/api/admin/payments/boutique-orders/" + encodeURIComponent(id), {
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
        cache: "no-store"
      });
      const data = await response.json().catch(function () { return {}; });

      if (response.status === 401 || response.status === 403) {
        renderError("Connexion administrateur requise", "Votre session administrateur n'est plus valide.");
        return;
      }
      if (response.status === 404) {
        renderError("Commande introuvable", "La commande " + id + " n'existe pas.");
        return;
      }
      if (!response.ok || !data.ok || !data.order) {
        throw new Error(data.error || "Impossible de charger la commande.");
      }
      if (String(data.order.id) !== id) {
        throw new Error("La commande reçue ne correspond pas à la commande demandée.");
      }

      renderOrder(data.order, type);
    } catch (error) {
      renderError("Document indisponible", error.message || "Impossible de charger la commande.");
    }
  }

  document.addEventListener("DOMContentLoaded", loadDocument);
})();
