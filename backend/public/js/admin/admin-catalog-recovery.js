(function () {
  "use strict";

  var A = window.CardoriaAdmin;
  if (!A || typeof A.adminFetch !== "function") return;

  var RELOAD_KEY = "cardoria_catalog_ready_reload_v1";
  var MAX_WAIT_MS = 4 * 60 * 1000;
  var POLL_MS = 2500;
  var startedAt = Date.now();
  var timer = null;

  function qs(selector) { return document.querySelector(selector); }

  function setLoading(message) {
    var count = qs("#pokemonCount");
    var status = qs("#syncPokemonStatus");
    var body = qs("#catalogBody");
    if (count && /^(0 carte|0 cartes|Catalogue en chargement)/i.test(String(count.textContent || ""))) {
      count.textContent = "Catalogue en chargement…";
    }
    if (status) status.textContent = message || "Initialisation du catalogue Pokémon…";
    if (body && !body.children.length) {
      body.innerHTML = '<tr><td colspan="8">Initialisation du catalogue en cours…</td></tr>';
    }
    ["#syncPokemon", "#syncReference", "#reloadCat"].forEach(function (selector) {
      var button = qs(selector);
      if (button) button.disabled = true;
    });
  }

  function enableButtons() {
    ["#syncPokemon", "#syncReference", "#reloadCat"].forEach(function (selector) {
      var button = qs(selector);
      if (button) button.disabled = false;
    });
  }

  function catalogLooksLoaded() {
    var count = qs("#pokemonCount");
    var total = qs("#catalogTotal");
    var countValue = count ? parseInt(String(count.textContent || "").replace(/\D/g, ""), 10) : 0;
    var totalValue = total ? parseInt(String(total.textContent || "").replace(/\D/g, ""), 10) : 0;
    return countValue > 1000 || totalValue > 1000;
  }

  function hardReloadOnce() {
    if (catalogLooksLoaded()) {
      sessionStorage.removeItem(RELOAD_KEY);
      enableButtons();
      return;
    }
    if (sessionStorage.getItem(RELOAD_KEY) === "done") {
      enableButtons();
      var status = qs("#syncPokemonStatus");
      if (status) status.textContent = "Catalogue prêt. Clique sur Actualiser si nécessaire.";
      return;
    }
    sessionStorage.setItem(RELOAD_KEY, "done");
    location.reload();
  }

  function poll() {
    if (catalogLooksLoaded()) {
      sessionStorage.removeItem(RELOAD_KEY);
      enableButtons();
      return;
    }

    setLoading("Initialisation du moteur catalogue…");
    A.adminFetch("/api/health/startup", { cache: "no-store" }).then(function (health) {
      if (health && health.ready) {
        var status = qs("#syncPokemonStatus");
        if (status) status.textContent = "Catalogue prêt, chargement des cartes…";
        setTimeout(hardReloadOnce, 300);
        return;
      }
      if (Date.now() - startedAt >= MAX_WAIT_MS) {
        enableButtons();
        var status = qs("#syncPokemonStatus");
        if (status) status.textContent = "Le moteur met trop de temps à démarrer. Réessaie dans quelques secondes.";
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    }).catch(function () {
      if (Date.now() - startedAt >= MAX_WAIT_MS) {
        enableButtons();
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    });
  }

  window.addEventListener("beforeunload", function () {
    if (timer) clearTimeout(timer);
  });

  setTimeout(function () {
    if (catalogLooksLoaded()) {
      sessionStorage.removeItem(RELOAD_KEY);
      return;
    }
    poll();
  }, 800);
})();
