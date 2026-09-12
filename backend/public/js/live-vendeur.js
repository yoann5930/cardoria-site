(function () {
  "use strict";
  var M = window.CardoriaMarketplace, root = document.getElementById("root");
  if (!M || !root) return;
  if (!M.getToken() || !M.getSeller()) {
    root.innerHTML = "<p>Connectez votre compte vendeur sur <a href='vendre.html'>Vendre</a>.</p>";
    return;
  }
  var publisherHandle = null, paymentTimer = null, selectedLiveId = "";
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
  function renderSessions(sessions) {
    var list = document.getElementById("lvSessions");
    if (!list) return;
    if (!selectedLiveId && sessions && sessions[0]) selectedLiveId = sessions[0].id;
    announceSelected();
    list.innerHTML = (sessions || []).map(function (s) {
      var products = (s.products || []).map(function (p) { return esc(p.name) + " · " + esc(p.mode) + (p.mode === "giveaway" ? " gratuit" : " · " + euro(p.price)); }).join("<br>") || "Aucune vente configurée";
      var current = s.id === selectedLiveId ? " is-current" : "";
      return "<div class='live-seller-card" + current + "' style='border:1px solid rgba(212,175,55,.25);padding:12px;margin:8px 0;border-radius:8px'><strong>" + esc(s.title) + "</strong> — " + esc(s.status) + " — <strong>PayPal</strong><p>" + products + "</p><button data-select='" + esc(s.id) + "'>Sélectionner</button></div>";
    }).join("") || "<p>Aucun Live vendeur.</p>";
    list.querySelectorAll("[data-select]").forEach(function (b) {
      b.onclick = function () { selectedLiveId = b.dataset.select; announceSelected(); renderSessions(sessions); };
    });
    var label = document.getElementById("liveSelectedSession");
    var session = (sessions || []).filter(function (s) { return s.id === selectedLiveId; })[0];
    if (label) label.textContent = session ? ("Live sélectionné : " + session.title + " (" + session.status + ")") : "Créez un Live pour commencer.";
  }
  function shell() {
    root.innerHTML = [
      "<div class='live-seller-studio live-studio'>",
      "<header class='live-studio-controls'><div><h2>Studio Live vendeur</h2><p id='liveSelectedSession'>Créez un Live pour commencer.</p><p><strong>Paiement des ventes : PayPal.</strong> La commission Cardoria suit votre abonnement.</p></div>",
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
      "<details class='live-studio-prepare'><summary>Préparer le Live / historique</summary>",
      "<p>Salle d’abord, ventes ensuite. Aucun produit ni prix n'est demandé pour créer une salle.</p>",
      "<div><input id='lvTitle' placeholder='Titre du Live' value='Live vendeur'> <button id='lvCreate' type='button'>Créer le Live</button></div>",
      "<h2>Paiements du Live</h2><table><thead><tr><th>Statut</th><th>Acheteur</th><th>Lot</th><th>Montant</th><th>Paiement</th><th>Mise à jour</th></tr></thead><tbody id='lvPaymentsBody'></tbody></table>",
      "<h2>Mes Lives</h2><div id='lvSessions'></div></details></div>"
    ].join("");
    document.getElementById("lvCreate").onclick = function () {
      var b = this;
      b.disabled = true;
      api("/seller/sessions", { method: "POST", body: JSON.stringify({ title: document.getElementById("lvTitle").value, products:[] }) }).then(function (d) {
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
  shell();
  load();
  paymentTimer = setInterval(refreshPayments,3000);
  window.addEventListener("beforeunload", function () { if (paymentTimer) clearInterval(paymentTimer); });
})();
