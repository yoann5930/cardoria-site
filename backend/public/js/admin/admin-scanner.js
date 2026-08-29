(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  var selectedId = null;

  function renderScanRow(s) {
    var det = s.detection || {};
    var badge = s.suspicionAlert
      ? '<span class="admin-badge admin-badge--danger">Douteux</span> '
      : '<span class="admin-badge admin-badge--ok">OK</span> ';
    return '<article class="admin-panel" style="margin-bottom:10px;cursor:pointer" data-id="' + s.id + '">' +
      "<h3 style='margin:0 0 6px;color:#ffe18a;font-size:15px'>" + s.id + " " + badge + "</h3>" +
      "<p style='font-size:13px;color:#baaf97'>" + (s.createdAt || "").slice(0, 16).replace("T", " ") +
      " • " + (det.name || "—") + " • " + (s.licenseSlug || det.license || "—") +
      " • Auth. " + (s.confidenceScore != null ? s.confidenceScore + "%" : "—") +
      " • " + (s.processingMs || 0) + " ms</p></article>";
  }

  function renderAdminDetail(s) {
    var a = s.admin || {};
    var det = s.detection || {};
    return "<h2 style='color:#ffe18a'>" + s.id + "</h2>" +
      "<p><b>Client :</b> " + (s.customerEmail || "—") + " • <b>État :</b> " + (s.conditionGrade || "—") + "</p>" +
      "<p><b>Score authenticité :</b> " + (a.authenticityScore != null ? a.authenticityScore + "%" : "—") +
      " • <b>Suspicion :</b> " + (s.suspicionAlert ? "OUI" : "Non") + "</p>" +
      (s.suspicionReasons && s.suspicionReasons.length
        ? "<p><b>Raisons :</b> " + s.suspicionReasons.join(", ") + "</p>" : "") +
      "<table class='admin-table' style='font-size:13px;margin-top:12px'>" +
      "<tr><th>Marché bas</th><td>" + A.euro(a.market?.low) + "</td></tr>" +
      "<tr><th>Marché moyen</th><td>" + A.euro(a.market?.avg) + "</td></tr>" +
      "<tr><th>Marché haut</th><td>" + A.euro(a.market?.high) + "</td></tr>" +
      "<tr><th>Rachat conseillé</th><td>" + A.euro(a.buybackRecommended) + "</td></tr>" +
      "<tr><th>Revente conseillée</th><td>" + A.euro(a.resellRecommended) + "</td></tr>" +
      "<tr><th>Marge</th><td>" + (a.margin != null ? A.euro(a.margin) + " (" + (a.marginPercent || "—") + " %)" : "—") + "</td></tr>" +
      "<tr><th>Score Cardoria</th><td>" + (a.cardoriaScore ?? "—") + " / 100</td></tr>" +
      "<tr><th>Grade probable</th><td>" + (a.probableGrade || "—") + "</td></tr>" +
      "</table>" +
      (a.adminRecommendation?.primary
        ? "<p style='margin-top:10px'><b>Recommandation interne :</b> <span class='admin-badge admin-badge--gold'>" +
          a.adminRecommendation.primary.label + "</span> — " + (a.adminRecommendation.primary.detail || "") + "</p>"
        : "") +
      A.formatCardoriaIntelligence(a.intelligence) +
      "<details style='margin-top:12px'><summary style='cursor:pointer;color:#baaf97'>Détection JSON</summary>" +
      "<pre style='font-size:11px;color:#baaf97;overflow:auto'>" + JSON.stringify(det, null, 2) + "</pre></details>" +
      "<div class='admin-filters' style='margin-top:14px'>" +
      '<button class="btn btn-primary" type="button" data-action="approved">Valider</button>' +
      '<button class="btn btn-secondary" type="button" data-action="corrected">Corriger</button>' +
      '<button class="btn btn-secondary" type="button" data-action="rejected">Rejeter</button></div>' +
      '<textarea id="scanAdminNote" rows="3" placeholder="Note admin…" style="width:100%;margin-top:10px"></textarea>';
  }

  function loadList(filter) {
    var path = filter === "suspicious" ? "/api/admin/scanner/suspicious" : "/api/admin/scanner/scans?limit=40";
    A.adminFetch(path).then(function (d) {
      if (!d.ok) return;
      A.qs("#scanList").innerHTML = (d.scans || []).map(renderScanRow).join("") ||
        "<div class='admin-panel'>Aucun scan</div>";
      A.qs("#scanList").querySelectorAll("[data-id]").forEach(function (el) {
        el.onclick = function () { loadDetail(el.dataset.id); };
      });
    });
  }

  function loadDetail(id) {
    selectedId = id;
    A.adminFetch("/api/admin/scanner/scans/" + id).then(function (d) {
      if (!d.ok) return;
      A.qs("#scanDetail").innerHTML = renderAdminDetail(d.scan);
      A.qs("#scanDetail").querySelectorAll("[data-action]").forEach(function (btn) {
        btn.onclick = function () {
          var note = A.qs("#scanAdminNote").value.trim();
          A.adminFetch("/api/admin/scanner/scans/" + id + "/validate", {
            method: "PUT",
            body: JSON.stringify({ action: btn.dataset.action, note: note })
          }).then(function (r) {
            alert(r.ok ? "Scan mis à jour." : (r.error || "Erreur"));
            loadList();
            loadStats();
          });
        };
      });
    });
  }

  function loadStats() {
    A.adminFetch("/api/admin/scanner/stats").then(function (d) {
      if (!d.ok || !A.qs("#scanStats")) return;
      A.qs("#scanStats").innerHTML = (d.byLicense || []).map(function (r) {
        return "<tr><td>" + r.license + "</td><td>" + r.scans + "</td><td>" + r.suspicious +
          "</td><td>" + r.avgConfidence + "%</td><td>" + r.avgProcessingMs + " ms</td></tr>";
      }).join("") || "<tr><td colspan='5'>Aucune donnée</td></tr>";
    });
  }

  function loadPending() {
    A.adminFetch("/api/admin/scanner/pending-cards").then(function (d) {
      if (!d.ok) return;
      A.qs("#pendingList").innerHTML = (d.pending || []).map(function (p) {
        return "<tr><td>" + p.name + "</td><td>" + p.license + "</td><td>" + p.extension +
          "</td><td>" + p.number + "</td><td>" + p.status + "</td><td>" +
          '<button type="button" class="btn btn-secondary" data-pid="' + p.id + '" data-st="approved">OK</button> ' +
          '<button type="button" class="btn btn-secondary" data-pid="' + p.id + '" data-st="rejected">Refuser</button></td></tr>';
      }).join("") || "<tr><td colspan='6'>Aucune proposition</td></tr>";

      A.qs("#pendingList").querySelectorAll("button").forEach(function (btn) {
        btn.onclick = function () {
          A.adminFetch("/api/admin/scanner/pending-cards/" + btn.dataset.pid, {
            method: "PUT",
            body: JSON.stringify({ status: btn.dataset.st })
          }).then(function () { loadPending(); });
        };
      });
    });
  }

  A.renderShell("scanner", "Scanner Intelligent", "Scans récents, douteux, validations et statistiques par licence",
    '<div class="admin-filters">' +
    '<button class="btn btn-primary" type="button" id="reloadScans">Tous les scans</button>' +
    '<button class="btn btn-secondary" type="button" id="showSuspicious">Scans douteux</button>' +
    '<a class="btn btn-secondary" href="#" id="exportCsv">Export CSV</a></div>' +
    '<div class="admin-layout-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">' +
    '<div id="scanList"></div><div id="scanDetail"><div class="admin-panel">Sélectionnez un scan</div></div></div>' +
    '<div class="admin-panel" style="margin-top:16px"><h3 style="color:#ffe18a">Statistiques par licence</h3>' +
    '<table class="admin-table" style="font-size:13px"><thead><tr><th>Licence</th><th>Scans</th><th>Douteux</th><th>Conf. moy.</th><th>Temps moy.</th></tr></thead><tbody id="scanStats"></tbody></table></div>' +
    '<div class="admin-panel" style="margin-top:16px"><h3 style="color:#ffe18a">Fiches catalogue en attente</h3>' +
    '<table class="admin-table" style="font-size:13px"><thead><tr><th>Carte</th><th>Licence</th><th>Extension</th><th>N°</th><th>Statut</th><th></th></tr></thead><tbody id="pendingList"></tbody></table></div>');

  A.qs("#reloadScans").onclick = function () { loadList("all"); };
  A.qs("#showSuspicious").onclick = function () { loadList("suspicious"); };
  A.qs("#exportCsv").onclick = function (e) {
    e.preventDefault();
    var headers = {
      Authorization: "Bearer " + (sessionStorage.getItem("cardoria_session_token") || ""),
      "x-cardoria-admin-code": sessionStorage.getItem("cardoria_admin_code") || ""
    };
    fetch(A.BACKEND + "/api/admin/scanner/export.csv", { headers: headers })
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "cardoria-scans.csv";
        a.click();
      })
      .catch(function () { alert("Export impossible."); });
  };

  loadList("all");
  loadStats();
  loadPending();
})();
