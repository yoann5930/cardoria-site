(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function renderList(requests) {
    A.qs("#estimationsList").innerHTML = (requests || []).map(function (x) {
      var intel = x.prices?.intelligence;
      var idx = x.prices?.marketIndex;
      var scoreBadge = intel?.scores?.overall != null
        ? " • <b>Score Cardoria :</b> " + intel.scores.overall + "/100"
        : (idx?.cardoriaMarketScore != null ? " • <b>Market Score :</b> " + idx.cardoriaMarketScore + "/100" : "");
      var clientRec = intel?.recommendation?.label;
      var rec = x.prices?.adminRecommendation?.primary?.label;
      var recBadge = clientRec
        ? " • <span class='admin-badge'>" + clientRec + "</span>"
        : (rec ? " • <span class='admin-badge admin-badge--gold'>" + rec + "</span>" : "");
      var auth = x.confidenceScore != null ? "<br><b>Confiance :</b> " + x.confidenceScore + "%" : x.suspicionAlert ? "<br><b>Alerte authenticité</b>" : "";
      return '<article class="admin-panel" style="margin-bottom:14px"><h3 style="margin:0 0 8px;color:#ffe18a">' + x.id + "</h3>" +
        "<p>" + x.customerName + " • " + x.customerEmail + "<br>" + (x.cardGame || "") + " • " + (x.cardName || "") + " • " + (x.condition || "") + scoreBadge + recBadge + auth + "</p>" +
        A.formatAdminPricing(x.prices) +
        '<details style="margin-top:10px"><summary style="cursor:pointer;color:#baaf97">Message client</summary>' +
        '<div style="white-space:pre-wrap;font-size:13px;color:#baaf97;margin-top:8px">' + (x.result || "") + "</div></details></article>";
    }).join("") || "<div class='admin-panel'>Aucune estimation.</div>";
  }

  function loadEstimations() {
    A.qs("#estimationsList").innerHTML = "<div class='admin-panel'>Chargement...</div>";
    A.adminFetch("/api/admin/estimations").then(function (data) {
      if (!data.ok) {
        A.qs("#estimationsList").innerHTML = "<div class='admin-panel'>Erreur : " + (data.error || "Chargement impossible") + "</div>";
        return;
      }
      renderList(data.requests);
    });
  }

  A.renderShell("estimations", "Estimations Cardoria", "Indice marché, rachat, revente et recommandations — admin uniquement",
    '<div class="admin-filters"><button class="btn btn-primary" type="button" id="reloadEst">Actualiser</button></div>' +
    '<div id="estimationsList"></div>');

  A.qs("#reloadEst").onclick = loadEstimations;
  loadEstimations();
})();
