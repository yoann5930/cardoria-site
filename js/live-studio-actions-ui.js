(function () {
  "use strict";
  var isAdmin = /admin-live\.html$/i.test(location.pathname);
  var A = window.CardoriaAdmin;
  var M = window.CardoriaMarketplace;
  if (isAdmin && !A) return;
  if (!isAdmin && (!M || !M.getToken())) return;
  var selected = "";
  var sessions = [];
  var autoDrawId = "";
  var activityTimer = null;
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function euro(v) {
    return Number(v || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
  }
  function api(path, options) {
    options = options || {};
    if (isAdmin) {
      return A.adminFetch(path, options).then(function (d) {
        if (d && d.ok === false) throw new Error(d.error || "Erreur Live");
        return d;
      });
    }
    var headers = Object.assign({ "Content-Type": "application/json", Authorization: "Bearer " + M.getToken() }, options.headers || {});
    return fetch((window.CARDORIA_BACKEND || location.origin) + path, Object.assign({}, options, { headers: headers })).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok || d.ok === false) throw new Error(d.error || "Erreur Live");
        return d;
      });
    });
  }
  function sellerCatalogProducts(sessionProducts) {
    if (isAdmin || !M || !M.getSeller) return Promise.resolve([]);
    var seller = M.getSeller();
    if (!seller || !seller.id) return Promise.resolve([]);
    var existing = new Set((sessionProducts || []).map(function (p) { return String(p.id); }));
    var all = [];
    function page(n) {
      return M.api("/v1/sellers/" + encodeURIComponent(seller.id) + "/listings?limit=100&page=" + n).then(function (d) {
        var rows = d.listings || [];
        all = all.concat(rows);
        if (rows.length === 100 && n < 50) return page(n + 1);
        return all;
      });
    }
    return page(1).then(function (rows) {
      return rows.filter(function (listing) {
        var status = String(listing.status || "").toLowerCase();
        return !existing.has("MK-" + String(listing.id)) && Number(listing.stock || 0) > 0 && status !== "removed" && status !== "sold";
      }).map(function (listing) {
        return {
          id: "MK-" + String(listing.id),
          name: String(listing.title || "Item vendeur"),
          price: Number(listing.price || 0),
          stock: Math.max(1, Number(listing.stock || 1)),
          qty: Math.max(1, Number(listing.stock || 1)),
          mode: "buy_now",
          durationSeconds: 30,
          shippingWeightGrams: 20,
          catalogOnly: true,
          listingId: String(listing.id),
          description: String(listing.description || ""),
          extension: String(listing.extension || "")
        };
      });
    }).catch(function () { return []; });
  }
  function resolveBoosterUnits(product) {
    if (!product) return Promise.resolve({ unitsPerPackage: 1, packaging: "other", source: "fallback" });
    if (Number(product.unitsPerPackage || 0) > 0) return Promise.resolve({ unitsPerPackage: Number(product.unitsPerPackage), packaging: product.packaging || "other", source: "item" });
    var url=(window.CARDORIA_BACKEND||location.origin)+"/api/live/actions/sealed-units/resolve?name="+encodeURIComponent(product.name||"")+"&extension="+encodeURIComponent(product.extension||"");
    return fetch(url,{headers:{Accept:"application/json"},cache:"no-store"}).then(function(r){return r.json().then(function(d){if(!r.ok||d.ok===false)throw new Error(d.error||"Référence scellée introuvable");return d;});}).catch(function(){return {unitsPerPackage:1,packaging:"other",source:"fallback"};});
  }
  function listPath() { return isAdmin ? "/api/admin/live/sessions" : "/api/live/seller/sessions"; }
  function sessionPath(id) { return isAdmin ? "/api/admin/live/sessions/" + encodeURIComponent(id) : "/api/live/seller/sessions/" + encodeURIComponent(id); }
  function patchPath(id) { return isAdmin ? "/api/admin/live/sessions/" + encodeURIComponent(id) : "/api/live/seller/sessions/" + encodeURIComponent(id); }
  function actionPath(id, suffix) { return isAdmin ? "/api/admin/live/sessions/" + encodeURIComponent(id) + "/actions/" + suffix : "/api/live/actions/seller/" + encodeURIComponent(id) + "/" + suffix; }
  function statePath(id) { return isAdmin ? "/api/admin/live/sessions/" + encodeURIComponent(id) + "/actions" : "/api/live/actions/seller/" + encodeURIComponent(id) + "/state"; }
  function checkoutPath() { return isAdmin ? "/api/admin/live/checkouts" : "/api/live/seller/checkouts"; }
  function prefs() {
    try { return JSON.parse(localStorage.getItem("cardoria-live-studio-prefs") || "{}"); } catch (e) { return {}; }
  }
  function savePref(key, value) {
    var next = prefs();
    next[key] = value;
    localStorage.setItem("cardoria-live-studio-prefs", JSON.stringify(next));
  }
  function host() {
    var existing = document.getElementById("liveActionStudio");
    if (existing) return existing;
    var box = document.createElement("section");
    box.id = "liveActionStudio";
    box.className = "live-studio-stage";
    var parent = isAdmin ? document.querySelector(".admin-main") : document.querySelector("main.page");
    if (parent) parent.appendChild(box);
    return box;
  }
  function modeLabel(mode) {
    return ({ buy_now: "Achat immédiat", auction: "Enchère", flash: "Vente flash", giveaway: "Giveaway", break: "Ouverture / break" })[mode] || mode;
  }
  function currentProduct(session, state) {
    var products = session.products || [];
    var id = String(session.currentLot || (state && state.pinnedProductId) || "");
    var found = products.filter(function (p) { return p.id === id; })[0];
    return found || products[0] || null;
  }
  function postAction(suffix, body) {
    return api(actionPath(selected, suffix), { method: "POST", body: JSON.stringify(body || {}) }).then(loadEditor).catch(function (e) { alert(e.message); });
  }
  function setCurrent(product, alsoPin) {
    if (!selected || !product) return Promise.resolve();
    return api(patchPath(selected), { method: "PATCH", body: JSON.stringify({ currentLot: product.id }) }).then(function () {
      if (alsoPin === false) return loadEditor();
      return postAction("pin", { productId: product.id });
    }).catch(function (e) { alert(e.message); });
  }
  function advance(session, state, sold) {
    var products = session.products || [];
    var current = currentProduct(session, state);
    var index = current ? products.findIndex(function (p) { return p.id === current.id; }) : -1;
    var next = products[index + 1] || products[0];
    if (!next) return alert("Aucun autre lot dans la file.");
    if (sold && current) savePref("lastSoldId", current.id);
    return setCurrent(next, true);
  }
  function openSheet(title, fieldsHtml, onGo) {
    var sheet = document.getElementById("lasSheet");
    if (!sheet) return;
    sheet.hidden = false;
    document.getElementById("lasSheetTitle").textContent = title;
    document.getElementById("lasSheetFields").innerHTML = fieldsHtml;
    document.getElementById("lasSheetGo").onclick = onGo;
    document.getElementById("lasSheetCancel").onclick = function () { sheet.hidden = true; };
  }
  function renderActivity(state, checkouts, session) {
    var viewers = document.getElementById("liveStudioViewers");
    var chat = document.getElementById("liveStudioChat");
    var last = document.getElementById("liveStudioLastSale");
    if (chat) {
      var messages = (state && state.chat) || [];
      chat.innerHTML = messages.slice(-3).map(function (m) {
        return "<div><strong>" + esc(m.name) + "</strong> " + esc(m.message) + "</div>";
      }).join("") || "Aucun message";
    }
    if (last) {
      var paid = (checkouts || []).filter(function (c) {
        var s = String(c.status || "").toLowerCase();
        return s === "paid" || s === "completed" || s === "authorized" || s === "authorised";
      })[0];
      last.textContent = paid ? (esc(paid.productName || "Lot") + " · " + euro(paid.amount)) : "—";
    }
    if (viewers && selected && session && session.status === "live") {
      fetch("/api/live/webrtc/status/" + encodeURIComponent(selected), { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("offline");
        return r.json();
      }).then(function (d) {
        viewers.textContent = String(Number(d.viewers || 0));
      }).catch(function () {});
    } else if (viewers) {
      viewers.textContent = "0";
    }
  }
  function loadEditor() {
    var box = host();
    if (!box) return;
    if (!selected) {
      box.innerHTML = "<div class='live-studio-current'><h2>Produit actuel</h2><p>Créez un Live puis ajoutez des lots dans la file avant de démarrer.</p></div><div class='live-studio-queue'><h2>File suivante</h2><p>Préparez les produits ici. Pendant le Live, utilisez Suivant.</p></div>";
      return;
    }
    api(sessionPath(selected)).then(function (sessionResponse) {
      var session = sessionResponse.session || {};
      return Promise.all([
        Promise.resolve(sessionResponse),
        api(statePath(selected)),
        api(checkoutPath()).catch(function () { return { checkouts: [] }; }),
        sellerCatalogProducts(session.products || [])
      ]);
    }).then(function (r) {
      var session = r[0].session || {};
      var state = r[1].state || {};
      var checkouts = r[2].checkouts || [];
      var products = session.products || [];
      var sellerItems = r[3] || [];
      var selectableProducts = products.concat(sellerItems);
      var current = currentProduct(session, state);
      var stored = prefs();
      var startPrice = current ? Number(current.price || stored.auctionStart || 1) : Number(stored.auctionStart || 1);
      var duration = Number(stored.auctionDuration || 30);
      box.innerHTML = [
        "<div class='live-studio-current'>",
        "<h2>Produit / jeu actuel</h2>",
        current ? ("<div class='live-studio-product'><strong>" + esc(current.name) + "</strong><span>" + esc(modeLabel(current.mode)) + " · " + (current.mode === "giveaway" ? "gratuit" : euro(current.price)) + " · stock " + esc(current.stock) + "</span></div>") : "<p>Aucun lot. Ajoutez-en dans la file avant le direct.</p>",
        "<div class='live-studio-quick live-studio-operator-buttons'>",
        "<button type='button' id='lasPrev' title='Revenir à l’item précédent'>← Précédent</button>",
        "<button type='button' id='lasPin' title='Afficher cet item aux spectateurs'>📌 Épingler</button>",
        "<button type='button' id='lasReplay' title='Remettre cet item comme item actif'>↻ Relancer l’item</button>",
        "<button type='button' id='lasSkip' title='Passer cet item sans lancer de vente'>Passer</button>",
        "<button type='button' id='lasNext' class='is-primary' title='Préparer l’item suivant'>Suivant →</button>",
        "</div>",
        "<p class='live-studio-hint live-studio-command-help'>Les ventes sont validées par l’action réelle (enchère, paiement, giveaway ou jeu). Il n’y a plus de bouton « Vendu » manuel.</p>",
        "<div class='live-studio-game-picker'>",
        "<label><span>1. Item à mettre en jeu</span><select id='lasGameProduct'><option value=''>Choisir un item</option>" +
          (products.length ? "<optgroup label='Items de ce Live'>" + products.map(function (p) { return "<option value='" + esc(p.id) + "'" + (current && current.id === p.id ? " selected" : "") + ">" + esc(p.name) + "</option>"; }).join("") + "</optgroup>" : "") +
          (sellerItems.length ? "<optgroup label='Tous mes items vendeur'>" + sellerItems.map(function (p) { return "<option value='" + esc(p.id) + "'>" + esc(p.name) + " · stock " + esc(p.stock) + "</option>"; }).join("") + "</optgroup>" : "") +
          (!products.length && !sellerItems.length ? "<option value='' disabled>Aucun item disponible</option>" : "") +
          "<option value='__new__'>＋ Ajouter un nouvel item</option></select></label>",
        "<label><span>2. Type de jeu</span><select id='lasGameType'><option value='buy_now'>Vente directe</option><option value='auction'>Enchère</option><option value='flash'>Vente flash</option><option value='box_break'>Box Break</option><option value='energy_game'>Jeu de l’énergie</option><option value='hit_run_ex'>Hit & Run EX</option><option value='hit_run_ar'>Hit & Run AR</option><option value='hit_run_full_art'>Hit & Run Full Art</option><option value='giveaway'>Giveaway</option><option value='giveaway_subscriber'>Giveaway Abonné</option><option value='giveaway_buyer'>Giveaway Acheteur</option><option value='break'>Break personnalisé</option></select></label>",
        "<button type='button' id='lasLaunchPreset' class='is-primary'>Valider / préparer</button>",
        "<p class='live-studio-hint'>Choisissez l’item et le type de jeu. Valider prépare uniquement l’action. Le lancement reste manuel avec le petit bouton →.</p>",
        "</div>",
        "<div class='live-studio-actions' hidden aria-hidden='true'>",
        "<button type='button' id='lasBuyNow'>Vente</button>",
        "<button type='button' id='lasAuction' class='is-primary'>Lancer enchère</button>",
        "<button type='button' id='lasFlash'>Flash</button>",
        "<button type='button' id='lasBreak'>Break</button>",
        "<button type='button' id='lasGiveaway'>Giveaway</button>",
        "<button type='button' id='lasGiveFollow'>Giveaway Abonné</button>",
        "<button type='button' id='lasGiveBuyer' title='Réservé aux acheteurs ayant un paiement validé pendant ce Live.'>Giveaway Acheteur</button>",
        "</div>",
        "<span class='live-studio-sr'>Achat immédiat</span><span class='live-studio-sr'>Enchère</span><span class='live-studio-sr'>Vente flash</span><span class='live-studio-sr'>Ouverture / break</span>",
        "<div id='lasSheet' class='live-studio-sheet' hidden><h3 id='lasSheetTitle'></h3><div id='lasSheetFields'></div><div class='live-studio-quick'><button type='button' id='lasSheetGo'>Valider</button><button type='button' id='lasSheetCancel'>Annuler</button></div></div>",
        "<div id='lasState'></div>",
        "</div>",
        "<div class='live-studio-queue'><h2>File suivante</h2>",
        "<ul class='live-studio-file'>" + (products.map(function (p, i) {
          var active = current && p.id === current.id;
          return "<li class='" + (active ? "is-current" : "") + "'><div>" + (i + 1) + ". " + esc(p.name) + "<br><small>" + esc(modeLabel(p.mode)) + "</small></div><button type='button' data-use-lot='" + esc(p.id) + "'>Relancer</button></li>";
        }).join("") || "<li>File vide</li>") + "</ul>",
        "<details><summary>Ajouter un lot</summary><div class='live-studio-sheet' style='display:grid;gap:8px'><input id='lasName' placeholder='Nom article / lot'><input id='lasPrice' type='number' min='0' step='0.01' placeholder='Prix'><input id='lasStock' type='number' min='1' value='1' placeholder='Stock'><input id='lasShippingWeight' type='number' min='0' max='25000' step='1' value='20' placeholder='Poids expédition par article (g)' title='Poids emballé par article. 20 g par défaut pour les petits envois TCG.'><select id='lasMode'><option value='buy_now'>Achat immédiat</option><option value='auction'>Enchère</option><option value='flash'>Vente flash</option><option value='giveaway'>Giveaway</option><option value='break'>Ouverture / break</option></select><button type='button' id='lasAdd'>Ajouter au Live</button></div></details>",
        "<select id='lasProduct' hidden><option value=''>Choisir un article</option>" + products.map(function (p) {
          return "<option value='" + esc(p.id) + "'" + (current && current.id === p.id ? " selected" : "") + ">" + esc(p.name) + "</option>";
        }).join("") + "</select>",
        "</div>"
      ].join("");
      bindEditor(session, products, selectableProducts, state, current, startPrice, duration);
      showState(state);
      renderActivity(state, checkouts, session);
      if (state.giveaway && state.giveaway.status === "ready_to_draw" && !state.giveaway.winner && autoDrawId !== state.giveaway.id) {
        autoDrawId = state.giveaway.id;
        postAction("giveaway/draw", {});
      }
    }).catch(function (e) {
      box.innerHTML = "<p>" + esc(e.message) + "</p>";
    });
  }
  function bindEditor(session, products, selectableProducts, state, current, startPrice, duration) {
    function needProduct() {
      if (!current) {
        alert("Ajoutez un lot dans la file, puis cliquez Relancer.");
        return null;
      }
      return current;
    }
    document.getElementById("lasPin").onclick = function () {
      var p = needProduct();
      if (!p) return;
      var button = document.getElementById("lasPin");
      if (button) button.disabled = true;
      postAction("pin", { productId: p.id });
    };
    var nextButton = document.getElementById("lasNext");
    var skipButton = document.getElementById("lasSkip");
    var prevButton = document.getElementById("lasPrev");
    var pinButton = document.getElementById("lasPin");
    var replayButton = document.getElementById("lasReplay");
    var hasQueue = (session.products || []).length > 0;
    if (nextButton) {
      nextButton.disabled = !hasQueue;
      nextButton.onclick = function () { advance(session, state, false); };
    }
    if (skipButton) {
      skipButton.disabled = !current;
      skipButton.onclick = function () { advance(session, state, false); };
    }
    if (prevButton) prevButton.disabled = !hasQueue;
    if (pinButton) pinButton.disabled = !current;
    if (replayButton) replayButton.disabled = !current;
    document.getElementById("lasPrev").onclick = function () {
      var list = session.products || [];
      var index = current ? list.findIndex(function (p) { return p.id === current.id; }) : 0;
      var prev = list[index - 1] || list[list.length - 1];
      if (prev) setCurrent(prev, true);
    };
    document.getElementById("lasReplay").onclick = function () {
      var p = needProduct();
      if (!p) return;
      var button = document.getElementById("lasReplay");
      if (button) button.disabled = true;
      setCurrent(p, true);
    };
    boxQueryAll("[data-use-lot]").forEach(function (b) {
      b.onclick = function () {
        var lot = products.filter(function (p) { return p.id === b.dataset.useLot; })[0];
        if (lot) setCurrent(lot, true);
      };
    });
    document.getElementById("lasBuyNow").onclick = function () {
      var p = needProduct();
      if (!p) return;
      setCurrent(p, true);
    };
    var gameProduct = document.getElementById("lasGameProduct");
    var gameType = document.getElementById("lasGameType");
    var launchPreset = document.getElementById("lasLaunchPreset");
    if (gameProduct) gameProduct.onchange = function () {
      if (gameProduct.value !== "__new__") return;
      gameProduct.value = "";
      openSheet("Ajouter un item au Live",
        "<label>Nom de l’item <input id='lasQuickName' placeholder='Ex. Display EV10'></label>" +
        "<label>Prix de référence <input id='lasQuickPrice' type='number' min='0.01' step='0.01' value='1'></label>" +
        "<label>Quantité disponible <input id='lasQuickStock' type='number' min='1' max='1000' value='1'></label>",
        function () {
          var name = String(document.getElementById("lasQuickName").value || "").trim();
          var price = Math.max(0.01, Number(document.getElementById("lasQuickPrice").value || 1));
          var stock = Math.max(1, Number(document.getElementById("lasQuickStock").value || 1));
          if (!name) return alert("Nom de l’item obligatoire.");
          if (products.length >= 100) return alert("Ce Live contient déjà le maximum de 100 items.");
          var item = { id:"LOT-" + Date.now(), name:name, mode:"buy_now", price:price, qty:stock, stock:stock, durationSeconds:30, shippingWeightGrams:20 };
          api(patchPath(selected), { method:"PATCH", body:JSON.stringify({ products:products.concat([item]), currentLot:item.id }) }).then(loadEditor).catch(function (e) { alert(e.message); });
        }
      );
    };
    function selectedGameProduct() {
      var id = gameProduct && gameProduct.value;
      var product = (selectableProducts || products).filter(function (item) { return item.id === id; })[0] || current || (selectableProducts || products)[0] || null;
      if (!product) alert("Ajoutez d’abord un item au Live.");
      return product;
    }
    function ensureProductInLive(product) {
      if (!product) return Promise.resolve(null);
      var existing = products.filter(function (item) { return item.id === product.id; })[0];
      if (existing) return Promise.resolve(existing);
      var imported = {
        id: product.id,
        name: product.name,
        mode: "buy_now",
        price: Math.max(0.01, Number(product.price || 1)),
        qty: Math.max(1, Number(product.qty || product.stock || 1)),
        stock: Math.max(1, Number(product.stock || 1)),
        durationSeconds: 30,
        shippingWeightGrams: Math.max(0, Number(product.shippingWeightGrams || 20))
      };
      var next = products.concat([imported]);
      return api(patchPath(selected), { method: "PATCH", body: JSON.stringify({ products: next, currentLot: imported.id }) }).then(function () {
        session.products = next;
        products.push(imported);
        return imported;
      });
    }
    function prepareGame(type, product, config) {
      document.getElementById("lasSheet").hidden = true;
      return ensureProductInLive(product).then(function (liveProduct) {
        if (liveProduct) return api(patchPath(selected), { method: "PATCH", body: JSON.stringify({ currentLot: liveProduct.id }) }).then(function () {
          return postAction("game/prepare", { type: type, productId: liveProduct.id, config: config || {} });
        });
        return postAction("game/prepare", { type: type, productId: "", config: config || {} });
      }).catch(function (e) { alert(e.message); });
    }
    function prepareBoosterGame(title, product, type) {
      return resolveBoosterUnits(product).then(function (meta) {
        var units=Math.max(1,Number(meta.unitsPerPackage||1));
        var stock=Math.max(1,Number(product.stock||1));
        openSheet(title,
          "<label>Quantité d’items mise en jeu <input id='lasItemCount' type='number' min='1' max='" + stock + "' value='1'></label>" +
          "<label>Boosters par item <input id='lasBoostersPerItem' type='number' min='1' max='1000' value='" + units + "'></label>" +
          "<p class='live-studio-hint'>Référence : " + esc(meta.packaging||"item") + " · Cardoria calcule automatiquement le total de boosters et les numérote.</p>" +
          "<div class='live-studio-hint'><strong>Total boosters : <span id='lasBoosterTotal'>" + units + "</span></strong></div>" +
          "<label>Prix de départ de l’enchère <input id='lasSpotPrice' type='number' min='0.01' step='0.01' value='" + Number(product.price || 1) + "'></label>" +
          "<label>Durée de l’enchère <select id='lasGameDuration'><option value='30'>30 s</option><option value='45'>45 s</option><option value='60'>60 s</option></select></label>",
          function () {
            var itemCount=Math.max(1,Number(document.getElementById("lasItemCount").value||1));
            var perItem=Math.max(1,Number(document.getElementById("lasBoostersPerItem").value||1));
            var boosterCount=itemCount*perItem;
            prepareGame(type, product, {
              itemCount:itemCount,
              boostersPerItem:perItem,
              boosterCount:boosterCount,
              pricePerSpot:Number(document.getElementById("lasSpotPrice").value||0),
              durationSeconds:Number(document.getElementById("lasGameDuration").value||30)
            });
          }
        );
        function refreshTotal(){
          var a=document.getElementById("lasItemCount"),b=document.getElementById("lasBoostersPerItem"),out=document.getElementById("lasBoosterTotal");
          if(out)out.textContent=String(Math.max(1,Number(a&&a.value||1))*Math.max(1,Number(b&&b.value||1)));
        }
        var itemCount=document.getElementById("lasItemCount"),perItem=document.getElementById("lasBoostersPerItem");
        if(itemCount)itemCount.oninput=refreshTotal;if(perItem)perItem.oninput=refreshTotal;refreshTotal();
      });
    }
    if (launchPreset) launchPreset.onclick = function () {
      var type = gameType ? gameType.value : "buy_now";
      var product = selectedGameProduct();
      if (!product && type !== "energy_game") return;
       if (type === "buy_now") return prepareGame("buy_now", product, {});
      if (type === "auction") {
        return openSheet("Préparer l’enchère",
          "<label>Prix de départ <input id='lasStart' type='number' min='0.01' step='0.01' value='" + Number((product && product.price) || startPrice || 1) + "'></label>" +
          "<label>Durée <select id='lasDuration'><option value='30'>30 s</option><option value='45'>45 s</option><option value='60'>60 s</option></select></label>",
          function () { prepareGame("auction", product, { startPrice:Number(document.getElementById("lasStart").value||0), durationSeconds:Number(document.getElementById("lasDuration").value||30) }); }
        );
      }
      if (type === "flash") {
        return openSheet("Préparer la vente flash",
          "<label>Prix <input id='lasFlashPrice' type='number' min='0.01' step='0.01' value='" + Number((product && product.price) || 1) + "'></label>" +
          "<label>Durée <select id='lasDuration'><option value='30'>30 s</option><option value='60' selected>60 s</option><option value='120'>2 min</option></select></label>",
          function () { prepareGame("flash", product, { price:Number(document.getElementById("lasFlashPrice").value||0), durationSeconds:Number(document.getElementById("lasDuration").value||60) }); }
        );
      }
      if (type === "giveaway" || type === "giveaway_subscriber" || type === "giveaway_buyer") {
        var giveawayTitle = type === "giveaway_subscriber" ? "Préparer le Giveaway Abonné" : type === "giveaway_buyer" ? "Préparer le Giveaway Acheteur" : "Préparer le Giveaway";
        return openSheet(giveawayTitle,
          "<label>Durée <select id='lasDuration'><option value='60'>60 s</option><option value='120'>2 min</option></select></label>",
          function () { prepareGame(type, product, { durationSeconds:Number(document.getElementById("lasDuration").value||60) }); }
        );
      }
      if (type === "box_break") return prepareBoosterGame("Préparer le Box Break", product, "box_break");
      if (type === "hit_run_ex") return prepareBoosterGame("Préparer Hit & Run EX", product, "hit_run_ex");
      if (type === "hit_run_ar") return prepareBoosterGame("Préparer Hit & Run AR", product, "hit_run_ar");
      if (type === "hit_run_full_art") return prepareBoosterGame("Préparer Hit & Run Full Art", product, "hit_run_full_art");
      if (type === "energy_game") {
        return resolveBoosterUnits(product).then(function(meta){
          var units=Math.max(1,Number(meta.unitsPerPackage||1)),stock=Math.max(1,Number((product&&product.stock)||1));
          openSheet("Préparer le Jeu de l’énergie",
            "<label>Quantité d’items mise en jeu <input id='lasEnergyItemCount' type='number' min='1' max='" + stock + "' value='1'></label>" +
            "<label>Boosters par item <input id='lasEnergyPerItem' type='number' min='1' max='1000' value='" + units + "'></label>" +
            "<div class='live-studio-hint'><strong>Total boosters : <span id='lasEnergyBoosterTotal'>" + units + "</span></strong></div>" +
            "<label>Nombre de jeux <input id='lasEnergyGamesCount' type='number' min='1' max='100' value='1'></label>" +
            "<label>Extensions / items Pokémon <input id='lasEnergyItems' placeholder='Ex. EV10, EB10' value='" + esc((product&&product.extension)||"") + "'></label>" +
            "<label>Prix / spot <input id='lasSpotPrice' type='number' min='0.01' step='0.01' value='" + Number((product && product.price) || 1) + "'></label>",
            function () {
              var count=Math.max(1,Number(document.getElementById("lasEnergyGamesCount").value||1));
              var items=document.getElementById("lasEnergyItems").value.split(/[+,;\\n]/).map(function(x){return x.trim();}).filter(Boolean);
              var games=[];for(var i=0;i<count;i+=1)games.push({type:"other",items:items,detail:product?product.name:""});
              var itemCount=Math.max(1,Number(document.getElementById("lasEnergyItemCount").value||1));
              var perItem=Math.max(1,Number(document.getElementById("lasEnergyPerItem").value||1));
              prepareGame("energy_game",product,{boosterCount:itemCount*perItem,gamesCount:count,energyGames:games,pricePerSpot:Number(document.getElementById("lasSpotPrice").value||0)});
            }
          );
          function refreshEnergyTotal(){var a=document.getElementById("lasEnergyItemCount"),b=document.getElementById("lasEnergyPerItem"),out=document.getElementById("lasEnergyBoosterTotal");if(out)out.textContent=String(Math.max(1,Number(a&&a.value||1))*Math.max(1,Number(b&&b.value||1)));}
          var a=document.getElementById("lasEnergyItemCount"),b=document.getElementById("lasEnergyPerItem");if(a)a.oninput=refreshEnergyTotal;if(b)b.oninput=refreshEnergyTotal;refreshEnergyTotal();
        });
      }
      return openSheet("Préparer le Break",
        "<label>Spots <input id='lasSpots' type='number' min='1' value='" + Math.max(1, Number((product && product.stock) || 12)) + "'></label>" +
        "<label>Prix / spot <input id='lasSpotPrice' type='number' min='0.01' step='0.01' value='" + Number((product && product.price) || 1) + "'></label>",
        function () { prepareGame("break", product, { spots:Number(document.getElementById("lasSpots").value||1), pricePerSpot:Number(document.getElementById("lasSpotPrice").value||0) }); }
      );
    };
    document.getElementById("lasAuction").onclick = function () {
      var p = needProduct();
      if (!p) return;
      openSheet("Enchère", "<label>Prix de départ <input id='lasStart' type='number' min='0.01' step='0.01' value='" + startPrice + "'></label><label>Durée <select id='lasDuration'><option value='30'" + (duration === 30 ? " selected" : "") + ">30 s</option><option value='45'" + (duration === 45 ? " selected" : "") + ">45 s</option><option value='60'" + (duration === 60 ? " selected" : "") + ">60 s</option></select></label><select id='lasAuctionMode' hidden><option value='standard'>Enchère standard</option><option value='sudden_death'>Mort subite</option></select>", function () {
        var price = Number(document.getElementById("lasStart").value || 0);
        var seconds = Number(document.getElementById("lasDuration").value || 30);
        savePref("auctionStart", price);
        savePref("auctionDuration", seconds);
        document.getElementById("lasSheet").hidden = true;
        postAction("auction/start", { productId: p.id, startPrice: price, durationSeconds: seconds, mode: "standard" });
      });
    };
    document.getElementById("lasFlash").onclick = function () {
      var p = needProduct();
      if (!p) return;
      openSheet("Vente flash", "<label>Prix <input id='lasFlashPrice' type='number' min='0.01' step='0.01' value='" + Number(p.price || startPrice) + "'></label><input id='lasDuration' type='hidden' value='60'>", function () {
        var price = Number(document.getElementById("lasFlashPrice").value || 0);
        document.getElementById("lasSheet").hidden = true;
        postAction("flash/start", { productId: p.id, price: price, durationSeconds: 60 });
      });
    };
    document.getElementById("lasGiveaway").onclick = function () {
      var p = needProduct();
      if (!p) return;
      openSheet("Giveaway", "<label>Durée <select id='lasDuration'><option value='60' selected>60 s</option><option value='120'>2 min</option></select></label>", function () {
        var seconds = Number(document.getElementById("lasDuration").value || 60);
        document.getElementById("lasSheet").hidden = true;
        postAction("giveaway/start", { productId: p.id, durationSeconds: seconds });
      });
    };
    document.getElementById("lasBreak").onclick = function () {
      var p = needProduct();
      if (!p) return;
      openSheet("Ouverture / break", "<label>Spots <input id='lasSpots' type='number' min='1' value='" + Math.max(1, Number(p.stock || 12)) + "'></label><label>Prix / spot <input id='lasSpotPrice' type='number' min='0.01' step='0.01' value='" + Number(p.price || 1) + "'></label>", function () {
        document.getElementById("lasSheet").hidden = true;
        postAction("break/start", { productId: p.id, spots: Number(document.getElementById("lasSpots").value || 1), pricePerSpot: Number(document.getElementById("lasSpotPrice").value || 0) });
      });
    };
    var add = document.getElementById("lasAdd");
    if (add) add.onclick = function () {
      var name = document.getElementById("lasName").value.trim();
      var mode = document.getElementById("lasMode").value;
      var price = Number(document.getElementById("lasPrice").value || 0);
      var stock = Math.max(1, Number(document.getElementById("lasStock").value || 1));
      var shippingWeightGrams = Math.max(0, Math.min(25000, Number(document.getElementById("lasShippingWeight").value || 0)));
      if (!name) return alert("Nom de l'article obligatoire.");
      if (mode !== "giveaway" && price <= 0) return alert("Prix obligatoire pour cette action.");
      var next = products.concat([{ id: "LOT-" + Date.now(), name: name, mode: mode, price: mode === "giveaway" ? 0 : price, qty: stock, stock: stock, durationSeconds: 30, shippingWeightGrams: shippingWeightGrams }]);
      api(patchPath(selected), { method: "PATCH", body: JSON.stringify({ products: next }) }).then(loadEditor).catch(function (e) { alert(e.message); });
    };
    var mode = document.getElementById("lasMode");
    if (mode) mode.onchange = function () { if (this.value === "giveaway") document.getElementById("lasPrice").value = "0"; };
  }
  function boxQueryAll(sel) {
    var box = host();
    return box ? Array.prototype.slice.call(box.querySelectorAll(sel)) : [];
  }
  function showState(s) {
    var n = document.getElementById("lasState");
    if (!n) return;
    var parts = [];
    if (s.preparedGame && s.preparedGame.status === "ready") {
      var names = { buy_now:"Vente directe", auction:"Enchère", flash:"Vente flash", box_break:"Box Break", energy_game:"Jeu de l’énergie", hit_run_ex:"Hit & Run EX", hit_run_ar:"Hit & Run AR", hit_run_full_art:"Hit & Run Full Art", giveaway:"Giveaway", giveaway_subscriber:"Giveaway Abonné", giveaway_buyer:"Giveaway Acheteur", break:"Break personnalisé" };
      parts.push("<div class='live-game-ready'><div><small>PRÊT À LANCER</small><strong>" + esc(names[s.preparedGame.type] || s.preparedGame.type) + "</strong><span>" + esc(s.preparedGame.productName || "") + "</span></div><button type='button' id='lasLaunchPreparedGame' class='live-game-launch-arrow' aria-label='Lancer le jeu préparé' title='Lancer maintenant'>→</button></div>");
    }
    if (s.auction) parts.push("<div class='live-action-status'><strong>Enchère</strong><span>" + esc(s.auction.status) + " · " + euro(s.auction.currentPrice) + "</span>" + (s.auction.status === "running" ? "<button type='button' id='lasAuctionStop' class='live-action-danger'>■ Stopper l’enchère</button>" : "") + "</div>");
    if (s.flash) parts.push("<div class='live-action-status'><strong>Vente flash</strong><span>" + esc(s.flash.status) + " · " + euro(s.flash.price) + "</span></div>");
    if (s.giveaway) parts.push("<div class='live-action-status'><strong>Giveaway</strong><span>" + esc(s.giveaway.status) + " · " + ((s.giveaway.entries || []).length) + " participant(s)" + (s.giveaway.winner ? " · gagnant " + esc(s.giveaway.winner.name) : "") + "</span>" + (s.giveaway.status === "running" || s.giveaway.status === "ready_to_draw" ? "<button type='button' id='lasDraw' class='is-primary'>🎲 Tirer le gagnant</button>" : "") + "</div>");
    if (s.break) {
      parts.push("Break : " + esc(s.break.status) + " · " + Number(s.break.remainingSpots != null ? s.break.remainingSpots : s.break.spots) + " spots restants");
      if (s.break.auctionSequence && Array.isArray(s.break.boosterLabels)) {
        var currentIndex = Math.max(0, Number(s.break.currentBoosterIndex || 0));
        var auctionEndedWithWinner = s.auction && s.auction.status === "ended" && s.auction.highestBidder && Number(s.auction.boosterNumber || 0) === currentIndex + 1;
        var readyIndex = auctionEndedWithWinner ? currentIndex + 1 : currentIndex;
        var readyLabel = s.break.boosterLabels[readyIndex] || "";
        var auctionRunning = s.auction && s.auction.status === "running";
        if (readyLabel) {
          parts.push("<div class='live-booster-next'><div><small>PROCHAIN BOOSTER — PRÊT</small><strong>#" + (readyIndex + 1) + " " + esc(s.break.productName || "Booster") + "</strong><span>" + esc(readyLabel) + "</span></div><button type='button' id='lasNextBoosterAuction' class='live-booster-arrow' aria-label='Lancer l’enchère du booster suivant'" + (auctionRunning ? " disabled title='Une enchère est déjà en cours'" : " title='Lancer l’enchère de ce booster'") + ">→</button></div>");
        } else {
          parts.push("<div class='live-booster-complete'>✓ Tous les boosters ont été traités.</div>");
        }
      }
    }
    n.innerHTML = parts.join("<br>") || "Aucune action en cours.";
    var launchPrepared = document.getElementById("lasLaunchPreparedGame");
    if (launchPrepared) launchPrepared.onclick = function () {
      launchPrepared.disabled = true;
      postAction("game/launch", {});
    };
    var nextBooster = document.getElementById("lasNextBoosterAuction");
    if (nextBooster) nextBooster.onclick = function () {
      if (nextBooster.disabled) return;
      nextBooster.disabled = true;
      postAction("booster-auction/next", { startPrice: Number((s.break && s.break.pricePerSpot) || 1), durationSeconds: Number(prefs().auctionDuration || 30) });
    };
    var stop = document.getElementById("lasAuctionStop");
    if (stop) stop.onclick = function () { postAction("auction/stop", {}); };
    var draw = document.getElementById("lasDraw");
    if (draw) draw.onclick = function () { postAction("giveaway/draw", {}); };
  }
  function syncSelected() {
    var next = window.CardoriaLiveSelectedId || selected;
    if (next && next !== selected) {
      selected = next;
      loadEditor();
      return;
    }
    if (!selected && sessions[0]) {
      selected = sessions[0].id;
      window.CardoriaLiveSelectedId = selected;
      loadEditor();
    }
  }
  function loadAll() {
    api(listPath()).then(function (d) {
      sessions = d.sessions || [];
      selected = window.CardoriaLiveSelectedId || selected || (sessions[0] && sessions[0].id) || "";
      loadEditor();
    }).catch(function (e) {
      var box = host();
      if (box) box.innerHTML = "<p>" + esc(e.message) + "</p>";
    });
  }
  window.addEventListener("cardoria-live-selected", function (e) {
    selected = (e.detail && e.detail.id) || "";
    loadEditor();
  });
  // Do not rebuild the whole sales editor on a timer. Re-rendering every 4 seconds
  // destroyed focused inputs, open details and click handlers while the operator was selling.
  // The editor is refreshed explicitly after live actions and when the selected live changes.
  if (activityTimer) {
    clearInterval(activityTimer);
    activityTimer = null;
  }
  setTimeout(loadAll, 0);
})();
