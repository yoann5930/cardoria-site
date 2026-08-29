(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A || !A.protectAdmin()) return;

  var selectedId = null;
  var licenses = [];

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function optionList(rows, placeholder) {
    return '<option value="">' + esc(placeholder) + '</option>' + (rows || []).map(function (row) {
      return '<option value="' + esc(row.value) + '">' + esc(row.value) + (row.count != null ? ' (' + row.count + ')' : '') + '</option>';
    }).join('');
  }
  function dateLabel(value) {
    if (!value) return "—";
    var d = new Date(value); if (isNaN(d.getTime())) return esc(value);
    return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  }
  function changeLabel(value) {
    var n = Number(value || 0);
    if (!n) return '<span style="color:#baaf97">0,00 %</span>';
    var arrow = n > 0 ? "▲" : "▼";
    var cls = n > 0 ? "#6bd98f" : "#ff7373";
    return '<strong style="color:' + cls + '">' + arrow + ' ' + esc(n.toFixed(2).replace(".", ",")) + ' %</strong>';
  }
  function holoLabel(c) {
    var v = c.variants || {}, labels = [];
    if (v.holo) labels.push("Holo"); if (v.reverse) labels.push("Reverse"); if (v.firstEdition) labels.push("1re éd.");
    return labels.join(" · ") || "—";
  }

  function loadLicenses() {
    return A.adminFetch("/api/admin/engine/licenses").then(function (d) {
      licenses = d.licenses || [];
      var opts = licenses.map(function (l) { return '<option value="' + esc(l.slug) + '">' + esc(l.name) + '</option>'; }).join('');
      A.qs("#licSelect").innerHTML = opts; A.qs("#cardLicense").innerHTML = opts;
      var pokemon = licenses.find(function (l) { return l.slug === "pokemon"; });
      A.qs("#pokemonCount").textContent = pokemon ? String(pokemon.cardCount || 0) + " cartes Pokémon" : "0 carte Pokémon";
    });
  }
  function loadFacets() {
    return A.adminFetch("/api/admin/engine/catalog/facets?license=pokemon").then(function (d) {
      if (!d.ok) return;
      var rarity=A.qs("#filterRarity"), hit=A.qs("#filterHit"), extension=A.qs("#filterExtension");
      var r=rarity.value,h=hit.value,e=extension.value;
      rarity.innerHTML=optionList(d.rarities||[],"Toutes les raretés"); hit.innerHTML=optionList(d.hitFamilies||[],"Tous les types de hit"); extension.innerHTML=optionList(d.extensions||[],"Toutes les extensions");
      rarity.value=r; hit.value=h; extension.value=e;
    });
  }
  function loadMarketStatus() {
    return A.adminFetch("/api/admin/engine/market-prices/status").then(function (d) {
      if (!d.ok) return;
      A.qs("#marketPriced").textContent = (d.priced || 0) + " / " + (d.total || 0) + " tarifées";
      A.qs("#marketUp").textContent = (d.rising || 0) + " en hausse";
      A.qs("#marketDown").textContent = (d.falling || 0) + " en baisse";
      A.qs("#marketLast").textContent = "Dernière vérification : " + dateLabel(d.lastCheckedAt);
    });
  }

  function renderCards(cards, pagination) {
    A.qs("#catalogBody").innerHTML = (cards || []).map(function (c) {
      var img = c.imageThumb ? '<img src="' + esc(c.imageThumb) + '" alt="" loading="lazy" style="width:54px;height:75px;object-fit:contain;border-radius:6px">' : '—';
      var price = Number(c.prices && c.prices.recommended || 0), market = c.market || {};
      return '<tr>' +
        '<td>' + img + '</td>' +
        '<td><strong>' + esc(c.name) + '</strong><br><small style="color:#baaf97">' + esc(c.extension) + ' #' + esc(c.number) + '</small></td>' +
        '<td>' + esc(c.rarity || '—') + '</td>' +
        '<td><span class="admin-badge admin-badge--gold">' + esc(c.hitFamily || 'Standard') + '</span><br><small>' + esc(holoLabel(c)) + '</small></td>' +
        '<td><strong>' + (price > 0 ? esc(A.euro(price)) : '—') + '</strong><br><small style="color:#baaf97">Bas ' + (Number(c.prices && c.prices.low || 0)>0?esc(A.euro(c.prices.low)):'—') + ' · 7j ' + (Number(market.avg7||0)>0?esc(A.euro(market.avg7)):'—') + ' · 30j ' + (Number(market.avg30||0)>0?esc(A.euro(market.avg30)):'—') + '</small></td>' +
        '<td>' + changeLabel(market.change7) + '<br><small>30j : ' + changeLabel(market.change30) + '</small></td>' +
        '<td><small>' + dateLabel(market.updatedAt || market.checkedAt) + '</small><br><span style="color:#baaf97;font-size:11px">' + esc(market.source || 'Non tarifé') + '</span></td>' +
        '<td><button type="button" class="btn btn-secondary" data-history="' + esc(c.id) + '">Historique</button> <button type="button" class="btn btn-secondary" data-edit="' + esc(c.id) + '">Modifier</button></td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="8">Aucune carte pour ces filtres.</td></tr>';
    A.qs("#catalogTotal").textContent = pagination ? String(pagination.total || 0) + " carte(s)" : "";
    A.qs("#catalogBody").querySelectorAll("[data-edit]").forEach(function (btn) { btn.onclick=function(){editCard(btn.dataset.edit);}; });
    A.qs("#catalogBody").querySelectorAll("[data-history]").forEach(function (btn) { btn.onclick=function(){showHistory(btn.dataset.history);}; });
  }
  function showHistory(id) {
    var box=A.qs("#priceHistory"); box.innerHTML='<p>Chargement de l’historique marché…</p>';
    A.adminFetch("/api/admin/engine/cards/"+encodeURIComponent(id)+"/price-history?limit=30").then(function(d){
      if(!d.ok||!d.history||!d.history.length){box.innerHTML='<h2>Historique des prix</h2><p>Aucun snapshot marché enregistré pour cette carte.</p>';return;}
      box.innerHTML='<h2>Historique des prix Cardmarket</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Date</th><th>Actuel</th><th>Bas</th><th>7 j</th><th>30 j</th></tr></thead><tbody>'+d.history.map(function(x){return '<tr><td>'+dateLabel(x.capturedAt)+'</td><td>'+esc(A.euro(x.current))+'</td><td>'+esc(A.euro(x.low))+'</td><td>'+esc(A.euro(x.avg7))+'</td><td>'+esc(A.euro(x.avg30))+'</td></tr>';}).join('')+'</tbody></table></div>';
    });
  }
  function loadCatalog() {
    var params=new URLSearchParams(); params.set("limit","100"); params.set("q",A.qs("#catSearch").value||""); params.set("rarity",A.qs("#filterRarity").value||""); params.set("hitFamily",A.qs("#filterHit").value||""); params.set("extension",A.qs("#filterExtension").value||""); params.set("variant",A.qs("#filterVariant").value||""); params.set("sort",A.qs("#filterSort").value||"rarity");
    A.adminFetch("/api/admin/engine/cards?"+params.toString()).then(function(d){if(d.ok)renderCards(d.cards,d.pagination);else A.qs("#catalogBody").innerHTML='<tr><td colspan="8">Erreur de chargement.</td></tr>';});
  }
  function syncReference() {
    var button=A.qs("#syncReference"),status=A.qs("#syncPokemonStatus"); button.disabled=true; status.textContent="Actualisation du marché Cardmarket…";
    A.adminFetch("/api/admin/engine/sync/pokemon-reference",{method:"POST",body:JSON.stringify({priceLimit:120,skipRarities:true})}).then(function(d){
      if(!d.ok){status.textContent=d.error||"Actualisation impossible.";return;}
      status.textContent=(d.priced||0)+" tarifs actualisés · "+(d.rising||0)+" hausse · "+(d.falling||0)+" baisse";
      return Promise.all([loadMarketStatus(),loadCatalog()]);
    }).catch(function(){status.textContent="Actualisation impossible.";}).finally(function(){button.disabled=false;});
  }
  function syncPokemon() {
    var button=A.qs("#syncPokemon"),status=A.qs("#syncPokemonStatus"); button.disabled=true; status.textContent="Synchronisation du référentiel Pokémon…";
    A.adminFetch("/api/admin/engine/sync/pokemon",{method:"POST",body:"{}"}).then(function(d){status.textContent=d.ok?(d.count||d.imported||0)+" cartes Pokémon synchronisées.":(d.error||"Synchronisation impossible.");if(d.ok)return loadLicenses().then(loadFacets).then(loadCatalog);}).finally(function(){button.disabled=false;});
  }
  function editCard(id) {
    A.adminFetch("/api/admin/engine/cards/"+encodeURIComponent(id)).then(function(d){if(!d.ok||!d.card)return;var c=d.card;selectedId=c.id;A.qs("#cardLicense").value=c.license;A.qs("#cardName").value=c.name;A.qs("#cardExt").value=c.extension;A.qs("#cardNum").value=c.number;A.qs("#cardRarity").value=c.rarity;A.qs("#cardHit").value=c.hitFamily||"";A.qs("#cardIll").value=c.illustration;A.qs("#cardImg").value=c.imageHd;A.qs("#cardAvg").value=c.prices.avg;A.qs("#cardLow").value=c.prices.low;A.qs("#cardHigh").value=c.prices.high;A.qs("#formTitle").textContent="Modifier la carte";});
  }
  function resetForm(){selectedId=null;["cardName","cardExt","cardNum","cardRarity","cardHit","cardIll","cardImg","cardAvg","cardLow","cardHigh"].forEach(function(id){var el=A.qs("#"+id);if(el)el.value="";});A.qs("#formTitle").textContent="Ajouter une carte";}
  function saveCard(){var body={license:A.qs("#cardLicense").value,name:A.qs("#cardName").value,extension:A.qs("#cardExt").value,number:A.qs("#cardNum").value,rarity:A.qs("#cardRarity").value,hitFamily:A.qs("#cardHit").value,illustration:A.qs("#cardIll").value,imageHd:A.qs("#cardImg").value,prices:{avg:Number(A.qs("#cardAvg").value)||0,low:Number(A.qs("#cardLow").value)||0,high:Number(A.qs("#cardHigh").value)||0,recommended:Number(A.qs("#cardAvg").value)||0}};var req=selectedId?A.adminFetch("/api/admin/engine/cards/"+encodeURIComponent(selectedId),{method:"PUT",body:JSON.stringify(body)}):A.adminFetch("/api/admin/engine/cards",{method:"POST",body:JSON.stringify(body)});req.then(function(){resetForm();return loadFacets().then(loadCatalog);});}
  function addLicense(){A.adminFetch("/api/admin/engine/licenses",{method:"POST",body:JSON.stringify({slug:A.qs("#licSlug").value,name:A.qs("#licName").value,icon:A.qs("#licIcon").value||"🃏"})}).then(function(){loadLicenses();});}

  A.renderShell("catalog","Catalogue de référence","Pokémon : raretés, hits et suivi automatique des prix du marché",
    '<div class="admin-panel"><div class="admin-filters" style="align-items:center"><button class="btn btn-primary" type="button" id="syncPokemon">Synchroniser les cartes</button><button class="btn btn-secondary" type="button" id="syncReference">Actualiser le marché maintenant</button><strong id="pokemonCount">0 carte Pokémon</strong><span id="syncPokemonStatus" style="color:#baaf97;font-size:13px">Marché : Cardmarket via TCGdex</span></div></div>'+
    '<div class="admin-grid-2"><div class="admin-panel"><h2>Suivi marché</h2><p><strong id="marketPriced">0 tarifée</strong> · <span id="marketUp">0 en hausse</span> · <span id="marketDown">0 en baisse</span></p><p id="marketLast" style="color:#baaf97">Dernière vérification : —</p><small style="color:#baaf97">Actualisation automatique par lots toutes les 6 h tant que le service Render est actif.</small></div><div class="admin-panel"><h2>Lecture des prix</h2><p><strong>Actuel</strong> = tendance Cardmarket. Les colonnes 7 j et 30 j servent de référence pour calculer la hausse ou la baisse.</p></div></div>'+
    '<div class="admin-panel"><h2>Filtres du catalogue</h2><div class="admin-filters"><input id="catSearch" placeholder="Nom, numéro, extension…"><select id="filterRarity"><option value="">Toutes les raretés</option></select><select id="filterHit"><option value="">Tous les types de hit</option></select><select id="filterVariant"><option value="">Toutes variantes</option><option value="holo">Holo</option><option value="reverse">Reverse Holo</option></select><select id="filterExtension"><option value="">Toutes les extensions</option></select><select id="filterSort"><option value="rarity">Rareté : plus forte</option><option value="rarity_asc">Rareté : plus faible</option><option value="price">Prix : décroissant</option><option value="price_asc">Prix : croissant</option><option value="extension">Extension / numéro</option><option value="name">Nom</option></select><button class="btn btn-secondary" type="button" id="reloadCat">Actualiser</button><span id="catalogTotal" style="color:#baaf97"></span></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Image</th><th>Carte</th><th>Rareté</th><th>Hit</th><th>Prix marché</th><th>Variation</th><th>Mise à jour</th><th>Action</th></tr></thead><tbody id="catalogBody"></tbody></table></div></div>'+
    '<div class="admin-panel" id="priceHistory"><h2>Historique des prix</h2><p style="color:#baaf97">Clique sur « Historique » sur une carte pour voir ses snapshots de marché.</p></div>'+
    '<div class="admin-grid-2"><div class="admin-panel"><h2 id="formTitle">Ajouter une carte</h2><div class="admin-filters" style="flex-direction:column;align-items:stretch"><select id="cardLicense"></select><input id="cardName" placeholder="Nom"><input id="cardExt" placeholder="Extension"><input id="cardNum" placeholder="Numéro"><input id="cardRarity" placeholder="Rareté officielle"><input id="cardHit" placeholder="Type de hit"><input id="cardIll" placeholder="Illustrateur"><input id="cardImg" placeholder="URL image HD"><input id="cardAvg" type="number" step="0.01" placeholder="Prix moyen €"><input id="cardLow" type="number" step="0.01" placeholder="Prix bas €"><input id="cardHigh" type="number" step="0.01" placeholder="Prix haut €"><button class="btn btn-primary" id="saveCard" type="button">Enregistrer</button><button class="btn btn-secondary" id="resetCard" type="button">Réinitialiser</button></div></div><div class="admin-panel"><h2>Nouvelle licence</h2><div class="admin-filters" style="flex-direction:column;align-items:stretch"><input id="licSlug" placeholder="slug"><input id="licName" placeholder="Nom affiché"><input id="licIcon" placeholder="Emoji"><select id="licSelect" disabled></select><button class="btn btn-primary" id="addLicense" type="button">Ajouter la licence</button></div></div></div>');

  ["catSearch","filterRarity","filterHit","filterVariant","filterExtension","filterSort"].forEach(function(id){A.qs("#"+id).addEventListener(id==="catSearch"?"input":"change",loadCatalog);});
  A.qs("#reloadCat").onclick=loadCatalog;A.qs("#syncPokemon").onclick=syncPokemon;A.qs("#syncReference").onclick=syncReference;A.qs("#saveCard").onclick=saveCard;A.qs("#resetCard").onclick=resetForm;A.qs("#addLicense").onclick=addLicense;
  loadLicenses().then(loadFacets).then(function(){return Promise.all([loadMarketStatus(),loadCatalog()]);});
})();
