(function () {
  "use strict";
  var M = window.CardoriaMarketplace;
  var root = document.getElementById("sellPage");

  function renderForm() {
    root.innerHTML =
      "<h1>Publier une annonce</h1><p style='color:#baaf97'>Vendez vos cartes entre particuliers ou en tant que professionnel.</p>" +
      '<div class="mk-form-grid">' +
      '<input id="sEmail" placeholder="Email vendeur" type="email">' +
      '<input id="sName" placeholder="Nom affiché">' +
      '<select id="sType"><option value="individual">Particulier</option><option value="professional">Professionnel</option></select>' +
      '<input id="sTitle" placeholder="Titre de l\'annonce">' +
      '<select id="sLicense"><option value="pokemon">Pokémon</option><option value="yugioh">Yu-Gi-Oh!</option><option value="onepiece">One Piece</option><option value="lorcana">Lorcana</option><option value="magic">Magic</option><option value="dragonball">Dragon Ball</option><option value="sports">Sports</option></select>' +
      '<input id="sExt" placeholder="Extension / set">' +
      '<input id="sNum" placeholder="Numéro carte">' +
      '<input id="sLang" placeholder="Langue (FR, EN, JP…)">' +
      '<select id="sStatus"><option value="active">Publier en ligne</option><option value="draft">Brouillon</option></select>' +
      '<select id="sCond"><option>NM</option><option>EX</option><option>GD</option><option>LP</option><option>MP</option></select>' +
      '<input id="sPrice" type="number" step="0.01" placeholder="Prix €">' +
      '<input id="sStock" type="number" value="1" placeholder="Stock">' +
      '<label><input type="checkbox" id="sNeg"> Prix négociable</label>' +
      '<textarea id="sDesc" rows="4" placeholder="Description, défauts, envoi…"></textarea>' +
      '<input id="sPhoto" placeholder="URL photo principale">' +
      '<input id="sPhotosExtra" placeholder="URLs photos suppl. (virgules)">' +
      '<button class="mk-btn mk-btn-primary" type="button" id="publishBtn">Publier l\'annonce</button></div>' +
      '<div id="sellResult" style="margin-top:16px"></div>';

    var seller = M.getSeller();
    if (seller) {
      document.getElementById("sEmail").value = seller.email;
      document.getElementById("sName").value = seller.displayName;
    }

    document.getElementById("publishBtn").onclick = function () {
      var body = {
        sellerEmail: document.getElementById("sEmail").value,
        sellerName: document.getElementById("sName").value,
        sellerType: document.getElementById("sType").value,
        title: document.getElementById("sTitle").value,
        license: document.getElementById("sLicense").value,
        extension: document.getElementById("sExt").value,
        number: document.getElementById("sNum").value,
        language: document.getElementById("sLang").value,
        status: document.getElementById("sStatus").value,
        condition: document.getElementById("sCond").value,
        price: Number(document.getElementById("sPrice").value),
        stock: Number(document.getElementById("sStock").value) || 1,
        negotiable: document.getElementById("sNeg").checked,
        description: document.getElementById("sDesc").value,
        photos: [document.getElementById("sPhoto").value]
          .concat((document.getElementById("sPhotosExtra").value || "").split(",").map(function (u) { return u.trim(); }))
          .filter(Boolean)
      };
      fetch(M.BACKEND + "/api/marketplace/v1/listings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) {
          M.setSeller(d.seller);
          var url = d.listing.publicUrl || M.listingUrl(d.listing.id);
          document.getElementById("sellResult").innerHTML = 'Annonce publiée ! <a href="' + url + '">Voir l\'annonce</a> · <a href="mes-annonces.html">Mes annonces</a>';
        } else {
          document.getElementById("sellResult").textContent = "Erreur : " + d.error;
        }
      });
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderForm);
  else renderForm();
})();
