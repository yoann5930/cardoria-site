(function () {
  "use strict";
  var M = window.CardoriaMarketplace, root = document.getElementById("root");
  if (!M || !root) return;
  if (!M.getToken()) {
    root.innerHTML = "<p>Connectez-vous avec votre compte client Cardoria pour accéder au Live. <a href='client-login.html?mode=professional'>Se connecter</a>.</p>";
    return;
  }
  var publisherHandle = null, paymentTimer = null, selectedLiveId = "", sellerPlanState = null, sellerPlans = [], sessionFilter = "upcoming";
  function api(path, options) {
    options = options || {};
    var headers = Object.assign({ "Content-Type": "application/json", Authorization: "Bearer " + M.getToken() }, options.headers || {});
    return fetch((window.CARDORIA_BACKEND || location.origin) + "/api/live" + path, Object.assign({}, options, { headers: headers })).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || data.ok === false) throw new Error(data.error || "Erreur Live");
        return data;
      });
    });
  }
  function esc(v) {
    return M.esc ? M.esc(v) : String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function euro(v) { return Number(v || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }); }
  function percent(rate) { return Math.round(Number(rate || 0) * 1000) / 10 + " %"; }
  function planCard(plan, currentPlanId, active) {
    var isCurrent = active && plan.id === currentPlanId;
    var market = plan.id === "starter"
      ? "Marketplace : 5 %"
      : plan.id === "pro"
        ? "Marketplace : 3 % sur les 5 premières ventes, puis 5 %"
        : "Marketplace : 15 premières ventes/mois à 0 %, puis 3 %";
    var livePerk = plan.liveCardoriaShippingBuyerLimit > 0
      ? "Port Cardoria : jusqu’à " + plan.liveCardoriaShippingBuyerLimit + " acheteur(s) distinct(s) par Live"
      : "Port Cardoria : non inclus";
    return "<article class='live-pro-plan" + (isCurrent ? " is-current" : "") + "'>" +
      "<div class='live-pro-plan-head'><strong>" + esc(plan.name) + "</strong><span>" + euro(plan.monthlyPriceEur) + "/mois</span></div>" +
      "<p>Commission Live : <strong>" + esc(percent(plan.liveCommissionRate)) + "</strong></p>" +
      "<p>" + esc(market) + "</p>" +
      "<p>" + esc(livePerk) + "</p>" +
      (plan.livePriority ? "<p>⭐ Priorité d’affichage Live</p>" : "") +
      (plan.badge ? "<p>🏅 Badge Elite</p>" : "") +
      "<div class='live-pro-plan-state'>" + (isCurrent ? "✓ Pack actuel" : "Disponible") + "</div>" +
      "</article>";
  }
  function renderProOverview(seller) {
    var host = document.getElementById("liveProOverview");
    if (!host) return;
    var currentPlanId = sellerPlanState && sellerPlanState.planId ? sellerPlanState.planId : (seller.planId || "starter");
    var active = Boolean(sellerPlanState && sellerPlanState.active);
    var planName = currentPlanId ? currentPlanId.charAt(0).toUpperCase() + currentPlanId.slice(1) : "Starter";
    host.innerHTML = "<section class='live-pro-summary'>" +
      "<div class='live-pro-summary-main'><span class='live-pro-eyebrow'>COMPTE LIVEUR PROFESSIONNEL</span><h2>" + esc(seller.professionalLegalName || seller.displayName) + "</h2>" +
      "<div class='live-pro-chips'><span>✓ SIRET vérifié</span><span>Pack : " + esc(planName) + (active ? " actif" : " à activer") + "</span><span>PayPal : " + (seller.paypalReady ? "✓ prêt" : "à renseigner avant encaissement") + "</span></div></div>" +
      "<div class='live-pro-shortcuts'><a href='#liveCreateZone'>＋ Créer un Live</a><button type='button' id='liveQuickStart'>▶ Démarrer</button><button type='button' id='liveQuickCam'>🎥 Caméra</button><a href='#livePaymentsZone'>€ Ventes</a></div>" +
      "</section>" +
      "<section class='live-pro-packs'><div class='live-pro-section-head'><div><span class='live-pro-eyebrow'>PACKS PROFESSIONNELS</span><h2>Choisissez le niveau adapté à vos Lives</h2></div><p>Le pack définit les commissions et les avantages. PayPal reste séparé et sert uniquement aux encaissements.</p></div>" +
      "<div class='live-pro-plan-grid'>" + sellerPlans.map(function (plan) { return planCard(plan, currentPlanId, active); }).join("") + "</div></section>";
    var quickStart = document.getElementById("liveQuickStart");
    if (quickStart) quickStart.onclick = function () {
      if (!selectedLiveId) return document.getElementById("liveCreateZone")?.scrollIntoView({ behavior: "smooth" });
      publishLive(selectedLiveId);
    };
    var quickCam = document.getElementById("liveQuickCam");
    if (quickCam) quickCam.onclick = function () {
      if (!selectedLiveId) return document.getElementById("liveCreateZone")?.scrollIntoView({ behavior: "smooth" });
      publishLive(selectedLiveId);
    };
  }
  function state(status) {
    var s = String(status || "").toLowerCase();
    if (["paid", "completed", "authorized", "authorised"].includes(s)) return { key: "paid", icon: "🟢", label: "Autorisé / Payé" };
    if (["failed", "denied", "declined", "cancelled", "canceled", "refused", "rejected"].includes(s)) return { key: "failed", icon: "🔴", label: "Refusé / Échoué" };
    return { key: "pending", icon: "🟠", label: "Pending / En attente" };
  }
  function announceSelected() {
    window.CardoriaLiveSelectedId = selectedLiveId;
    window.dispatchEvent(new CustomEvent("cardoria-live-selected", { detail: { id: selectedLiveId } }));
  }
  function renderPayments(items) {
    var body = document.getElementById("lvPaymentsBody"), summary = document.getElementById("lvPaymentsSummary"), counts = { paid: 0, pending: 0, failed: 0 };
    (items || []).forEach(function (c) { counts[state(c.status).key]++; });
    if (summary) summary.textContent = "Payés: " + counts.paid + " · En attente: " + counts.pending + " · Refusés: " + counts.failed;
    if (body) body.innerHTML = (items || []).map(function (c) {
      var s = state(c.status);
      return "<tr><td>" + s.icon + " <strong>" + esc(s.label) + "</strong></td><td>" + esc(c.customerName || c.customerEmail || "Client") + "</td><td>" + esc(c.productName || "-") + "</td><td>" + euro(c.amount) + "</td><td>PayPal</td><td>" + esc(c.updatedAt || c.createdAt || "-") + "</td></tr>";
    }).join("") || "<tr><td colspan='6'>Aucun paiement Live pour le moment.</td></tr>";
  }
  function refreshPayments() {
    return api("/seller/checkouts").then(function (d) { renderPayments(d.checkouts || []); }).catch(function (e) {
      var body = document.getElementById("lvPaymentsBody");
      if (body) body.innerHTML = "<tr><td colspan='6'>" + esc(e.message) + "</td></tr>";
    });
  }
  function pairSecond(id) {
    return api("/seller/sessions/" + encodeURIComponent(id) + "/start", { method: "POST", body: "{}" }).then(function () {
      return api("/webrtc/publisher/pair", { method: "POST", body: JSON.stringify({ liveSessionId: id, sourceId: "secondary" }) });
    }).then(function (d) {
      var url = location.origin + d.url, box = document.getElementById("lvCameraPair");
      if (box) box.innerHTML = "<strong>Caméra 2 / téléphone :</strong> <a target='_blank' rel='noopener' href='" + esc(url) + "'>" + esc(url) + "</a> (10 min, usage unique)";
      if (navigator.clipboard) navigator.clipboard.writeText(url).catch(function () {});
      var st = document.getElementById("lvPublishState");
      if (st) st.textContent = "Caméra 2 / téléphone : lien copié.";
    });
  }
  function publishLive(id) {
    if (!window.CardoriaLivePublisher) return alert("Module de diffusion Live indisponible.");
    Promise.resolve(publisherHandle ? publisherHandle.stop() : null).then(function () {
      publisherHandle = null;
      return api("/seller/sessions/" + encodeURIComponent(id) + "/start", { method: "POST", body: "{}" });
    }).then(function () {
      return window.CardoriaLivePublisher.publish({ liveId: id, sourceId: "primary", token: M.getToken(), isMobile: false, preview: document.getElementById("lvPreview") });
    }).then(function (h) {
      publisherHandle = h;
      document.getElementById("lvPublishState").textContent = "Caméra 1 en diffusion.";
    }).catch(function (e) { alert(e.message); });
  }
  function liveBucket(status) {
    var s = String(status || "").toLowerCase();
    if (s === "live") return "live";
    if (s === "ended" || s === "cancelled" || s === "canceled") return "past";
    return "upcoming";
  }
  function liveStatusLabel(status) {
    var s = String(status || "").toLowerCase();
    return ({ draft: "Brouillon", scheduled: "À venir", live: "En direct", ended: "Terminé", cancelled: "Annulé", canceled: "Annulé" })[s] || status || "Brouillon";
  }
  function renderSessions(sessions) {
    var list = document.getElementById("lvSessions");
    if (!list) return;
    sessions = sessions || [];
    if (!selectedLiveId && sessions[0]) selectedLiveId = sessions[0].id;
    announceSelected();

    var filtered = sessions.filter(function (s) { return liveBucket(s.status) === sessionFilter; });
    list.innerHTML = filtered.map(function (s) {
      var current = s.id === selectedLiveId ? " is-current" : "";
      var bucket = liveBucket(s.status);
      var statusClass = bucket === "live" ? " is-live" : (bucket === "past" ? " is-past" : "");
      var productCount = Array.isArray(s.products) ? s.products.length : 0;
      return "<article class='live-pro-live-card" + current + statusClass + "'>" +
        "<div class='live-pro-live-card-main'><div class='live-pro-live-title-row'><h3>" + esc(s.title || "Live vendeur") + "</h3><span class='live-pro-status'>" + esc(liveStatusLabel(s.status)) + "</span></div>" +
        "<p>" + productCount + " lot(s) préparé(s) · Paiement PayPal</p></div>" +
        "<div class='live-pro-live-actions'>" +
        "<button type='button' class='live-pro-action-primary' data-select='" + esc(s.id) + "'>" + (bucket === "live" ? "Ouvrir le studio" : "Préparer le live") + "</button>" +
        (bucket !== "past" ? "<button type='button' data-open-cam='" + esc(s.id) + "'>Caméra</button>" : "") +
        "<a href='/live.html" + (bucket === "live" ? "?live=" + encodeURIComponent(s.id) : "") + "'>Voir</a>" +
        "</div></article>";
    }).join("") || "<div class='live-pro-empty'>Aucun live dans cette section.</div>";

    list.querySelectorAll("[data-select]").forEach(function (b) {
      b.onclick = function () {
        selectedLiveId = b.dataset.select;
        announceSelected();
        renderSessions(sessions);
        document.getElementById("liveStudioZone")?.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    });
    list.querySelectorAll("[data-open-cam]").forEach(function (b) {
      b.onclick = function () {
        selectedLiveId = b.dataset.openCam;
        announceSelected();
        renderSessions(sessions);
        document.getElementById("liveStudioZone")?.scrollIntoView({ behavior: "smooth", block: "start" });
      };
    });
    document.querySelectorAll("[data-live-filter]").forEach(function (tab) {
      tab.classList.toggle("is-active", tab.dataset.liveFilter === sessionFilter);
      tab.onclick = function () {
        sessionFilter = tab.dataset.liveFilter;
        renderSessions(sessions);
      };
    });

    var label = document.getElementById("liveSelectedSession");
    var session = sessions.filter(function (s) { return s.id === selectedLiveId; })[0];
    if (label) label.textContent = session ? ("Live sélectionné : " + session.title + " (" + liveStatusLabel(session.status) + ")") : "Créez un Live pour commencer.";
  }
  function shell() {
    root.innerHTML = [
      "<div class='live-seller-studio live-studio'>",
      "<div id='liveProOverview'></div>",
      "<section class='live-pro-lives-panel'><div class='live-pro-lives-head'><div><span class='live-pro-eyebrow'>MES LIVES</span><h2>Gérer mes lives</h2></div><a class='live-pro-new-live' href='#liveCreateZone'>＋ Créer un live</a></div><div class='live-pro-tabs'><button type='button' data-live-filter='upcoming' class='is-active'>À venir</button><button type='button' data-live-filter='live'>En direct</button><button type='button' data-live-filter='past'>Passés</button></div><div id='lvSessions'></div></section>",
      "<header class='live-studio-controls' id='liveStudioZone'><div><h2>Studio Live vendeur</h2><p id='liveSelectedSession'>Créez un Live pour commencer.</p><p><strong>Paiement des ventes : PayPal.</strong> La commission Cardoria suit votre abonnement.</p></div>",
      "<div class='live-studio-control-btns'>",
      "<button class='live-studio-btn live-studio-btn--go' type='button' id='lvStart'>Démarrer le Live</button>",
      "<button class='live-studio-btn live-studio-btn--pause' type='button' id='lvPause'>Pause</button>",
      "<button class='live-studio-btn live-studio-btn--end' type='button' id='lvStop'>Terminer le Live</button>",
      "</div></header>",
      "<div class='live-studio-layout'><section class='live-studio-video'><h2>Vidéo</h2><p id='lvPublishState'>Caméra inactive.</p>",
      "<video id='lvPreview' muted playsinline autoplay></video>",
      "<div class='live-studio-quick'><button class='live-studio-btn live-studio-btn--go' type='button' id='lvCam1'>Caméra 1</button></div>",
      "<details class='live-studio-cam-settings'><summary>Réglages caméra</summary><p id='lvCameraPair'></p><button class='live-studio-btn' type='button' id='lvCam2'>Caméra 2 / téléphone</button><p>La Caméra 2 PC indépendante arrive ensuite. Le téléphone reste disponible.</p></details>",
      "</section><section id='liveActionStudio' class='live-studio-stage'></section></div>",
      "<section class='live-studio-activity'><article><h3>Spectateurs</h3><p id='liveStudioViewers'>0</p></article><article><h3>Chat</h3><div id='liveStudioChat'>Aucun message</div></article><article><h3>Dernière vente</h3><p id='liveStudioLastSale'>—</p></article><article><h3>Paiements</h3><p id='lvPaymentsSummary'>Payés: 0 · En attente: 0 · Refusés: 0</p></article></section>",
      "<details class='live-studio-prepare' open id='liveCreateZone'><summary>Créer et préparer mon Live</summary>",
      "<p>Créez votre salle en quelques secondes. Aucun produit ni prix n’est obligatoire pour commencer.</p>",
      "<div class='live-pro-create-row'><input id='lvTitle' placeholder='Titre du Live' value='Live vendeur'> <select id='lvCategory'><option value='pokemon'>Pokémon</option><option value='yugioh'>Yu-Gi-Oh!</option><option value='onepiece'>One Piece</option><option value='lorcana'>Lorcana</option><option value='magic'>Magic</option><option value='other' selected>Autre</option></select> <button id='lvCreate' type='button'>Créer le Live</button></div>",
      "<h2 id='livePaymentsZone'>Paiements du Live</h2><table><thead><tr><th>Statut</th><th>Acheteur</th><th>Lot</th><th>Montant</th><th>Paiement</th><th>Mise à jour</th></tr></thead><tbody id='lvPaymentsBody'></tbody></table>",
      "</details></div>"
    ].join("");
    document.getElementById("lvCreate").onclick = function () {
      var b = this;
      b.disabled = true;
      api("/seller/sessions", { method: "POST", body: JSON.stringify({ title: document.getElementById("lvTitle").value, category: (document.getElementById("lvCategory") && document.getElementById("lvCategory").value) || "other", products:[] }) }).then(function (d) {
        if (d && d.session && d.session.id) selectedLiveId = d.session.id;
        return load();
      }).catch(function (e) { alert(e.message); }).finally(function () { b.disabled = false; });
    };
    document.getElementById("lvStart").onclick = function () {
      if (!selectedLiveId) return alert("Créez ou sélectionnez un Live.");
      publishLive(selectedLiveId);
    };
    document.getElementById("lvPause").onclick = function () {
      Promise.resolve(publisherHandle ? publisherHandle.stop() : null).then(function () {
        publisherHandle = null;
        document.getElementById("lvPublishState").textContent = "Pause — salle ouverte. Relancez Caméra 1 pour reprendre.";
      });
    };
    document.getElementById("lvStop").onclick = function () {
      if (!selectedLiveId) return;
      if (!confirm("Terminer le Live ? La salle sera fermée.")) return;
      Promise.resolve(publisherHandle ? publisherHandle.stop() : null).then(function () {
        publisherHandle = null;
        return api("/seller/sessions/" + encodeURIComponent(selectedLiveId) + "/stop", { method: "POST", body: "{}" });
      }).then(load).catch(function (e) { alert(e.message); });
    };
    document.getElementById("lvCam1").onclick = function () {
      if (!selectedLiveId) return alert("Créez ou sélectionnez un Live.");
      publishLive(selectedLiveId);
    };
    document.getElementById("lvCam2").onclick = function () {
      if (!selectedLiveId) return alert("Créez ou sélectionnez un Live.");
      pairSecond(selectedLiveId).catch(function (e) { alert(e.message); });
    };
  }
  function load() {
    return Promise.all([api("/seller/sessions"), api("/seller/checkouts")]).then(function (r) {
      renderSessions(r[0].sessions || []);
      renderPayments(r[1].checkouts || []);
    }).catch(function (e) { alert(e.message); });
  }
  function boot(seller) {
    seller = seller || M.getSeller();
    if (!seller) {
      root.innerHTML = "<p>Ce compte Cardoria n’est pas encore configuré pour le Live. <a href='/client-login.html?mode=professional'>Ouvrir Mon compte</a> et choisissez Professionnel.</p>";
      return;
    }
    if (seller.sellerType !== "professional" || !seller.professionalVerified) {
      root.innerHTML = "<p>Votre compte Cardoria est connecté, mais le Studio Live nécessite le profil Professionnel avec SIRET vérifié. <a href='/client-login.html?mode=professional'>Ouvrir Mon compte</a>.</p>";
      return;
    }
    shell();
    renderProOverview(seller);
    load();
    paymentTimer = setInterval(refreshPayments,3000);
  }
  Promise.resolve(M.syncSeller ? M.syncSeller() : M.getSeller()).then(function (seller) {
    if (!seller) return boot(seller);
    return Promise.all([
      M.api("/v1/sellers/" + encodeURIComponent(seller.id) + "/subscription").catch(function () { return { subscription: null }; }),
      M.api("/v1/plans").catch(function () { return { plans: [] }; })
    ]).then(function (r) {
      sellerPlanState = r[0] && r[0].subscription ? r[0].subscription : null;
      sellerPlans = r[1] && Array.isArray(r[1].plans) ? r[1].plans : [];
      boot(seller);
    });
  }).catch(function (e) {
    root.innerHTML = "<p>" + esc(e.message || "Profil Liveur indisponible.") + " <a href='/client-login.html?mode=professional'>Retour à Mon compte</a>.</p>";
  });
  window.addEventListener("beforeunload", function () { if (paymentTimer) clearInterval(paymentTimer); });
})();
