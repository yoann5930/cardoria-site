(function () {
  "use strict";

  function qs(id) { return document.getElementById(id); }

  var params = new URLSearchParams(location.search);
  var sessionId = params.get("session") || "";
  var count = 0;

  function setStatus(message, isError) {
    var el = qs("phonePhotoStatus");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("is-error", !!isError);
  }

  async function refreshStatus() {
    if (!sessionId) {
      setStatus("Lien photo invalide. Re-scanez le QR code affiché sur le PC.", true);
      return false;
    }
    try {
      var response = await fetch("/api/estimation-carte/capture/session/" + encodeURIComponent(sessionId), { cache: "no-store" });
      if (!response.ok) {
        setStatus("Cette session photo a expiré. Générez un nouveau QR code sur le PC.", true);
        return false;
      }
      var data = await response.json();
      count = Number(data.count || 0);
      var counter = qs("phonePhotoCount");
      if (counter) counter.textContent = count + " / 6 photos envoyées";
      var input = qs("phoneCamera");
      if (input) input.disabled = count >= 6;
      if (count >= 6) setStatus("6 photos reçues. Revenez sur le PC pour lancer l'estimation.");
      return true;
    } catch (e) {
      setStatus("Connexion Cardoria impossible.", true);
      return false;
    }
  }

  async function uploadFiles(files) {
    var remaining = Math.max(0, 6 - count);
    var selected = Array.prototype.slice.call(files || [], 0, remaining);
    if (!selected.length) return;

    setStatus("Préparation et envoi des photos…");
    try {
      var images = [];
      for (var i = 0; i < selected.length; i += 1) {
        images.push(await window.CardoriaEstimationImage.fileToOptimizedDataUrl(selected[i]));
      }

      var response = await fetch("/api/estimation-carte/capture/session/" + encodeURIComponent(sessionId) + "/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagesBase64: images })
      });
      var data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Envoi impossible.");

      count = Number(data.count || count);
      setStatus(data.full
        ? "6 photos reçues. Revenez sur le PC pour lancer l'estimation."
        : "Photo reçue sur le PC. Vous pouvez en ajouter une autre.");
      var counter = qs("phonePhotoCount");
      if (counter) counter.textContent = count + " / 6 photos envoyées";
      var input = qs("phoneCamera");
      if (input) {
        input.value = "";
        input.disabled = count >= 6;
      }
    } catch (e) {
      setStatus("Erreur : " + e.message, true);
    }
  }

  function init() {
    var input = qs("phoneCamera");
    if (input) {
      input.addEventListener("change", function () {
        uploadFiles(input.files);
      });
    }
    refreshStatus();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
