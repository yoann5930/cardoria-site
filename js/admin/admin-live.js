(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A || !A.protectAdmin()) return;
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  var publishers = {};
  var paymentTimer = null;
  var lastCameraAction = null;
  function token() {
    return sessionStorage.getItem("cardoria_session_token") || localStorage.getItem("cardoria_session_token") || "";
  }
  function paymentState(status) {
    var s = String(status || "").toLowerCase();
    if (["paid", "completed", "authorized", "authorised"].includes(s)) return { key: "paid", label: "Autorisé / Payé", icon: "🟢" };
    if (["failed", "denied", "declined", "cancelled", "canceled", "refused", "rejected"].includes(s)) return { key: "failed", label: "Refusé / Échoué", icon: "🔴" };
    return { key: "pending", label: "Pending / En attente", icon: "🟠" };
  }
  function renderPayments(checkouts) {
    var rows = (checkouts || []).map(function (c) {
      var state = paymentState(c.status);
      return "<tr><td>" + state.icon + " <strong>" + esc(state.label) + "</strong></td><td>" + esc(c.customerName || c.customerEmail || "Client") + "</td><td>" + esc(c.productName || "-") + "</td><td>" + A.euro(Number(c.amount || 0)) + "</td><td>" + esc(String(c.provider || c.paymentProvider || "-").toUpperCase()) + "</td><td>" + esc(c.updatedAt || c.createdAt || "-") + "</td><td><small>" + esc(c.paymentProviderOrderId || c.id || "-") + "</small></td></tr>";
    }).join("");
    var body = A.qs("#livePaymentsBody");
    if (body) body.innerHTML = rows || "<tr><td colspan='7'>Aucun paiement Live pour le moment.</td></tr>";
    var counters = { paid: 0, pending: 0, failed: 0 };
    (checkouts || []).forEach(function (c) { counters[paymentState(c.status).key] += 1; });
    var summary = A.qs("#livePaymentsSummary");
    if (summary) summary.textContent = "Payés: " + counters.paid + " · En attente: " + counters.pending + " · Refusés: " + counters.failed;
  }
  function refreshPayments() {
    return A.adminFetch("/api/admin/live/checkouts").then(function (d) { renderPayments(d.checkouts || []); }).catch(function (e) {
      var body = A.qs("#livePaymentsBody");
      if (body) body.innerHTML = "<tr><td colspan='7'>" + esc(e.message) + "</td></tr>";
    });
  }
  function startPaymentPolling() {
    if (paymentTimer) clearInterval(paymentTimer);
    refreshPayments();
    paymentTimer = setInterval(refreshPayments,3000);
  }
  function showCameraError(message, retry) {
    var box = A.qs("#liveCameraError");
    var retryBtn = A.qs("#liveCameraRetry");
    if (box) { box.hidden = !message; box.textContent = message || ""; }
    if (retryBtn) retryBtn.hidden = !retry;
  }
  function fillDeviceSelects(devices) {
    var cam = A.qs("#liveCameraSelect");
    var mic = A.qs("#liveMicSelect");
    if (cam) {
      cam.innerHTML = "<option value=''>Webcam automatique (PC)</option>";
      (devices.cameras || []).forEach(function (item, index) {
        var option = document.createElement("option");
        option.value = item.deviceId;
        option.textContent = item.label || ("Caméra " + (index + 1));
        cam.appendChild(option);
      });
    }
    if (mic) {
      mic.innerHTML = "<option value=''>Micro automatique</option>";
      (devices.microphones || []).forEach(function (item, index) {
        var option = document.createElement("option");
        option.value = item.deviceId;
        option.textContent = item.label || ("Micro " + (index + 1));
        mic.appendChild(option);
      });
    }
  }
  function detectDevices() {
    if (!window.CardoriaLivePublisher) return;
    CardoriaLivePublisher.devices().then(fillDeviceSelects).catch(function () {});
  }
  function renderSessions(ss) {
    A.qs("#liveBody").innerHTML = (ss || []).map(function (s) {
      var products = (s.products || []).map(function (p) { return esc(p.name) + " · " + esc(p.mode) + (p.mode === "giveaway" ? " gratuit" : " · " + A.euro(p.price)); }).join("<br>") || "Aucune vente configurée";
      return "<tr><td>" + esc(s.title) + "</td><td>" + esc(s.status) + "</td><td><strong>" + (s.ownerRole === "seller" ? "PayPal" : "SumUp") + "</strong></td><td>" + products + "</td><td><button class='btn btn-primary' data-enter='" + esc(s.id) + "'>Studio</button> <button class='btn btn-secondary' data-start='" + esc(s.id) + "'>Démarrer</button> <button class='btn btn-primary' data-cam1='" + esc(s.id) + "'>Caméra 1</button> <button class='btn btn-secondary' data-cam2pc='" + esc(s.id) + "'>Caméra 2 PC</button> <button class='btn btn-primary' data-cam2='" + esc(s.id) + "'>Caméra 2 / téléphone</button> <button class='btn btn-secondary' data-stop='" + esc(s.id) + "'>Arrêter</button></td></tr>";
    }).join("") || "<tr><td colspan='5'>Aucun Live</td></tr>";
    bind();
  }
  function bind() {
    A.qs("#liveBody").querySelectorAll("[data-enter]").forEach(function (b) {
      b.onclick = function () {
        A.adminFetch("/api/admin/live/sessions/" + encodeURIComponent(b.dataset.enter) + "/enter", { method: "POST", body: "{}" }).then(function (d) {
          var u = (d.access && d.access.url) || ("/live.html?session=" + encodeURIComponent(b.dataset.enter));
          if (d.access && d.access.grantToken) u += "#cardoriaAdminGrant=" + encodeURIComponent(d.access.grantToken);
          location.href = u;
        }).catch(function (e) { alert(e.message); });
      };
    });
    A.qs("#liveBody").querySelectorAll("[data-start]").forEach(function (b) {
      b.onclick = function () { A.adminFetch("/api/admin/live/sessions/" + encodeURIComponent(b.dataset.start) + "/start", { method: "POST", body: "{}" }).then(load); };
    });
    A.qs("#liveBody").querySelectorAll("[data-cam1]").forEach(function (b) {
      b.onclick = function () { publishCamera(b.dataset.cam1, "primary", "Caméra 1"); };
    });
    A.qs("#liveBody").querySelectorAll("[data-cam2pc]").forEach(function (b) {
      b.onclick = function () { publishCamera(b.dataset.cam2pc, "secondary", "Caméra 2 PC"); };
    });
    A.qs("#liveBody").querySelectorAll("[data-cam2]").forEach(function (b) {
      b.onclick = function () { pairSecond(b.dataset.cam2); };
    });
    A.qs("#liveBody").querySelectorAll("[data-stop]").forEach(function (b) {
      b.onclick = function () { A.adminFetch("/api/admin/live/sessions/" + encodeURIComponent(b.dataset.stop) + "/stop", { method: "POST", body: "{}" }).then(load); };
    });
  }
  function publishCamera(id, sourceId, label) {
    lastCameraAction = { id: id, sourceId: sourceId, label: label, pair: false };
    showCameraError("", false);
    if (!window.CardoriaLivePublisher) {
      showCameraError("Module caméra indisponible.", false);
      return;
    }
    A.qs("#livePublishState").textContent = "Ouverture de " + label + "…";
    var cameraId = A.qs("#liveCameraSelect") && A.qs("#liveCameraSelect").value;
    var microphoneId = A.qs("#liveMicSelect") && A.qs("#liveMicSelect").value;
    var ready = window.CardoriaLiveMedia && CardoriaLiveMedia.detectAvailability ? CardoriaLiveMedia.detectAvailability() : Promise.resolve({ ok: true });
    ready.then(function (availability) {
      if (availability && availability.cameras) fillDeviceSelects(availability);
      if (availability && availability.ok === false && availability.reason === "unsupported") {
        throw Object.assign(new Error(CardoriaLiveMedia.explainGetUserMediaError({ name: "NotSupportedError" }).text), { cardoriaRetry: false });
      }
      if (availability && availability.ok === false && (availability.reason === "denied" || availability.reason === "permissions-policy")) {
        throw Object.assign(new Error(CardoriaLiveMedia.explainGetUserMediaError({ name: "NotAllowedError" }).text), { cardoriaRetry: true });
      }
      return A.adminFetch("/api/admin/live/sessions/" + encodeURIComponent(id) + "/start", { method: "POST", body: "{}" });
    }).then(function (started) {
      if (started && started.ok === false) throw new Error(started.error || "Impossible de démarrer le Live.");
      return window.CardoriaLivePublisher.publish({
        liveId: id,
        sourceId: sourceId,
        token: token(),
        cameraId: cameraId,
        microphoneId: microphoneId,
        isMobile: false,
        preview: A.qs("#livePublisherPreview")
      });
    }).then(function (handle) {
      publishers[sourceId] = handle;
      A.qs("#livePublishState").textContent = label + " en diffusion";
      showCameraError("", false);
      detectDevices();
    }).catch(function (e) {
      showCameraError(e.message || "Impossible d’ouvrir la caméra.", !e || e.cardoriaRetry !== false);
      A.qs("#livePublishState").textContent = "Caméra inactive";
    });
  }
  function pairSecond(id) {
    lastCameraAction = { id: id, pair: true };
    showCameraError("", false);
    A.adminFetch("/api/admin/live/sessions/" + encodeURIComponent(id) + "/start", { method: "POST", body: "{}" }).then(function (started) {
      if (started && started.ok === false) throw new Error(started.error || "Impossible de démarrer le Live.");
      return A.adminFetch("/api/live/webrtc/publisher/pair", { method: "POST", body: JSON.stringify({ liveSessionId: id, sourceId: "secondary" }) });
    }).then(function (d) {
      if (!d || d.ok === false) throw new Error((d && d.error) || "Lien d’appairage impossible.");
      var absolute = location.origin + d.url;
      A.qs("#cameraPair").innerHTML = "<strong>Caméra 2 :</strong> ouvre ce lien sur le téléphone (valable 10 min) : <a href='" + esc(absolute) + "' target='_blank' rel='noopener'>" + esc(absolute) + "</a>";
      if (navigator.clipboard) navigator.clipboard.writeText(absolute).catch(function () {});
    }).catch(function (e) { showCameraError(e.message, true); });
  }
  function stopCameras() {
    Object.keys(publishers).forEach(function (key) { if (publishers[key] && publishers[key].stop) publishers[key].stop(); });
    publishers = {};
    A.qs("#livePublishState").textContent = "Caméra arrêtée";
  }
  function load() {
    A.adminFetch("/api/admin/live/sessions").then(function (d) { renderSessions(d.sessions || []); });
    refreshPayments();
  }
  A.renderShell("live", "Studio Live Cardoria", "Salle Live indépendante des ventes : aucun prix ni paiement pour démarrer.",
    '<div class="admin-panel"><h2>Nouveau Live</h2><div class="admin-filters"><input id="liveTitle" placeholder="Titre du Live" value="Live Cardoria"><button class="btn btn-primary" id="liveCreate">Créer le Live</button></div><p>Dans le Live : <strong>aucune vente, achat immédiat, enchère, vente flash, giveaway ou ouverture/break</strong>.</p><p><strong>Paiement :</strong> Cardoria/Admin = SumUp uniquement lors d’une vente. Vendeur tiers = PayPal + commission.</p><p><strong>Vidéo :</strong> jusqu’à 2 sources simultanées. Sur PC, la webcam disponible est utilisée automatiquement. La caméra 2 peut être une webcam du PC ou un téléphone connecté par lien sécurisé.</p><div class="admin-filters"><select id="liveCameraSelect"><option value="">Webcam automatique (PC)</option></select><select id="liveMicSelect"><option value="">Micro automatique</option></select></div><p id="livePublishState">Caméra inactive</p><p id="liveCameraError" class="admin-live-camera-error" hidden></p><button class="btn btn-secondary" type="button" id="liveCameraRetry" hidden>Réessayer</button> <button class="btn" type="button" id="liveCameraStop">Arrêter la caméra</button><p id="cameraPair"></p><video id="livePublisherPreview" muted playsinline autoplay style="width:min(420px,100%);border-radius:12px;background:#000"></video></div><div class="admin-panel"><h2>Paiements du Live</h2><p id="livePaymentsSummary">Payés: 0 · En attente: 0 · Refusés: 0</p><table class="admin-table"><thead><tr><th>Statut</th><th>Acheteur</th><th>Produit / lot</th><th>Montant</th><th>Fournisseur</th><th>Mise à jour</th><th>ID paiement</th></tr></thead><tbody id="livePaymentsBody"><tr><td colspan="7">Chargement…</td></tr></tbody></table></div><div class="admin-panel"><h2>Mes Lives</h2><table class="admin-table"><thead><tr><th>Titre</th><th>Statut</th><th>Paiement ventes</th><th>Actions/produits</th><th>Contrôles</th></tr></thead><tbody id="liveBody"></tbody></table></div>');
  A.qs("#liveCreate").onclick = function () {
    var b = this;
    b.disabled = true;
    A.adminFetch("/api/admin/live/sessions", { method: "POST", body: JSON.stringify({ title: A.qs("#liveTitle").value, ownerRole: "admin", products:[] }) }).then(load).catch(function (e) { alert(e.message); }).finally(function () { b.disabled = false; });
  };
  A.qs("#liveCameraRetry").onclick = function () {
    if (!lastCameraAction) return;
    if (lastCameraAction.pair) pairSecond(lastCameraAction.id);
    else publishCamera(lastCameraAction.id, lastCameraAction.sourceId, lastCameraAction.label);
  };
  A.qs("#liveCameraStop").onclick = stopCameras;
  detectDevices();
  load();
  startPaymentPolling();
  window.addEventListener("beforeunload", function () { if (paymentTimer) clearInterval(paymentTimer); });
})();
