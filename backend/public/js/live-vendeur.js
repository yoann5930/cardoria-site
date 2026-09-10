(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var root = document.getElementById("root");
  if (!M || !root) return;
  if (!M.getToken() || !M.getSeller()) {
    root.innerHTML = "<p>Connectez votre compte vendeur sur <a href='vendre.html'>Vendre</a>.</p>";
    return;
  }

  function api(path, options) {
    return fetch((window.CARDORIA_BACKEND || window.location.origin) + "/api/live" + path, Object.assign({
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + M.getToken() }
    }, options || {})).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || data.ok === false) throw new Error(data.error || "Erreur Live");
        return data;
      });
    });
  }

  function render(sessions) {
    root.innerHTML =
      "<p><strong>Paiement forcé : PayPal</strong></p>" +
      "<div><input id='lvTitle' placeholder='Titre' value='Live vendeur'><input id='lvProduct' placeholder='Lot' value='Carte Live'><input id='lvPrice' type='number' min='1' step='0.01' value='9.90'> <button type='button' id='lvCreate'>Créer</button></div>" +
      "<h2>Mes Lives</h2>" +
      (sessions || []).map(function (s) {
        return "<div style='border:1px solid rgba(212,175,55,.25);padding:12px;margin:8px 0;border-radius:8px'><strong>" + M.esc(s.title) + "</strong> — " + M.esc(s.status) + " — " + M.esc(s.paymentProvider) +
          "<div style='margin-top:8px'><button type='button' data-start='" + M.esc(s.id) + "'>Démarrer</button> <button type='button' data-stop='" + M.esc(s.id) + "'>Arrêter</button></div></div>";
      }).join("") || "<p>Aucun Live vendeur.</p>";
    var createBtn = document.getElementById("lvCreate");
    createBtn.onclick = function () {
      createBtn.disabled = true;
      api("/seller/sessions", {
        method: "POST",
        body: JSON.stringify({
          title: document.getElementById("lvTitle").value,
          products: [{ name: document.getElementById("lvProduct").value, price: Number(document.getElementById("lvPrice").value || 0), qty: 1, stock: 1 }]
        })
      }).then(load).catch(function (e) { alert(e.message); }).finally(function () { createBtn.disabled = false; });
    };
    root.querySelectorAll("[data-start]").forEach(function (btn) {
      btn.onclick = function () { btn.disabled = true; api("/seller/sessions/" + encodeURIComponent(btn.dataset.start) + "/start", { method: "POST", body: "{}" }).then(load).catch(function (e) { alert(e.message); }).finally(function () { btn.disabled = false; }); };
    });
    root.querySelectorAll("[data-stop]").forEach(function (btn) {
      btn.onclick = function () { btn.disabled = true; api("/seller/sessions/" + encodeURIComponent(btn.dataset.stop) + "/stop", { method: "POST", body: "{}" }).then(load).catch(function (e) { alert(e.message); }).finally(function () { btn.disabled = false; }); };
    });
  }

  function load() {
    api("/seller/sessions").then(function (d) { render(d.sessions || []); }).catch(function (e) { root.innerHTML = "<p>" + M.esc(e.message) + "</p>"; });
  }
  load();
})();
