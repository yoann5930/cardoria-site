(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A) return;

  var refreshRunning = false;
  var lastSignature = "";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function euro(value) {
    var n = Number(value || 0);
    return n > 0 ? A.euro(n) : "Non disponible";
  }
  function dateLabel(value) {
    if (!value) return "—";
    var d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  }
  function change(value) {
    var n = Number(value || 0);
    if (!n) return "0,00 %";
    return (n > 0 ? "▲ +" : "▼ ") + n.toFixed(2).replace(".", ",") + " %";
  }

  function ensureStyles() {
    if (document.getElementById("cardoriaCardPreviewStyles")) return;
    var style = document.createElement("style");
    style.id = "cardoriaCardPreviewStyles";
    style.textContent =
      ".cardoria-card-clickable{cursor:zoom-in}" +
      ".cardoria-card-clickable:hover{opacity:.88}" +
      ".cardoria-card-modal{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.86);display:flex;align-items:center;justify-content:center;padding:24px}" +
      ".cardoria-card-modal[hidden]{display:none}" +
      ".cardoria-card-modal__panel{position:relative;width:min(1050px,96vw);max-height:94vh;overflow:auto;background:#090c12;border:1px solid rgba(212,175,55,.45);border-radius:20px;box-shadow:0 24px 80px rgba(0,0,0,.7);padding:24px}" +
      ".cardoria-card-modal__close{position:absolute;right:16px;top:14px;width:42px;height:42px;border-radius:50%;border:1px solid rgba(212,175,55,.5);background:#111722;color:#fff;font-size:25px;cursor:pointer}" +
      ".cardoria-card-modal__grid{display:grid;grid-template-columns:minmax(260px,420px) 1fr;gap:28px;align-items:start}" +
      ".cardoria-card-modal__image{width:100%;max-height:70vh;object-fit:contain;border-radius:16px;background:#05070a}" +
      ".cardoria-card-modal__title{margin:0 48px 8px 0;color:#ffe18a;font-size:28px}" +
      ".cardoria-card-modal__meta{color:#baaf97;margin-bottom:18px}" +
      ".cardoria-card-modal__price{font-size:32px;font-weight:800;color:#fff8e8;margin:8px 0}" +
      ".cardoria-card-modal__table{width:100%;border-collapse:collapse;margin-top:16px}" +
      ".cardoria-card-modal__table th,.cardoria-card-modal__table td{padding:10px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left}" +
      ".cardoria-card-modal__table th{color:#baaf97;font-weight:500;width:42%}" +
      "@media(max-width:760px){.cardoria-card-modal{padding:10px}.cardoria-card-modal__panel{padding:18px}.cardoria-card-modal__grid{grid-template-columns:1fr}.cardoria-card-modal__image{max-height:52vh}}";
    document.head.appendChild(style);
  }

  function ensureModal() {
    ensureStyles();
    var modal = document.getElementById("cardoriaCardPreview");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "cardoriaCardPreview";
    modal.className = "cardoria-card-modal";
    modal.hidden = true;
    modal.innerHTML = '<div class="cardoria-card-modal__panel" role="dialog" aria-modal="true" aria-label="Détail de la carte"><button type="button" class="cardoria-card-modal__close" aria-label="Fermer">×</button><div id="cardoriaCardPreviewBody"><p>Chargement…</p></div></div>';
    document.body.appendChild(modal);
    modal.querySelector(".cardoria-card-modal__close").onclick = closeModal;
    modal.addEventListener("click", function (event) { if (event.target === modal) closeModal(); });
    return modal;
  }

  function closeModal() {
    var modal = document.getElementById("cardoriaCardPreview");
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = "";
  }

  function openCard(id) {
    if (!id) return;
    var modal = ensureModal();
    var body = document.getElementById("cardoriaCardPreviewBody");
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    body.innerHTML = "<p>Chargement de la carte…</p>";
    A.adminFetch("/api/admin/engine/cards/" + encodeURIComponent(id)).then(function (d) {
      if (!d.ok || !d.card) { body.innerHTML = "<p>Carte introuvable.</p>"; return; }
      var c = d.card, m = c.market || {}, p = c.prices || {};
      var image = c.imageHd || c.imageThumb || "";
      var variants = [];
      if (c.variants && c.variants.holo) variants.push("Holo");
      if (c.variants && c.variants.reverse) variants.push("Reverse Holo");
      if (c.variants && c.variants.firstEdition) variants.push("1re édition");
      body.innerHTML = '<div class="cardoria-card-modal__grid">' +
        '<div>' + (image ? '<img class="cardoria-card-modal__image" src="' + esc(image) + '" alt="' + esc(c.name) + '">' : '<div>Image indisponible</div>') + '</div>' +
        '<div><h2 class="cardoria-card-modal__title">' + esc(c.name) + '</h2>' +
        '<div class="cardoria-card-modal__meta">' + esc(c.extension || "") + (c.number ? ' · #' + esc(c.number) : '') + '</div>' +
        '<div>Valeur marché actuelle</div><div class="cardoria-card-modal__price">' + esc(euro(p.recommended)) + '</div>' +
        '<table class="cardoria-card-modal__table"><tbody>' +
        '<tr><th>Rareté</th><td>' + esc(c.rarity || "—") + '</td></tr>' +
        '<tr><th>Type de hit</th><td>' + esc(c.hitFamily || "Standard") + '</td></tr>' +
        '<tr><th>Variante</th><td>' + esc(variants.join(" · ") || "—") + '</td></tr>' +
        '<tr><th>Prix bas</th><td>' + esc(euro(p.low)) + '</td></tr>' +
        '<tr><th>Moyenne 1 jour</th><td>' + esc(euro(m.avg1)) + '</td></tr>' +
        '<tr><th>Moyenne 7 jours</th><td>' + esc(euro(m.avg7)) + '</td></tr>' +
        '<tr><th>Moyenne 30 jours</th><td>' + esc(euro(m.avg30)) + '</td></tr>' +
        '<tr><th>Variation 7 jours</th><td>' + esc(change(m.change7)) + '</td></tr>' +
        '<tr><th>Variation 30 jours</th><td>' + esc(change(m.change30)) + '</td></tr>' +
        '<tr><th>Source</th><td>' + esc(m.source || "Cardmarket via TCGdex / non disponible") + '</td></tr>' +
        '<tr><th>Dernière mise à jour</th><td>' + esc(dateLabel(m.updatedAt || m.checkedAt)) + '</td></tr>' +
        '</tbody></table>' +
        '<button type="button" class="btn btn-secondary" id="cardoriaModalHistory" style="margin-top:18px">Voir l’historique des prix</button>' +
        '</div></div>';
      var hist = document.getElementById("cardoriaModalHistory");
      if (hist) hist.onclick = function () { closeModal(); var old = document.querySelector('[data-history="' + CSS.escape(id) + '"]'); if (old) { old.click(); document.getElementById("priceHistory")?.scrollIntoView({ behavior: "smooth", block: "start" }); } };
    }).catch(function () { body.innerHTML = "<p>Impossible de charger le détail.</p>"; });
  }

  function visibleIds() {
    var body = document.getElementById("catalogBody");
    if (!body) return [];
    return Array.from(body.querySelectorAll("[data-history]")).map(function (button) { return button.getAttribute("data-history"); }).filter(Boolean).slice(0, 40);
  }

  function markClickable() {
    var body = document.getElementById("catalogBody");
    if (!body) return;
    body.querySelectorAll("tr").forEach(function (row) {
      var cells = row.querySelectorAll("td");
      if (cells[0]) cells[0].classList.add("cardoria-card-clickable");
      if (cells[1]) cells[1].classList.add("cardoria-card-clickable");
    });
  }

  function refreshVisiblePrices() {
    var ids = visibleIds();
    if (!ids.length || refreshRunning) return;
    var signature = ids.join("|");
    if (signature === lastSignature) return;
    lastSignature = signature;
    refreshRunning = true;
    A.adminFetch("/api/admin/engine/market-prices/visible", { method: "POST", body: JSON.stringify({ ids: ids }) }).then(function (d) {
      if (!d.ok || !d.checked) return;
      var status = document.getElementById("syncPokemonStatus");
      if (status && d.priced) status.textContent = d.priced + " valeur(s) marché ajoutée(s) sur les cartes visibles";
      var reload = document.getElementById("reloadCat");
      if (reload) reload.click();
      var market = document.getElementById("marketPriced");
      if (market && d.marketStatus) market.textContent = (d.marketStatus.priced || 0) + " / " + (d.marketStatus.total || 0) + " tarifées";
    }).finally(function () { refreshRunning = false; });
  }

  function enhance() {
    markClickable();
    refreshVisiblePrices();
  }

  document.addEventListener("click", function (event) {
    var body = document.getElementById("catalogBody");
    if (!body || !body.contains(event.target)) return;
    if (event.target.closest("button")) return;
    var cell = event.target.closest("td");
    var row = event.target.closest("tr");
    if (!cell || !row) return;
    var cells = Array.from(row.children);
    if (cells.indexOf(cell) > 1) return;
    var button = row.querySelector("[data-history]");
    if (button) openCard(button.getAttribute("data-history"));
  });

  document.addEventListener("keydown", function (event) { if (event.key === "Escape") closeModal(); });

  var observer = new MutationObserver(function () { setTimeout(enhance, 50); });
  function start() {
    var body = document.getElementById("catalogBody");
    if (!body) { setTimeout(start, 200); return; }
    observer.observe(body, { childList: true, subtree: true });
    enhance();
  }
  start();
})();
