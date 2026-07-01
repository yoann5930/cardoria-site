(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  var selectedId = null;

  function feedbackForm(a) {
    var lr = a.learning || {};
    return "<div class='admin-panel' style='margin-top:14px;padding:12px'>" +
      "<h3 style='color:#ffe18a;margin:0 0 12px'>Feedback apprentissage</h3>" +
      "<div class='admin-filters' style='flex-wrap:wrap;gap:10px'>" +
      '<label>État validé<select id="fbCondition"><option value="">— Identique IA —</option>' +
      "<option>Mint</option><option>Near Mint</option><option>Excellent</option><option>Good</option><option>Played</option><option>Poor</option></select></label>" +
      '<label>Prix acheté €<input type="number" step="0.01" id="fbBuy" placeholder="' + (lr.priceAi?.buyback ?? "") + '"></label>' +
      '<label>Prix revendu €<input type="number" step="0.01" id="fbSell" placeholder="' + (lr.priceAi?.resell ?? "") + '"></label>' +
      '<label>Délai revente (j)<input type="number" id="fbDelay" value="' + (lr.resaleDelayDays ?? "") + '"></label>' +
      '<label>Contrefaçon<select id="fbFake"><option value="">—</option><option value="0">Non</option><option value="1">Oui</option></select></label>' +
      "</div>" +
      '<textarea id="fbReason" rows="3" placeholder="Raison de la correction (obligatoire pour améliorer l\'IA)…" style="width:100%;margin-top:10px"></textarea>' +
      '<textarea id="aiCorrectJson" rows="5" placeholder="Correction JSON detection (optionnel)" style="width:100%;margin-top:8px"></textarea>' +
      "</div>";
  }

  function renderList(analyses) {
    A.qs("#aiList").innerHTML = (analyses || []).map(function (a) {
      var alert = a.suspicionAlert ? '<span class="admin-badge admin-badge--danger">Alerte</span> ' : "";
      var mScore = a.prices?.intelligence?.scores?.overall ?? a.prices?.marketIndex?.cardoriaMarketScore;
      var clientRec = a.prices?.intelligence?.recommendation?.label;
      var score = a.confidenceScore != null ? " — Auth. : " + a.confidenceScore + "%" : "";
      var market = mScore != null ? " — Score : " + mScore + "/100" : "";
      var recTxt = clientRec ? " — Rec. : " + clientRec : "";
      return '<article class="admin-panel" style="margin-bottom:12px;cursor:pointer" data-id="' + a.id + '">' +
        "<h3 style='margin:0 0 6px;color:#ffe18a'>" + a.id + " " + alert + "</h3>" +
        "<p style='font-size:13px;color:#baaf97'>" + a.customerEmail + " • " + (a.detection?.name || "—") + score + market + recTxt +
        " • Statut : " + a.adminStatus + "</p></article>";
    }).join("") || "<div class='admin-panel'>Aucune analyse</div>";

    A.qs("#aiList").querySelectorAll("[data-id]").forEach(function (el) {
      el.onclick = function () { loadDetail(el.dataset.id); };
    });
  }

  function collectFeedback(a) {
    var fake = A.qs("#fbFake")?.value;
    return {
      conditionValidated: A.qs("#fbCondition")?.value || undefined,
      priceActualBuy: A.qs("#fbBuy")?.value ? Number(A.qs("#fbBuy").value) : undefined,
      priceActualSell: A.qs("#fbSell")?.value ? Number(A.qs("#fbSell").value) : undefined,
      resaleDelayDays: A.qs("#fbDelay")?.value ? Number(A.qs("#fbDelay").value) : undefined,
      isCounterfeit: fake === "" ? undefined : fake === "1",
      reason: A.qs("#fbReason")?.value || "",
      detection: (function () {
        var txt = A.qs("#aiCorrectJson")?.value;
        if (!txt) return a.detection;
        try { return JSON.parse(txt); } catch (e) { alert("JSON detection invalide"); throw e; }
      })(),
      prices: a.prices
    };
  }

  function loadDetail(id) {
    selectedId = id;
    A.adminFetch("/api/admin/ai/analyses/" + id).then(function (d) {
      if (!d.ok) return;
      var a = d.analysis;
      var imgs = (a.learning?.images || []).map(function (img) {
        return '<img src="' + A.BACKEND + '/api/admin/ai/analyses/' + id + '/images/' + img.side +
          '" alt="' + img.side + '" style="max-width:120px;border-radius:8px;margin:4px">';
      }).join("");

      A.qs("#aiDetail").innerHTML =
        "<h2 style='color:#ffe18a'>" + a.id + "</h2>" +
        "<p><b>Score authenticité (admin) :</b> " + (a.confidenceScore != null ? a.confidenceScore + "%" : "—") + "</p>" +
        (imgs ? "<div style='margin:10px 0'>" + imgs + "</div>" : "") +
        A.formatAdminPricing(a.prices) +
        feedbackForm(a) +
        "<pre style='background:rgba(0,0,0,.3);padding:12px;border-radius:10px;font-size:12px;overflow:auto;margin-top:10px'>" +
        JSON.stringify(a.detection, null, 2) + "</pre>" +
        (a.feedback?.length ? "<details style='margin-top:10px'><summary style='cursor:pointer;color:#baaf97'>Historique feedback</summary><pre style='font-size:12px;color:#baaf97'>" +
          JSON.stringify(a.feedback, null, 2) + "</pre></details>" : "") +
        "<div class='admin-filters' style='margin-top:14px'>" +
        '<button class="btn btn-primary" type="button" id="aiApprove">Valider</button>' +
        '<button class="btn btn-secondary" type="button" id="aiReject">Refuser</button>' +
        '<button class="btn btn-secondary" type="button" id="aiRetrain">Réentraîner</button>' +
        '<button class="btn btn-primary" type="button" id="aiCorrect">Enregistrer correction</button></div>';

      A.qs("#aiApprove").onclick = function () {
        var fb = collectFeedback(a);
        A.adminFetch("/api/admin/ai/analyses/" + id + "/validate", {
          method: "PUT",
          body: JSON.stringify(Object.assign({ action: "approved", note: fb.reason }, fb))
        }).then(loadAll);
      };
      A.qs("#aiReject").onclick = function () {
        var fb = collectFeedback(a);
        A.adminFetch("/api/admin/ai/analyses/" + id + "/validate", {
          method: "PUT",
          body: JSON.stringify(Object.assign({ action: "rejected", note: fb.reason }, fb))
        }).then(loadAll);
      };
      A.qs("#aiRetrain").onclick = function () {
        A.adminFetch("/api/admin/ai/retrain", { method: "POST" }).then(function (r) {
          alert("Réentraînement : " + (r.examplesAdded || 0) + " exemple(s) intégré(s)");
        });
      };
      A.qs("#aiCorrect").onclick = function () {
        var fb = collectFeedback(a);
        if (!fb.reason) { alert("Indiquez une raison pour améliorer l'IA."); return; }
        A.adminFetch("/api/admin/ai/analyses/" + id + "/feedback", {
          method: "PUT",
          body: JSON.stringify(Object.assign({ action: "corrected", adminNote: fb.reason }, fb))
        }).then(function () { loadAll(); loadDetail(id); });
      };
    });
  }

  function loadAll() {
    A.adminFetch("/api/admin/ai/analyses?limit=80").then(function (d) { if (d.ok) renderList(d.analyses); });
    A.adminFetch("/api/admin/ai/stats").then(function (d) {
      if (!d.ok) return;
      var l = d.learning || {};
      A.qs("#aiStats").innerHTML =
        "Total : " + d.total + " • En attente : " + d.pending + " • Validées : " + d.approved +
        " • Corrigées : " + d.corrected + " • Alertes : " + d.alerts +
        " • Exemples entraînement : " + d.trainingExamples +
        " • Datasets : " + (l.totalRecords || 0) + " • Outcomes : " + (l.withOutcomes || 0);
    });
  }

  A.renderShell("ai", "IA Premium Cardoria", "Validations, feedback et apprentissage continu",
    '<div class="admin-panel"><p id="aiStats">Chargement…</p></div>' +
    '<div class="admin-grid-2"><div class="admin-panel"><h2>Analyses récentes</h2><div id="aiList"></div></div>' +
    '<div class="admin-panel"><h2>Détail & feedback</h2><div id="aiDetail"><p style="color:#baaf97">Sélectionnez une analyse</p></div></div></div>');

  loadAll();
})();
