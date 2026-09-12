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
  function listPath() { return isAdmin ? "/api/admin/live/sessions" : "/api/live/seller/sessions"; }
  function sessionPath(id) { return isAdmin ? "/api/admin/live/sessions/" + encodeURIComponent(id) : "/api/live/sessions/" + encodeURIComponent(id); }
  function patchPath(id) { return isAdmin ? "/api/admin/live/sessions/" + encodeURIComponent(id) : "/api/live/seller/sessions/" + encodeURIComponent(id); }
  function actionPath(id, suffix) { return isAdmin ? "/api/admin/live/sessions/" + encodeURIComponent(id) + "/actions/" + suffix : "/api/live/actions/seller/" + encodeURIComponent(id) + "/" + suffix; }
  function statePath(id) { return isAdmin ? "/api/admin/live/sessions/" + encodeURIComponent(id) + "/actions" : "/api/live/actions/" + encodeURIComponent(id) + "/state"; }
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
  function renderActivity(state, checkouts) {
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
    if (viewers && selected) {
      fetch("/api/live/webrtc/status/" + encodeURIComponent(selected), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
        viewers.textContent = String(Number(d.viewers || 0));
      }).catch(function () {});
    }
  }
  function loadEditor() {
    var box = host();
    if (!box) return;
    if (!selected) {
      box.innerHTML = "<div class='live-studio-current'><h2>Produit actuel</h2><p>Créez un Live puis ajoutez des lots dans la file avant de démarrer.</p></div><div class='live-studio-queue'><h2>File suivante</h2><p>Préparez les produits ici. Pendant le Live, utilisez Suivant.</p></div>";
      return;
    }
    Promise.all([api(sessionPath(selected)), api(statePath(selected)), api(checkoutPath()).catch(function () { return { checkouts: [] }; })]).then(function (r) {
      var session = r[0].session || {};
      var state = r[1].state || {};
      var checkouts = r[2].checkouts || [];
      var products = session.products || [];
      var current = currentProduct(session, state);
      var stored = prefs();
      var startPrice = current ? Number(current.price || stored.auctionStart || 1) : Number(stored.auctionStart || 1);
      var duration = Number(stored.auctionDuration || 30);
      box.innerHTML = [
        "<div class='live-studio-current'>",
        "<h2>Produit / jeu actuel</h2>",
        current ? ("<div class='live-studio-product'><strong>" + esc(current.name) + "</strong><span>" + esc(modeLabel(current.mode)) + " · " + (current.mode === "giveaway" ? "gratuit" : euro(current.price)) + " · stock " + esc(current.stock) + "</span></div>") : "<p>Aucun lot. Ajoutez-en dans la file avant le direct.</p>",
        "<div class='live-studio-quick'>",
        "<button type='button' id='lasNext' class='is-primary'>Suivant</button>",
        "<button type='button' id='lasPin'>Épingler</button>",
        "<button type='button' id='lasSold' class='is-primary'>Vendu</button>",
        "<button type='button' id='lasSkip'>Passer</button>",
        "<button type='button' id='lasReplay'>Relancer</button>",
        "<button type='button' id='lasPrev'>Précédent</button>",
        "</div>",
        "<div class='live-studio-actions'>",
        "<button type='button' id='lasBuyNow'>Vente</button>",
        "<button type='button' id='lasAuction' class='is-primary'>Lancer enchère</button>",
        "<button type='button' id='lasFlash'>Flash</button>",
        "<button type='button' id='lasBreak'>Break</button>",
        "<button type='button' id='lasGame' disabled title='Les jeux TCG arrivent après ce tableau de bord.'>Jeu</button>",
        "<button type='button' id='lasGiveaway'>Giveaway</button>",
        "<button type='button' id='lasGiveFollow' disabled title='Cardoria ne peut pas encore vérifier qu’un spectateur suit le vendeur.'>Giveaway Follow</button>",
        "<button type='button' id='lasGiveBuyer' disabled title='Giveaway acheteur : prochaine PR, uniquement sur paiements payés.'>Giveaway Acheteur</button>",
        "</div>",
        "<span class='live-studio-sr'>Achat immédiat</span><span class='live-studio-sr'>Enchère</span><span class='live-studio-sr'>Vente flash</span><span class='live-studio-sr'>Ouverture / break</span>",
        "<div id='lasSheet' class='live-studio-sheet' hidden><h3 id='lasSheetTitle'></h3><div id='lasSheetFields'></div><div class='live-studio-quick'><button type='button' id='lasSheetGo'>Démarrer</button><button type='button' id='lasSheetCancel'>Annuler</button></div></div>",
        "<div id='lasState'></div>",
        "</div>",
        "<div class='live-studio-queue'><h2>File suivante</h2>",
        "<ul class='live-studio-file'>" + (products.map(function (p, i) {
          var active = current && p.id === current.id;
          return "<li class='" + (active ? "is-current" : "") + "'><div>" + (i + 1) + ". " + esc(p.name) + "<br><small>" + esc(modeLabel(p.mode)) + "</small></div><button type='button' data-use-lot='" + esc(p.id) + "'>Relancer</button></li>";
        }).join("") || "<li>File vide</li>") + "</ul>",
        "<details><summary>Ajouter un lot</summary><div class='live-studio-sheet' style='display:grid;gap:8px'><input id='lasName' placeholder='Nom article / lot'><input id='lasPrice' type='number' min='0' step='0.01' placeholder='Prix'><input id='lasStock' type='number' min='1' value='1' placeholder='Stock'><select id='lasMode'><option value='buy_now'>Achat immédiat</option><option value='auction'>Enchère</option><option value='flash'>Vente flash</option><option value='giveaway'>Giveaway</option><option value='break'>Ouverture / break</option></select><button type='button' id='lasAdd'>Ajouter au Live</button></div></details>",
        "<select id='lasProduct' hidden><option value=''>Choisir un article</option>" + products.map(function (p) {
          return "<option value='" + esc(p.id) + "'" + (current && current.id === p.id ? " selected" : "") + ">" + esc(p.name) + "</option>";
        }).join("") + "</select>",
        "</div>"
      ].join("");
      bindEditor(session, products, state, current, startPrice, duration);
      showState(state);
      renderActivity(state, checkouts);
      if (state.giveaway && state.giveaway.status === "ready_to_draw" && !state.giveaway.winner && autoDrawId !== state.giveaway.id) {
        autoDrawId = state.giveaway.id;
        postAction("giveaway/draw", {});
      }
    }).catch(function (e) {
      box.innerHTML = "<p>" + esc(e.message) + "</p>";
    });
  }
  function bindEditor(session, products, state, current, startPrice, duration) {
    function needProduct() {
      if (!current) {
        alert("Ajoutez un lot dans la file, puis cliquez Relancer.");
        return null;
      }
      return current;
    }
    document.getElementById("lasPin").onclick = function () {
      var p = needProduct();
      if (p) postAction("pin", { productId: p.id });
    };
    document.getElementById("lasNext").onclick = function () { advance(session, state, false); };
    document.getElementById("lasSkip").onclick = function () { advance(session, state, false); };
    document.getElementById("lasSold").onclick = function () { advance(session, state, true); };
    document.getElementById("lasPrev").onclick = function () {
      var list = session.products || [];
      var index = current ? list.findIndex(function (p) { return p.id === current.id; }) : 0;
      var prev = list[index - 1] || list[list.length - 1];
      if (prev) setCurrent(prev, true);
    };
    document.getElementById("lasReplay").onclick = function () {
      var p = needProduct();
      if (p) setCurrent(p, true);
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
      if (!name) return alert("Nom de l'article obligatoire.");
      if (mode !== "giveaway" && price <= 0) return alert("Prix obligatoire pour cette action.");
      var next = products.concat([{ id: "LOT-" + Date.now(), name: name, mode: mode, price: mode === "giveaway" ? 0 : price, qty: stock, stock: stock, durationSeconds: 30 }]);
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
    if (s.auction) parts.push("Enchère : " + esc(s.auction.status) + " · " + euro(s.auction.currentPrice) + (s.auction.status === "running" ? " <button type='button' id='lasAuctionStop'>Stop enchère</button>" : ""));
    if (s.flash) parts.push("Flash : " + esc(s.flash.status) + " · " + euro(s.flash.price));
    if (s.giveaway) parts.push("Giveaway : " + esc(s.giveaway.status) + " · " + ((s.giveaway.entries || []).length) + " participant(s)" + (s.giveaway.winner ? " · gagnant " + esc(s.giveaway.winner.name) : "") + (s.giveaway.status === "running" || s.giveaway.status === "ready_to_draw" ? " <button type='button' id='lasDraw'>Tirer gagnant</button>" : ""));
    if (s.break) parts.push("Break : " + esc(s.break.status) + " · " + Number(s.break.remainingSpots != null ? s.break.remainingSpots : s.break.spots) + " spots restants");
    n.innerHTML = parts.join("<br>") || "Aucune action en cours.";
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
  if (!activityTimer) {
    activityTimer = setInterval(function () {
      var sheet = document.getElementById("lasSheet");
      if (sheet && !sheet.hidden) return;
      if (selected) loadEditor();
    }, 4000);
  }
  setTimeout(loadAll, 0);
})();
