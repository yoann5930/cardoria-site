(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var root = document.getElementById("ordersPage");

  function renderLogin() {
    root.innerHTML = "<h1>Mes commandes</h1><div class='panel'><p>Connectez-vous pour consulter uniquement vos commandes.</p><div class='mk-form-grid'><input id='oEmail' type='email' placeholder='Email'><input id='oPassword' type='password' placeholder='Mot de passe'><button class='mk-btn mk-btn-primary' id='oLogin' type='button'>Se connecter</button></div><div id='oMsg'></div></div>";
    document.getElementById("oLogin").onclick = function () { M.login(document.getElementById("oEmail").value.trim(), document.getElementById("oPassword").value).then(load).catch(function (e) { document.getElementById("oMsg").textContent = e.message; }); };
  }
  function renderList(orders) {
    root.innerHTML = "<h1>Mes commandes</h1><p>Compte : <strong>" + M.esc((M.getAccount() || {}).email || "") + "</strong></p><div id='ordersList'></div>";
    var box = document.getElementById("ordersList");
    box.innerHTML = (orders || []).map(function (o) {
      var invUrl = M.BACKEND + "/api/marketplace/v1/orders/" + encodeURIComponent(o.id) + "/invoice";
      return '<article class="mk-order-card"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><div><strong>' + M.esc(o.id) + "</strong><br><span style='color:#baaf97'>" + M.esc(o.listingTitle) + '</span></div><div><span class="mk-status ' + M.statusClass(o.status) + '">' + M.esc(o.status) + "</span>" + (o.paymentStatus ? " • <span style='color:#baaf97'>" + M.esc(o.paymentStatus) + "</span>" : "") + "<br><strong>" + M.euro(o.total) + "</strong></div></div><p style='font-size:13px;color:#baaf97;margin:10px 0 0'>Livraison : " + M.esc(o.shippingCarrier || "—") + (o.shippingTracking ? " • Suivi : " + M.esc(o.shippingTracking) : "") + "</p><button class='mk-btn mk-btn-secondary' style='margin-top:10px' data-invoice='" + M.esc(invUrl) + "'>Facture</button></article>";
    }).join("") || "<div class='panel'>Aucune commande.</div>";
    box.querySelectorAll("button[data-invoice]").forEach(function (btn) { btn.onclick = function () { fetch(btn.dataset.invoice, { headers: M.authHeaders({ Accept: "text/html" }) }).then(function (r) { if (!r.ok) throw new Error("Facture indisponible"); return r.text(); }).then(function (html) { var w = window.open("", "_blank"); if (w) { w.document.open(); w.document.write(html); w.document.close(); } }).catch(function (e) { alert(e.message); }); }; });
  }
  function load() {
    if (!M.getToken()) return renderLogin();
    M.api("/v1/orders").then(function (d) { renderList(d.orders || []); }).catch(function (e) { if (e.status === 401) { M.logout(); renderLogin(); } else root.innerHTML = "<div class='panel'>" + M.esc(e.message) + "</div>"; });
  }
  load();
})();
