(function () {
  "use strict";

  var A = window.CardoriaAdmin;
  if (!A || !A.protectAdmin()) return;

  var roadmap = null;

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function statusLabel(status) {
    if (status === "complete") return "Validée 100 %";
    if (status === "active") return "En cours";
    return "Verrouillée";
  }

  function statusClass(status) {
    if (status === "complete") return "admin-badge--success";
    if (status === "active") return "admin-badge--gold";
    return "";
  }

  function progressBar(progress) {
    return '<div style="height:10px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:8px">' +
      '<div style="height:100%;width:' + progress + '%;background:linear-gradient(90deg,#8f6b00,#ffe18a);transition:width .25s ease"></div></div>';
  }

  function renderSummary() {
    var summary = roadmap.summary || {};
    A.qs("#devOverall").textContent = (summary.overallProgress || 0) + " %";
    A.qs("#devDone").textContent = (summary.completePages || 0) + " / " + (summary.totalPages || 0);
    A.qs("#devActive").textContent = summary.activePageName || "Terminé";
    A.qs("#devOverallBar").innerHTML = progressBar(summary.overallProgress || 0);
  }

  function renderActivePage() {
    var host = A.qs("#devActivePage");
    var page = roadmap.pages.find(function (item) { return item.status === "active"; });
    if (!page) {
      host.innerHTML = '<div class="admin-panel"><h2>Site terminé</h2><p>Toutes les pages de la roadmap sont validées à 100 %.</p></div>';
      return;
    }

    var criteria = (roadmap.criteria || []).map(function (criterion) {
      var checked = page.checks && page.checks[criterion.id] === true;
      return '<label style="display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)">' +
        '<input type="checkbox" data-criterion="' + esc(criterion.id) + '" ' + (checked ? "checked" : "") + ' style="margin-top:3px;transform:scale(1.2)">' +
        '<span>' + esc(criterion.label) + '</span></label>';
    }).join("");

    host.innerHTML = '<div class="admin-panel" style="border:1px solid rgba(212,175,55,.35)">' +
      '<div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap">' +
      '<div><p style="margin:0;color:#baaf97">Page active #' + page.order + '</p><h2 style="margin:4px 0 4px;color:#ffe18a">' + esc(page.name) + '</h2><a href="' + esc(page.path) + '" target="_blank" rel="noopener">Ouvrir la page</a></div>' +
      '<div style="min-width:180px;text-align:right"><strong style="font-size:28px;color:#ffe18a">' + page.progress + ' %</strong>' + progressBar(page.progress) + '</div></div>' +
      '<div style="margin-top:18px">' + criteria + '</div>' +
      '<label style="display:block;margin-top:18px"><span style="display:block;margin-bottom:8px;color:#baaf97">Notes de validation</span><textarea id="devPageNotes" rows="5" style="width:100%" placeholder="Corrections restantes, remarques, preuves de validation…">' + esc(page.notes || "") + '</textarea></label>' +
      '<div class="actions" style="margin-top:16px"><button id="devSavePage" class="btn" type="button">Enregistrer l’avancement</button></div>' +
      '<p style="margin:14px 0 0;color:#baaf97">La page suivante sera automatiquement débloquée uniquement lorsque les ' + page.total + ' critères seront cochés.</p></div>';

    A.qs("#devSavePage").addEventListener("click", saveActivePage);
  }

  function renderPageList() {
    var host = A.qs("#devPageList");
    host.innerHTML = roadmap.pages.map(function (page) {
      var badge = '<span class="admin-badge ' + statusClass(page.status) + '">' + statusLabel(page.status) + '</span>';
      var link = page.unlocked ? '<a href="' + esc(page.path) + '" target="_blank" rel="noopener">Voir</a>' : '<span style="color:#777">Bloquée</span>';
      return '<div class="admin-panel" style="margin-bottom:12px;opacity:' + (page.status === "locked" ? ".62" : "1") + '">' +
        '<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center">' +
        '<div><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><strong>#' + page.order + ' — ' + esc(page.name) + '</strong>' + badge + '</div>' +
        '<div style="color:#baaf97;font-size:13px;margin-top:4px">' + esc(page.path) + '</div>' + progressBar(page.progress) + '</div>' +
        '<div style="text-align:right"><strong>' + page.progress + ' %</strong><div style="margin-top:6px">' + link + '</div></div></div></div>';
    }).join("");
  }

  function render() {
    if (!roadmap) return;
    renderSummary();
    renderActivePage();
    renderPageList();
  }

  function load() {
    A.adminFetch("/api/admin/development/roadmap").then(function (data) {
      if (!data.ok) throw new Error(data.error || "Impossible de charger la roadmap.");
      roadmap = data.roadmap;
      render();
    }).catch(function (error) {
      A.qs("#devActivePage").innerHTML = '<div class="admin-panel"><p class="error">' + esc(error.message) + '</p></div>';
    });
  }

  function saveActivePage() {
    var page = roadmap.pages.find(function (item) { return item.status === "active"; });
    if (!page) return;

    var checks = {};
    A.qs("#devActivePage").querySelectorAll("input[data-criterion]").forEach(function (input) {
      checks[input.dataset.criterion] = input.checked;
    });
    var notes = A.qs("#devPageNotes").value || "";
    var button = A.qs("#devSavePage");
    button.disabled = true;
    button.textContent = "Enregistrement…";

    A.adminFetch("/api/admin/development/roadmap/pages/" + encodeURIComponent(page.id), {
      method: "PUT",
      body: JSON.stringify({ checks: checks, notes: notes })
    }).then(function (data) {
      if (!data.ok) throw new Error(data.error || "Enregistrement impossible.");
      roadmap = data.roadmap;
      render();
    }).catch(function (error) {
      button.disabled = false;
      button.textContent = "Enregistrer l’avancement";
      alert(error.message || "Erreur d’enregistrement.");
    });
  }

  A.renderShell("development", "Développement du site", "Validation stricte page par page jusqu’à 100 %",
    '<div class="admin-kpi-grid">' +
    '<div class="admin-kpi"><label>Progression globale</label><strong id="devOverall">0 %</strong><div id="devOverallBar"></div></div>' +
    '<div class="admin-kpi"><label>Pages terminées</label><strong id="devDone">0 / 0</strong></div>' +
    '<div class="admin-kpi"><label>Page active</label><strong id="devActive" style="font-size:20px">Accueil</strong></div>' +
    '</div>' +
    '<div id="devActivePage" style="margin-top:20px"><div class="admin-panel">Chargement…</div></div>' +
    '<div class="admin-panel" style="margin-top:20px"><h2 style="margin-top:0">Ordre de réalisation</h2><p style="color:#baaf97">Aucune page suivante ne doit être commencée avant validation complète de la page courante.</p></div>' +
    '<div id="devPageList"></div>');

  load();
})();
