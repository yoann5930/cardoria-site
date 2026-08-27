(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A || !A.protectAdmin()) return;

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function euro(n) { return Number(n || 0).toFixed(2).replace(".", ",") + " €"; }

  A.renderShell("stock", "Stock", "Stock réel Cardoria relié aux achats et à la boutique",
    '<div class="admin-kpi-grid">' +
      '<div class="admin-kpi"><label>Unités en stock</label><strong id="stockUnits">0</strong></div>' +
      '<div class="admin-kpi"><label>Références</label><strong id="stockRefs">0</strong></div>' +
      '<div class="admin-kpi"><label>En boutique</label><strong id="stockLive">0</strong></div>' +
    '</div>' +
    '<div class="admin-panel"><div class="admin-filters">' +
      '<input id="stockSearch" placeholder="Rechercher nom, extension, numéro...">' +
      '<button class="btn btn-secondary" id="stockSync" type="button">Synchroniser les achats</button>' +
      '<span id="stockMessage" style="color:#baaf97"></span>' +
    '</div></div>' +
    '<div class="admin-panel"><div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
      '<th>Image</th><th>Carte</th><th>Réf.</th><th>Prix achat moy.</th><th>Prix boutique</th><th>Acheté</th><th>Vendu</th><th>Stock</th><th>Boutique</th>' +
    '</tr></thead><tbody id="stockRows"></tbody></table></div></div>');

  function renderStock(items) {
    items = items || [];
    A.qs("#stockUnits").textContent = String(items.reduce(function (s, x) { return s + Number(x.stock || 0); }, 0));
    A.qs("#stockRefs").textContent = String(items.filter(function (x) { return Number(x.stock || 0) > 0; }).length);
    A.qs("#stockLive").textContent = String(items.filter(function (x) { return x.live; }).length);
    A.qs("#stockRows").innerHTML = items.map(function (p) {
      var img = p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy" style="width:54px;height:75px;object-fit:contain;border-radius:6px">' : '—';
      var disabled = Number(p.stock || 0) <= 0 ? ' disabled' : '';
      var button = p.live
        ? '<button type="button" class="btn btn-secondary stockVisibility" data-id="' + esc(p.id) + '" data-live="0"' + disabled + '>CACHER</button>'
        : '<button type="button" class="btn btn-primary stockVisibility" data-id="' + esc(p.id) + '" data-live="1"' + disabled + '>LIVE</button>';
      var state = p.live ? '<strong style="color:#6bd98f">EN BOUTIQUE</strong>' : '<strong style="color:#baaf97">CACHÉE</strong>';
      if (Number(p.stock || 0) <= 0) state = '<strong style="color:#ff7373">RUPTURE</strong>';
      return '<tr>' +
        '<td>' + img + '</td>' +
        '<td><strong>' + esc(p.name) + '</strong><br><small>' + esc(p.extension || '—') + '</small></td>' +
        '<td>' + esc((p.extension || '') + (p.number ? ' #' + p.number : '')) + '</td>' +
        '<td>' + euro(p.averagePurchasePrice) + '</td>' +
        '<td><strong>' + euro(p.salePrice) + '</strong></td>' +
        '<td>' + esc(p.purchased) + '</td>' +
        '<td>' + esc(p.sold) + '</td>' +
        '<td><strong>' + esc(p.stock) + '</strong></td>' +
        '<td>' + state + '<br>' + button + '</td>' +
      '</tr>';
    }).join("") || '<tr><td colspan="9">Aucune carte en stock. Ajoute une carte depuis le catalogue puis enregistre son achat.</td></tr>';

    A.qs("#stockRows").querySelectorAll(".stockVisibility").forEach(function (btn) {
      btn.onclick = async function () {
        btn.disabled = true;
        var live = btn.dataset.live === "1";
        var d = await A.adminFetch("/api/admin/marketplace/cardoria-stock/" + encodeURIComponent(btn.dataset.id) + "/live", {
          method: "PUT",
          body: JSON.stringify({ live: live })
        });
        if (!d.ok) alert(d.error || "Modification impossible");
        await load(false);
      };
    });
  }

  async function load(syncFirst) {
    var msg = A.qs("#stockMessage");
    try {
      if (syncFirst) {
        msg.textContent = "Synchronisation des achats...";
        var sync = await A.adminFetch("/api/admin/marketplace/cardoria-stock/sync", { method: "POST", body: "{}" });
        if (!sync.ok) throw new Error(sync.error || "Synchronisation impossible");
        msg.textContent = (sync.purchasesSynced || 0) + " achat(s) vérifié(s).";
      }
      var q = A.qs("#stockSearch").value || "";
      var d = await A.adminFetch("/api/admin/marketplace/cardoria-stock?q=" + encodeURIComponent(q));
      if (!d.ok) throw new Error(d.error || "Stock indisponible");
      renderStock(d.stock || []);
    } catch (e) {
      msg.textContent = e.message || "Erreur stock";
      renderStock([]);
    }
  }

  A.qs("#stockSync").onclick = function () { load(true); };
  A.qs("#stockSearch").addEventListener("input", function () { load(false); });
  load(true);
})();
