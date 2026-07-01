(function () {
  "use strict";
  var BACKEND = (window.CARDORIA_SEO && CARDORIA_SEO.backendUrl) || "https://cardoria-backend.onrender.com";

  document.addEventListener("DOMContentLoaded", function () {
    var exportBtn = document.getElementById("gdprExport");
    var deleteBtn = document.getElementById("gdprDelete");
    if (!exportBtn) return;

    exportBtn.onclick = function () {
      var email = document.getElementById("gdprEmail").value.trim();
      if (!email) { alert("Indiquez votre email."); return; }
      fetch(BACKEND + "/api/gdpr/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) { alert(d.error || "Erreur export."); return; }
        var blob = new Blob([JSON.stringify(d.data, null, 2)], { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "cardoria-donnees-" + Date.now() + ".json";
        a.click();
      }).catch(function () { alert("Erreur réseau."); });
    };

    deleteBtn.onclick = function () {
      var email = document.getElementById("gdprEmail").value.trim();
      var confirm = document.getElementById("gdprDeleteConfirm").value.trim();
      if (!email) { alert("Indiquez votre email."); return; }
      if (confirm !== "SUPPRIMER") { alert('Tapez SUPPRIMER pour confirmer.'); return; }
      fetch(BACKEND + "/api/gdpr/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, confirm: confirm })
      }).then(function (r) { return r.json(); }).then(function (d) {
        alert(d.ok ? "Demande de suppression enregistrée." : (d.error || "Erreur."));
      }).catch(function () { alert("Erreur réseau."); });
    };
  });
})();
