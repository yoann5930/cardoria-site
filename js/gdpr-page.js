(function () {
  "use strict";
  var BACKEND = window.location.origin;
  var TOKEN_KEY = "cardoria_session_token";
  function token() { return localStorage.getItem(TOKEN_KEY) || ""; }
  function headers() { var h = { "Content-Type": "application/json" }; if (token()) h.Authorization = "Bearer " + token(); return h; }
  function requireLogin() { if (token()) return true; alert("Connectez-vous à votre compte Cardoria avant une demande RGPD."); return false; }

  document.addEventListener("DOMContentLoaded", function () {
    var exportBtn = document.getElementById("gdprExport");
    var deleteBtn = document.getElementById("gdprDelete");
    if (!exportBtn) return;
    var emailInput = document.getElementById("gdprEmail");
    if (emailInput) { emailInput.disabled = true; emailInput.placeholder = "L'email du compte connecté sera utilisé"; }

    exportBtn.onclick = function () {
      if (!requireLogin()) return;
      fetch(BACKEND + "/api/gdpr/export", { method: "POST", headers: headers(), body: "{}" })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.ok) throw new Error(d.error || "Erreur export."); return d; }); })
        .then(function (d) { var blob = new Blob([JSON.stringify(d.data, null, 2)], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "cardoria-donnees-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000); })
        .catch(function (e) { alert(e.message); });
    };

    deleteBtn.onclick = function () {
      if (!requireLogin()) return;
      var confirm = document.getElementById("gdprDeleteConfirm").value.trim();
      if (confirm !== "SUPPRIMER") { alert("Tapez SUPPRIMER pour confirmer."); return; }
      fetch(BACKEND + "/api/gdpr/delete", { method: "POST", headers: headers(), body: JSON.stringify({ confirm: confirm }) })
        .then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.ok) throw new Error(d.error || "Erreur suppression."); return d; }); })
        .then(function () { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem("cardoria_account"); alert("Demande de suppression enregistrée."); })
        .catch(function (e) { alert(e.message); });
    };
  });
})();
