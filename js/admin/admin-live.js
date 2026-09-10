(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A || !A.protectAdmin()) return;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function providerLabel(provider, ownerRole) {
    var value = String(provider || "").toLowerCase();
    if (value === "sumup") return "SumUp";
    if (value === "paypal") return "PayPal";
    return ownerRole === "seller" ? "PayPal" : "SumUp";
  }

  function renderSessions(sessions) {
    A.qs("#liveBody").innerHTML = (sessions || []).map(function (s) {
      return "<tr>" +
        "<td>" + esc(s.id) + "</td>" +
        "<td>" + esc(s.title) + "</td>" +
        "<td>" + esc(s.ownerRole === "seller" ? "Vendeur" : "Cardoria/Admin") + "<br><small>" + esc(s.ownerId) + "</small></td>" +
        "<td>" + esc(s.status) + "</td>" +
        "<td><strong>" + esc(providerLabel(s.paymentProvider, s.ownerRole)) + "</strong></td>" +
        "<td>" + (s.products || []).map(function (p) { return esc(p.name) + " · " + A.euro(p.price); }).join("<br>") + "</td>" +
        "<td><div class='admin-live-actions'>" +
        "<button class='btn btn-primary' type='button' data-enter-live='" + esc(s.id) + "'>Entrer dans le Live</button> " +
        "<button class='btn btn-secondary' type='button' data-start='" + esc(s.id) + "'>Démarrer</button> " +
        "<button class='btn btn-secondary' type='button' data-stop='" + esc(s.id) + "'>Arrêter</button> " +
        "<button class='btn' type='button' data-cancel='" + esc(s.id) + "'>Annuler</button>" +
        "</div></td>" +
        "</tr>";
    }).join("") || "<tr><td colspan='7'>Aucun Live</td></tr>";

    A.qs("#liveBody").querySelectorAll("[data-enter-live]").forEach(function (btn) {
      btn.onclick = function () {
        var liveWindow = window.open("about:blank", "_blank");
        btn.disabled = true;
        A.adminFetch("/api/admin/live/sessions/" + encodeURIComponent(btn.dataset.enterLive) + "/enter", { method: "POST", body: "{}" })
          .then(function (d) {
            if (!d || d.ok === false) throw new Error((d && d.error) || "Accès Live refusé");
            var access = d.access || {};
            var url = access.url || ("/live.html?session=" + encodeURIComponent(btn.dataset.enterLive));
            if (access.grantToken) url += "#cardoriaAdminGrant=" + encodeURIComponent(access.grantToken);
            var liveUrl = new URL(url, location.origin).href;
            if (liveWindow) liveWindow.location.href = liveUrl;
            else location.assign(liveUrl);
          })
          .catch(function (e) {
            if (liveWindow) {
              try { liveWindow.close(); } catch (err) {}
            }
            alert(e.message);
          })
          .finally(function () { btn.disabled = false; });
      };
    });
    A.qs("#liveBody").querySelectorAll("[data-start]").forEach(function (btn) {
      btn.onclick = function () { A.adminFetch("/api/admin/live/sessions/" + encodeURIComponent(btn.dataset.start) + "/start", { method: "POST", body: "{}" }).then(load).catch(function (e) { alert(e.message); }); };
    });
    A.qs("#liveBody").querySelectorAll("[data-stop]").forEach(function (btn) {
      btn.onclick = function () { A.adminFetch("/api/admin/live/sessions/" + encodeURIComponent(btn.dataset.stop) + "/stop", { method: "POST", body: "{}" }).then(load).catch(function (e) { alert(e.message); }); };
    });
    A.qs("#liveBody").querySelectorAll("[data-cancel]").forEach(function (btn) {
      btn.onclick = function () { A.adminFetch("/api/admin/live/sessions/" + encodeURIComponent(btn.dataset.cancel) + "/cancel", { method: "POST", body: "{}" }).then(load).catch(function (e) { alert(e.message); }); };
    });
  }

  function load() {
    A.adminFetch("/api/admin/live/sessions").then(function (d) { renderSessions(d.sessions || []); }).catch(function (e) {
      A.qs("#liveBody").innerHTML = "<tr><td colspan='7'>" + esc(e.message) + "</td></tr>";
    });
  }

  A.renderShell("live", "Lives Cardoria", "Live Admin = SumUp · Live vendeur = PayPal. Le fournisseur est forcé côté serveur.",
    '<div class="admin-panel"><p>Boutique et Live Cardoria/Admin : SumUp. Marketplace et Live vendeur : PayPal. « Entrer dans le Live » est un accès admin interne : il ne crée aucun paiement et ne contourne pas les frais visiteurs/vendeurs.</p></div>' +
    '<div class="admin-panel"><h2>Créer un Live Cardoria (SumUp)</h2>' +
    '<div class="admin-filters"><input id="liveTitle" placeholder="Titre du Live" value="Live Cardoria">' +
    '<input id="liveProduct" placeholder="Produit / lot" value="Lot Pokémon">' +
    '<input id="livePrice" type="number" min="1" step="0.01" value="19.90">' +
    '<button class="btn btn-primary" type="button" id="liveCreate">Créer et démarrer</button></div></div>' +
    '<div class="admin-panel"><h2>Tous les Lives</h2><table class="admin-table"><thead><tr><th>ID</th><th>Titre</th><th>Propriétaire</th><th>Statut</th><th>Paiement</th><th>Produits</th><th>Actions</th></tr></thead><tbody id="liveBody"></tbody></table></div>');

  A.qs("#liveCreate").onclick = function () {
    var btn = A.qs("#liveCreate");
    btn.disabled = true;
    A.adminFetch("/api/admin/live/sessions", {
      method: "POST",
      body: JSON.stringify({
        title: A.qs("#liveTitle").value,
        ownerRole: "admin",
        products: [{ name: A.qs("#liveProduct").value, price: Number(A.qs("#livePrice").value || 0), qty: 1, stock: 1, mode: "buy_now" }]
      })
    }).then(function (d) {
      return A.adminFetch("/api/admin/live/sessions/" + encodeURIComponent(d.session.id) + "/start", { method: "POST", body: "{}" });
    }).then(load).catch(function (e) { alert(e.message); }).finally(function () { btn.disabled = false; });
  };
  load();
})();
