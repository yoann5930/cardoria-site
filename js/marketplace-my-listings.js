(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var root = document.getElementById("root");
  var seller = M.getSeller();
  if (!M.getToken() || !seller) { root.innerHTML = "<p>Connectez votre compte vendeur sur <a href='vendre.html'>Vendre</a>.</p>"; return; }
  function renderList(listings) {
    var items = (listings || []).map(function (l) {
      var url = l.publicUrl || M.listingUrl(l.id);
      return "<div class='mk-listing-admin' style='padding:12px;border:1px solid rgba(212,175,55,.25);margin:8px 0;border-radius:8px'><strong>" + M.esc(l.title) + "</strong> — " + M.euro(l.price) + " · " + M.esc(l.statusLabel || l.status) + " · Stock " + Number(l.stock || 0) + " <a href='" + M.esc(url) + "'>Voir</a> <button type='button' data-id='" + M.esc(l.id) + "' data-st='suspended'>Suspendre</button> <button type='button' data-id='" + M.esc(l.id) + "' data-st='active'>Publier</button> <button type='button' data-del='" + M.esc(l.id) + "'>Supprimer</button></div>";
    }).join("") || "<p>Aucune annonce.</p>";
    root.innerHTML = "<p>Vendeur : <strong>" + M.esc(seller.displayName) + "</strong> · <a href='vendre.html'>Nouvelle annonce</a> · <a href='espace-vendeur.html'>Espace vendeur</a></p><div id='list'>" + items + "</div>";
    root.querySelectorAll("button[data-st]").forEach(function (btn) { btn.onclick = function () { M.api("/v1/listings/" + encodeURIComponent(btn.dataset.id), { method: "PUT", body: JSON.stringify({ status: btn.dataset.st }) }).then(load).catch(function (e) { alert(e.message); }); }; });
    root.querySelectorAll("button[data-del]").forEach(function (btn) { btn.onclick = function () { if (!confirm("Supprimer cette annonce ?")) return; M.api("/v1/listings/" + encodeURIComponent(btn.dataset.del), { method: "DELETE" }).then(load).catch(function (e) { alert(e.message); }); }; });
  }
  function load() { M.api("/v1/sellers/" + encodeURIComponent(seller.id) + "/listings").then(function (d) { renderList(d.listings || []); }).catch(function (e) { root.innerHTML = "<p>" + M.esc(e.message) + "</p>"; }); }
  load();
})();
