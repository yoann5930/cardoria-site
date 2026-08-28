(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A || !A.protectAdmin()) return;
  var view = String(window.CARDORIA_ACCOUNTING_VIEW || "summary");

  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  function buyerLabel(v){v=String(v||"").toLowerCase();return v==="yoann"?"Yoann":v==="valentin"?"Valentin":"Non attribué";}
  function typeLabel(v){return v==="consumable"?"Consommable":v==="equipment"?"Matériel":v==="pokemon_card"?"Carte Pokémon":"Ancien achat";}
  function unitPriceLabel(p){return p.purchaseType==="pokemon_card"&&p.unitPrice!=null?A.euro(p.unitPrice):"—";}
  function entries(obj){return Object.entries(obj||{}).sort(function(a,b){return Number(b[1]||0)-Number(a[1]||0);});}
  function listMoney(obj, empty){var html=entries(obj).map(function(e){return "<li><strong>"+esc(e[0])+"</strong> : "+A.euro(e[1])+"</li>";}).join("");return html||"<li>"+esc(empty||"Aucune donnée")+"</li>";}

  async function exportData(format, type) {
    try {
      var token = sessionStorage.getItem("cardoria_session_token") || "";
      var res = await fetch(A.BACKEND + "/api/admin/accounting/export?format=" + encodeURIComponent(format) + "&type=" + encodeURIComponent(type), { headers: token ? { Authorization: "Bearer " + token } : {}, cache: "no-store" });
      if (res.status === 401) { A.adminLogout(); return; }
      if (!res.ok) throw new Error("Export impossible");
      var blob = await res.blob(), url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = "cardoria-" + type + "-" + Date.now() + (format === "pdf" ? ".html" : ".csv"); document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){URL.revokeObjectURL(url);},1000);
    } catch (e) { alert(e.message || "Export impossible"); }
  }

  function navCards(active){
    var rows=[
      ["summary","admin-comptabilite.html","Synthèse","Vue financière globale"],
      ["sales","admin-comptabilite-ventes.html","Ventes","Historique et ventilation des ventes"],
      ["purchases","admin-comptabilite-achats.html","Achats & coûts","Dépenses, fournisseurs et acheteurs"],
      ["analysis","admin-comptabilite-analyses.html","Analyses","Résultat et répartition des coûts"]
    ];
    return '<div class="admin-grid-2" style="margin-bottom:18px">'+rows.map(function(r){return '<a href="'+r[1]+'" class="admin-panel" style="display:block;text-decoration:none;'+(r[0]===active?'border-color:rgba(255,225,138,.7);':'')+'"><h3 style="margin:0 0 6px;color:#ffe18a">'+r[2]+'</h3><p class="small" style="margin:0">'+r[3]+'</p></a>';}).join('')+'</div>';
  }

  function renderSales(list) {
    var body=A.qs("#salesBody"); if(!body)return;
    body.innerHTML=(list||[]).map(function(s){return "<tr><td>"+esc(s.date||"—")+"</td><td>"+esc(s.client||"—")+"</td><td>"+esc(s.license||"—")+"</td><td>"+esc(s.seller||"—")+"</td><td><strong>"+A.euro(s.amount)+"</strong></td><td><small>"+esc(s.id||"")+"</small></td></tr>";}).join("")||"<tr><td colspan='6'>Aucune vente enregistrée.</td></tr>";
  }

  function renderPurchases(list) {
    var body=A.qs("#purchasesBody"); if(!body)return;
    body.innerHTML=(list||[]).map(function(p){return "<tr><td>"+esc(p.date||"—")+"</td><td><strong>"+buyerLabel(p.buyer)+"</strong></td><td>"+esc(typeLabel(p.purchaseType))+"</td><td>"+esc(p.seller||"—")+"</td><td>"+esc(p.description||p.license||"—")+"</td><td><strong>"+A.euro(p.amount)+"</strong></td><td>"+unitPriceLabel(p)+"</td><td>"+esc(p.status||"—")+"</td></tr>";}).join("")||"<tr><td colspan='8'>Aucun achat enregistré.</td></tr>";
  }

  function loadStats(callback){A.adminFetch("/api/admin/accounting/stats").then(function(d){if(d&&d.ok)callback(d);});}
  function loadSales(){var q=A.qs("#searchQ")?A.qs("#searchQ").value:"",license=A.qs("#filterLicense")?A.qs("#filterLicense").value:"";A.adminFetch("/api/admin/accounting/sales?q="+encodeURIComponent(q)+"&license="+encodeURIComponent(license)).then(function(d){if(d&&d.ok)renderSales(d.sales);});}
  function loadPurchases(){var q=A.qs("#searchQ")?A.qs("#searchQ").value:"",buyer=A.qs("#filterBuyer")?A.qs("#filterBuyer").value:"";A.adminFetch("/api/admin/accounting/purchases?q="+encodeURIComponent(q)+"&buyer="+encodeURIComponent(buyer)).then(function(d){if(d&&d.ok)renderPurchases(d.purchases);});}

  function summaryView(){
    A.renderShell("accounting-summary","Comptabilité — Synthèse","Vue financière claire de Cardoria",
      navCards("summary")+
      '<div class="admin-kpi-grid"><div class="admin-kpi"><label>Ventes</label><strong id="salesTotal">0,00 €</strong><small>enregistrées</small></div><div class="admin-kpi"><label>Achats</label><strong id="purchasesTotal">0,00 €</strong><small id="purchaseCount">0 achat</small></div><div class="admin-kpi"><label>Résultat brut</label><strong id="netResult">0,00 €</strong><small>ventes − achats</small></div><div class="admin-kpi"><label>Yoann</label><strong id="yoannTotal">0,00 €</strong><small>achats attribués</small></div><div class="admin-kpi"><label>Valentin</label><strong id="valentinTotal">0,00 €</strong><small>achats attribués</small></div></div>'+
      '<div class="admin-grid-2"><div class="admin-panel"><h2>Achats par type</h2><ul id="byType"></ul></div><div class="admin-panel"><h2>Achats par catégorie</h2><ul id="byCategory"></ul></div></div>');
    loadStats(function(d){A.qs("#salesTotal").textContent=A.euro(d.totalSales||0);A.qs("#purchasesTotal").textContent=A.euro(d.cardoriaPurchaseTotal||d.totalPurchases||0);A.qs("#netResult").textContent=A.euro(d.netResult||0);A.qs("#purchaseCount").textContent=(d.purchaseCount||0)+" achat(s)";A.qs("#yoannTotal").textContent=A.euro(d.purchaseByBuyer&&d.purchaseByBuyer.yoann||0);A.qs("#valentinTotal").textContent=A.euro(d.purchaseByBuyer&&d.purchaseByBuyer.valentin||0);A.qs("#byType").innerHTML=listMoney(d.purchaseByType,"Aucun achat");A.qs("#byCategory").innerHTML=listMoney(d.purchaseByCategory,"Aucun achat");});
  }

  function salesView(){
    A.renderShell("accounting-sales","Comptabilité — Ventes","Historique et répartition des ventes",
      navCards("sales")+
      '<div class="admin-filters"><input id="searchQ" placeholder="Client, vendeur, référence…"><select id="filterLicense"><option value="">Toutes licences</option><option value="pokemon">Pokémon</option><option value="yugioh">Yu-Gi-Oh!</option><option value="onepiece">One Piece</option><option value="lorcana">Lorcana</option><option value="magic">Magic</option></select><button class="btn btn-primary" id="expCsv">Export CSV</button><button class="btn btn-secondary" id="expPrint">Export imprimable</button></div>'+
      '<div class="admin-grid-2"><div class="admin-panel"><h2>Par licence</h2><ul id="byLicense"></ul></div><div class="admin-panel"><h2>Par vendeur</h2><ul id="bySeller"></ul></div></div>'+
      '<div class="admin-panel"><h2>Historique des ventes</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Date</th><th>Client</th><th>Licence</th><th>Vendeur</th><th>Montant</th><th>ID</th></tr></thead><tbody id="salesBody"></tbody></table></div></div>');
    A.qs("#searchQ").addEventListener("input",loadSales);A.qs("#filterLicense").addEventListener("change",loadSales);A.qs("#expCsv").onclick=function(){exportData("csv","sales");};A.qs("#expPrint").onclick=function(){exportData("pdf","sales");};
    loadStats(function(d){A.qs("#byLicense").innerHTML=listMoney(d.byLicense,"Aucune vente");A.qs("#bySeller").innerHTML=listMoney(d.bySeller,"Aucune vente");});loadSales();
  }

  function purchasesView(){
    A.renderShell("accounting-purchases","Comptabilité — Achats & coûts","Dépenses, fournisseurs et coûts unitaires",
      navCards("purchases")+
      '<div class="admin-filters"><input id="searchQ" placeholder="Fournisseur, carte, référence…"><select id="filterBuyer"><option value="">Tous les acheteurs</option><option value="yoann">Yoann</option><option value="valentin">Valentin</option><option value="non_attribue">Non attribué</option></select><button class="btn btn-primary" id="expCsv">Export achats CSV</button></div>'+
      '<div class="admin-grid-2"><div class="admin-panel"><h2>Par acheteur</h2><ul id="byBuyer"></ul></div><div class="admin-panel"><h2>Par fournisseur</h2><ul id="bySupplier"></ul></div></div>'+
      '<div class="admin-panel"><h2>Historique des achats</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Date</th><th>Acheteur</th><th>Type</th><th>Fournisseur</th><th>Description</th><th>Montant</th><th>Prix / carte</th><th>Statut</th></tr></thead><tbody id="purchasesBody"></tbody></table></div></div>');
    A.qs("#searchQ").addEventListener("input",loadPurchases);A.qs("#filterBuyer").addEventListener("change",loadPurchases);A.qs("#expCsv").onclick=function(){exportData("csv","purchases");};
    loadStats(function(d){A.qs("#byBuyer").innerHTML=listMoney(d.purchaseByBuyer,"Aucun achat");A.qs("#bySupplier").innerHTML=listMoney(d.purchaseBySeller,"Aucun fournisseur");});loadPurchases();
  }

  function analysisView(){
    A.renderShell("accounting-analysis","Comptabilité — Analyses","Répartition des coûts et résultat enregistré",
      navCards("analysis")+
      '<div class="admin-kpi-grid"><div class="admin-kpi"><label>Chiffre enregistré</label><strong id="salesTotal">0,00 €</strong></div><div class="admin-kpi"><label>Coûts achats</label><strong id="purchasesTotal">0,00 €</strong></div><div class="admin-kpi"><label>Résultat brut</label><strong id="netResult">0,00 €</strong><small>hors charges/frais non enregistrés ici</small></div><div class="admin-kpi"><label>Taux achats / ventes</label><strong id="costRate">—</strong></div></div>'+
      '<div class="admin-grid-2"><div class="admin-panel"><h2>Coûts par type</h2><ul id="byType"></ul></div><div class="admin-panel"><h2>Coûts par catégorie</h2><ul id="byCategory"></ul></div></div>'+
      '<div class="admin-grid-2"><div class="admin-panel"><h2>Coûts par fournisseur</h2><ul id="bySupplier"></ul></div><div class="admin-panel"><h2>Ventes par licence</h2><ul id="byLicense"></ul></div></div>');
    loadStats(function(d){var sales=Number(d.totalSales||0),purchases=Number(d.cardoriaPurchaseTotal||d.totalPurchases||0);A.qs("#salesTotal").textContent=A.euro(sales);A.qs("#purchasesTotal").textContent=A.euro(purchases);A.qs("#netResult").textContent=A.euro(Number(d.netResult||0));A.qs("#costRate").textContent=sales>0?(purchases/sales*100).toFixed(1).replace(".",",")+" %":"—";A.qs("#byType").innerHTML=listMoney(d.purchaseByType);A.qs("#byCategory").innerHTML=listMoney(d.purchaseByCategory);A.qs("#bySupplier").innerHTML=listMoney(d.purchaseBySeller);A.qs("#byLicense").innerHTML=listMoney(d.byLicense);});
  }

  if(view==="sales")salesView();else if(view==="purchases")purchasesView();else if(view==="analysis")analysisView();else summaryView();
})();
