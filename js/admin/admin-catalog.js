(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  var selectedId = null;
  var licenses = [];

  function loadLicenses() {
    return A.adminFetch("/api/admin/engine/licenses").then(function (d) {
      licenses = d.licenses || [];
      var opts = licenses.map(function (l) {
        return '<option value="' + l.slug + '">' + l.name + "</option>";
      }).join("");
      A.qs("#licSelect").innerHTML = opts;
      A.qs("#cardLicense").innerHTML = opts;
      var pokemon = licenses.find(function (l) { return l.slug === "pokemon"; });
      var count = A.qs("#pokemonCount");
      if (count) count.textContent = pokemon ? String(pokemon.cardCount || 0) + " cartes Pokémon" : "0 carte Pokémon";
    });
  }

  function renderCards(cards, pagination) {
    A.qs("#catalogBody").innerHTML = (cards || []).map(function (c) {
      return "<tr><td>" + c.name + "</td><td>" + c.license + "</td><td>" + c.extension + "</td><td>" + c.number + "</td><td>" + A.euro(c.prices.recommended) + "</td><td>" +
        '<button type="button" class="btn btn-secondary" data-edit="' + c.id + '">Modifier</button> ' +
        '<button type="button" class="btn btn-secondary" data-del="' + c.id + '">Supprimer</button></td></tr>';
    }).join("") || "<tr><td colspan='6'>Aucune carte</td></tr>";

    var total = A.qs("#catalogTotal");
    if (total) total.textContent = pagination ? String(pagination.total || 0) + " fiche(s) dans la base" : "";

    A.qs("#catalogBody").querySelectorAll("[data-edit]").forEach(function (btn) {
      btn.onclick = function () { editCard(btn.dataset.edit); };
    });
    A.qs("#catalogBody").querySelectorAll("[data-del]").forEach(function (btn) {
      btn.onclick = function () {
        if (confirm("Supprimer cette carte ?")) {
          A.adminFetch("/api/admin/engine/cards/" + btn.dataset.del, { method: "DELETE" }).then(loadCatalog);
        }
      };
    });
  }

  function loadCatalog() {
    var q = A.qs("#catSearch").value;
    A.adminFetch("/api/admin/engine/cards?q=" + encodeURIComponent(q) + "&limit=100").then(function (d) {
      if (d.ok) renderCards(d.cards, d.pagination);
    });
  }

  function syncPokemon() {
    var button = A.qs("#syncPokemon");
    var status = A.qs("#syncPokemonStatus");
    if (button) button.disabled = true;
    if (status) status.textContent = "Synchronisation des cartes Pokémon en cours…";
    A.adminFetch("/api/admin/engine/sync/pokemon", { method: "POST", body: "{}" }).then(function (d) {
      if (!d.ok) {
        if (status) status.textContent = d.error || "Synchronisation impossible.";
        return;
      }
      if (status) status.textContent = (d.count || d.imported || 0) + " cartes Pokémon synchronisées depuis TCGdex FR.";
      return loadLicenses().then(loadCatalog);
    }).catch(function () {
      if (status) status.textContent = "Synchronisation impossible.";
    }).finally(function () {
      if (button) button.disabled = false;
    });
  }

  function editCard(id) {
    A.adminFetch("/api/admin/engine/cards/" + id).then(function (d) {
      if (!d.ok || !d.card) return;
      var c = d.card;
      selectedId = c.id;
      A.qs("#cardLicense").value = c.license;
      A.qs("#cardName").value = c.name;
      A.qs("#cardExt").value = c.extension;
      A.qs("#cardNum").value = c.number;
      A.qs("#cardRarity").value = c.rarity;
      A.qs("#cardIll").value = c.illustration;
      A.qs("#cardImg").value = c.imageHd;
      A.qs("#cardAvg").value = c.prices.avg;
      A.qs("#cardLow").value = c.prices.low;
      A.qs("#cardHigh").value = c.prices.high;
      A.qs("#formTitle").textContent = "Modifier la carte";
    });
  }

  function resetForm() {
    selectedId = null;
    ["cardName", "cardExt", "cardNum", "cardRarity", "cardIll", "cardImg", "cardAvg", "cardLow", "cardHigh"].forEach(function (id) {
      var el = A.qs("#" + id);
      if (el) el.value = "";
    });
    A.qs("#formTitle").textContent = "Ajouter une carte";
  }

  function saveCard() {
    var body = {
      license: A.qs("#cardLicense").value,
      name: A.qs("#cardName").value,
      extension: A.qs("#cardExt").value,
      number: A.qs("#cardNum").value,
      rarity: A.qs("#cardRarity").value,
      illustration: A.qs("#cardIll").value,
      imageHd: A.qs("#cardImg").value,
      prices: {
        avg: Number(A.qs("#cardAvg").value) || 0,
        low: Number(A.qs("#cardLow").value) || 0,
        high: Number(A.qs("#cardHigh").value) || 0,
        recommended: Number(A.qs("#cardAvg").value) || 0
      }
    };
    var req = selectedId
      ? A.adminFetch("/api/admin/engine/cards/" + selectedId, { method: "PUT", body: JSON.stringify(body) })
      : A.adminFetch("/api/admin/engine/cards", { method: "POST", body: JSON.stringify(body) });
    req.then(function () { resetForm(); loadLicenses(); loadCatalog(); });
  }

  function addLicense() {
    A.adminFetch("/api/admin/engine/licenses", {
      method: "POST",
      body: JSON.stringify({
        slug: A.qs("#licSlug").value,
        name: A.qs("#licName").value,
        icon: A.qs("#licIcon").value || "🃏"
      })
    }).then(function () { loadLicenses(); A.qs("#licSlug").value = ""; A.qs("#licName").value = ""; });
  }

  A.renderShell("catalog", "Base de cartes", "Référentiel central des cartes, licences, extensions et images",
    '<div class="admin-panel"><div class="admin-filters" style="align-items:center">' +
    '<button class="btn btn-primary" type="button" id="syncPokemon">Synchroniser Pokémon</button>' +
    '<strong id="pokemonCount">0 carte Pokémon</strong>' +
    '<span id="syncPokemonStatus" style="color:#baaf97;font-size:13px">Source : TCGdex français</span></div></div>' +
    '<div class="admin-grid-2">' +
    '<div class="admin-panel"><h2 id="formTitle">Ajouter une carte</h2>' +
    '<div class="admin-filters" style="flex-direction:column;align-items:stretch">' +
    '<select id="cardLicense"></select>' +
    '<input id="cardName" placeholder="Nom de la carte">' +
    '<input id="cardExt" placeholder="Extension">' +
    '<input id="cardNum" placeholder="Numéro">' +
    '<input id="cardRarity" placeholder="Rareté">' +
    '<input id="cardIll" placeholder="Illustrateur">' +
    '<input id="cardImg" placeholder="URL image HD">' +
    '<input id="cardAvg" type="number" step="0.01" placeholder="Prix moyen €">' +
    '<input id="cardLow" type="number" step="0.01" placeholder="Prix bas €">' +
    '<input id="cardHigh" type="number" step="0.01" placeholder="Prix haut €">' +
    '<button class="btn btn-primary" type="button" id="saveCard">Enregistrer</button>' +
    '<button class="btn btn-secondary" type="button" id="resetCard">Réinitialiser</button></div></div>' +
    '<div class="admin-panel"><h2>Nouvelle licence</h2>' +
    '<div class="admin-filters" style="flex-direction:column;align-items:stretch">' +
    '<input id="licSlug" placeholder="slug (ex: disney)">' +
    '<input id="licName" placeholder="Nom affiché">' +
    '<input id="licIcon" placeholder="Emoji icône">' +
    '<select id="licSelect" disabled style="opacity:.7"><option>Licences existantes</option></select>' +
    '<button class="btn btn-primary" type="button" id="addLicense">Ajouter la licence</button></div></div></div>' +
    '<div class="admin-panel"><div class="admin-filters"><input id="catSearch" placeholder="Rechercher…" oninput="loadCatalogAdmin()">' +
    '<button class="btn btn-secondary" type="button" id="reloadCat">Actualiser</button><span id="catalogTotal" style="color:#baaf97;font-size:13px"></span></div>' +
    '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Nom</th><th>Licence</th><th>Extension</th><th>N°</th><th>Prix</th><th>Actions</th></tr></thead><tbody id="catalogBody"></tbody></table></div></div>');

  window.loadCatalogAdmin = loadCatalog;
  A.qs("#saveCard").onclick = saveCard;
  A.qs("#resetCard").onclick = resetForm;
  A.qs("#addLicense").onclick = addLicense;
  A.qs("#reloadCat").onclick = loadCatalog;
  A.qs("#syncPokemon").onclick = syncPokemon;

  loadLicenses().then(loadCatalog);
})();
