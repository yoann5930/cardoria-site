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
  var selectedLiveId = "";
  var listedSessions = [];
  var knownDevices = { cameras: [], microphones: [] };
  var secondaryMode = "idle";
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
  function media() {
    return window.CardoriaLiveMedia || {};
  }
  function sourceStateLabel(state) {
    return media().describeSourceState ? media().describeSourceState(state) : String(state || "inactive");
  }
  function setSourceState(sourceKey, state, detail) {
    var node = A.qs(sourceKey === "primary" ? "#liveCam1State" : "#liveCam2State");
    var phoneNode = A.qs("#liveCam2PhoneState");
    var label = "État : " + sourceStateLabel(state);
    if (detail) label += " — " + detail;
    if (sourceKey === "primary" && node) node.textContent = label;
    if (sourceKey === "secondary") {
      if (node) node.textContent = secondaryMode === "phone" ? ("État : " + sourceStateLabel("phone") + (detail ? " — " + detail : "")) : label;
      if (phoneNode) phoneNode.textContent = secondaryMode === "phone" ? ("État : " + sourceStateLabel("phone") + (detail ? " — " + detail : "")) : ("État : " + sourceStateLabel(secondaryMode === "pc" ? "live" : state));
    }
  }
  function showSourceError(sourceKey, message, retry) {
    var box = A.qs(sourceKey === "primary" ? "#liveCam1Error" : "#liveCam2Error");
    var retryBtn = A.qs(sourceKey === "primary" ? "#liveCam1Retry" : "#liveCam2Retry");
    if (box) { box.hidden = !message; box.textContent = message || ""; }
    if (retryBtn) retryBtn.hidden = !retry;
    if (message) setSourceState(sourceKey, "error");
  }
  function selectedSession() {
    if (selectedLiveId) {
      for (var i = 0; i < listedSessions.length; i += 1) {
        if (listedSessions[i].id === selectedLiveId) return listedSessions[i];
      }
    }
    return listedSessions[0] || null;
  }
  function setSelectedLive(id) {
    selectedLiveId = String(id || selectedLiveId || "");
    var session = selectedSession();
    var node = A.qs("#liveSelectedSession");
    if (node) node.textContent = session ? ("Live sélectionné : " + session.title + " (" + session.status + ")") : "Live sélectionné : créez un Live puis préparez vos lots.";
    var status = A.qs("#liveStudioStatus");
    if (status) status.textContent = session ? ("Salle " + session.status) : "Aucune salle";
    ["#liveGoStart", "#liveGoPause", "#liveGoEnd", "#liveGoWatch", "#liveGoCancel"].forEach(function (sel) {
      var btn = A.qs(sel);
      if (btn) {
        if (btn.hasAttribute("data-start")) btn.setAttribute("data-start", selectedLiveId);
        if (btn.hasAttribute("data-stop")) btn.setAttribute("data-stop", selectedLiveId);
        if (btn.hasAttribute("data-cancel")) btn.setAttribute("data-cancel", selectedLiveId);
        if (btn.hasAttribute("data-enter-live")) btn.setAttribute("data-enter-live", selectedLiveId);
      }
    });
    window.CardoriaLiveSelectedId = selectedLiveId;
    window.dispatchEvent(new CustomEvent("cardoria-live-selected", { detail: { id: selectedLiveId, session: session } }));
  }
  function fillOneSelect(select, items, placeholder, preferred) {
    if (!select) return;
    var current = select.value;
    select.innerHTML = "<option value=''>" + placeholder + "</option>";
    (items || []).forEach(function (item, index) {
      var option = document.createElement("option");
      option.value = item.deviceId;
      option.textContent = item.label || ("Périphérique " + (index + 1));
      select.appendChild(option);
    });
    if (current && Array.prototype.some.call(select.options, function (option) { return option.value === current; })) {
      select.value = current;
    } else if (preferred && Array.prototype.some.call(select.options, function (option) { return option.value === preferred; })) {
      select.value = preferred;
    }
  }
  function fillDeviceSelects(devices) {
    knownDevices = devices || knownDevices;
    var assigned = media().assignDistinctCameras ? media().assignDistinctCameras({
      cameras: knownDevices.cameras || [],
      primaryId: A.qs("#liveCameraSelect1") && A.qs("#liveCameraSelect1").value,
      secondaryId: A.qs("#liveCameraSelect2") && A.qs("#liveCameraSelect2").value,
      occupiedIds: occupiedCameraIds()
    }) : { primary: "", secondary: "" };
    fillOneSelect(A.qs("#liveCameraSelect1"), knownDevices.cameras, "Webcam automatique (PC)", assigned.primary);
    fillOneSelect(A.qs("#liveCameraSelect2"), knownDevices.cameras, "Autre webcam (PC)", assigned.secondary);
    fillOneSelect(A.qs("#liveMicSelect1"), knownDevices.microphones, "Micro automatique", "");
    fillOneSelect(A.qs("#liveMicSelect2"), knownDevices.microphones, "Micro automatique", "");
    warnSameCamera();
  }
  function occupiedCameraIds() {
    var ids = [];
    Object.keys(publishers).forEach(function (key) {
      var id = publishers[key] && publishers[key].cameraId;
      if (id) ids.push(id);
    });
    return ids;
  }
  function warnSameCamera() {
    var cam1 = A.qs("#liveCameraSelect1");
    var cam2 = A.qs("#liveCameraSelect2");
    var warn = A.qs("#liveCam2SameWarn");
    var same = media().sameCameraSelected
      ? media().sameCameraSelected(cam1 && cam1.value, cam2 && cam2.value)
      : Boolean(cam1 && cam2 && cam1.value && cam1.value === cam2.value);
    if (!same && publishers.primary && publishers.primary.cameraId && cam2 && cam2.value === publishers.primary.cameraId) same = true;
    if (warn) {
      warn.hidden = !same;
      warn.textContent = same ? "La même webcam est choisie pour Caméra 1 et Caméra 2. Choisissez une autre webcam pour Caméra 2." : "";
    }
    return same;
  }
  function detectDevices() {
    if (!window.CardoriaLivePublisher) return;
    CardoriaLivePublisher.devices().then(fillDeviceSelects).catch(function () {});
  }
  function setCam2PcEnabled(enabled) {
    ["#liveCameraSelect2", "#liveMicSelect2", "#liveCam2NoMic", "#liveCam2Start"].forEach(function (sel) {
      var node = A.qs(sel);
      if (node) node.disabled = !enabled;
    });
    var block = A.qs("#liveCam2Block");
    if (block) block.classList.toggle("is-disabled", !enabled);
  }
  function renderSessions(ss) {
    listedSessions = ss || [];
    A.qs("#liveBody").innerHTML = listedSessions.map(function (s) {
      var products = (s.products || []).map(function (p) { return esc(p.name) + " · " + esc(p.mode) + (p.mode === "giveaway" ? " gratuit" : " · " + A.euro(p.price)); }).join("<br>") || "Aucune vente configurée";
      var selected = s.id === selectedLiveId ? " btn-primary" : "";
      return "<tr><td>" + esc(s.title) + "</td><td>" + esc(s.status) + "</td><td><strong>" + (s.ownerRole === "seller" ? "PayPal" : "SumUp") + "</strong></td><td>" + products + "</td><td class='admin-live-actions'><button class='btn" + selected + "' data-select='" + esc(s.id) + "'>Sélectionner</button> <button class='btn btn-secondary' data-enter-live='" + esc(s.id) + "'>Voir comme spectateur</button> <button class='btn' data-cancel='" + esc(s.id) + "'>Annuler</button></td></tr>";
    }).join("") || "<tr><td colspan='5'>Aucun Live</td></tr>";
    if (!selectedLiveId && listedSessions[0]) selectedLiveId = listedSessions[0].id;
    setSelectedLive(selectedLiveId);
    bind();
  }
  function bind() {
    A.qs("#liveBody").querySelectorAll("[data-select]").forEach(function (b) {
      b.onclick = function () { setSelectedLive(b.dataset.select); renderSessions(listedSessions); };
    });
    A.qs("#liveBody").querySelectorAll("[data-enter-live]").forEach(function (btn) {
      btn.onclick = function () {
        var liveWindow = window.open("about:blank", "_blank");
        A.adminFetch("/api/admin/live/sessions/" + encodeURIComponent(btn.dataset.enterLive) + "/enter", { method: "POST", body: "{}" }).then(function (d) {
          var liveUrl = (d.access && d.access.url) || ("/live.html?session=" + encodeURIComponent(btn.dataset.enterLive));
          if (d.access && d.access.grantToken) liveUrl += "#cardoriaAdminGrant=" + encodeURIComponent(d.access.grantToken);
          if (liveWindow) liveWindow.location.href = liveUrl;
          else location.assign(liveUrl);
        }).catch(function (e) {
          if (liveWindow) liveWindow.close();
          alert(e.message);
        });
      };
    });
    A.qs("#liveBody").querySelectorAll("[data-cancel]").forEach(function (b) {
      b.onclick = function () {
        if (!confirm("Annuler cette salle Live ?")) return;
        A.adminFetch("/api/admin/live/sessions/" + encodeURIComponent(b.dataset.cancel) + "/cancel", { method: "POST", body: "{}" }).then(load);
      };
    });
  }
  function openSpectator(id) {
    if (!id) return alert("Sélectionnez un Live.");
    var liveWindow = window.open("about:blank", "_blank");
    A.adminFetch("/api/admin/live/sessions/" + encodeURIComponent(id) + "/enter", { method: "POST", body: "{}" }).then(function (d) {
      var liveUrl = (d.access && d.access.url) || ("/live.html?session=" + encodeURIComponent(id));
      if (d.access && d.access.grantToken) liveUrl += "#cardoriaAdminGrant=" + encodeURIComponent(d.access.grantToken);
      if (liveWindow) liveWindow.location.href = liveUrl;
      else location.assign(liveUrl);
    }).catch(function (e) {
      if (liveWindow) liveWindow.close();
      alert(e.message);
    });
  }
  function cameraChoice(sourceId) {
    var assigned = media().assignDistinctCameras ? media().assignDistinctCameras({
      cameras: knownDevices.cameras || [],
      primaryId: A.qs("#liveCameraSelect1") && A.qs("#liveCameraSelect1").value,
      secondaryId: A.qs("#liveCameraSelect2") && A.qs("#liveCameraSelect2").value,
      occupiedIds: occupiedCameraIds()
    }) : { primary: "", secondary: "", conflict: false, distinctAvailable: false };
    var cameraId = sourceId === "primary"
      ? ((A.qs("#liveCameraSelect1") && A.qs("#liveCameraSelect1").value) || "")
      : ((A.qs("#liveCameraSelect2") && A.qs("#liveCameraSelect2").value) || assigned.secondary || "");
    var microphoneId = sourceId === "primary"
      ? (A.qs("#liveMicSelect1") && A.qs("#liveMicSelect1").value)
      : (A.qs("#liveMicSelect2") && A.qs("#liveMicSelect2").value);
    var audio = true;
    if (sourceId === "secondary" && A.qs("#liveCam2NoMic") && A.qs("#liveCam2NoMic").checked) {
      audio = false;
      microphoneId = "";
    }
    return { cameraId: cameraId, microphoneId: microphoneId, audio: audio, assigned: assigned };
  }
  function stopPublisher(sourceId) {
    var handle = publishers[sourceId];
    delete publishers[sourceId];
    if (handle && handle.stop) return Promise.resolve(handle.stop()).catch(function () {});
    return Promise.resolve();
  }
  function publishCamera(id, sourceId, label) {
    lastCameraAction = { id: id, sourceId: sourceId, label: label, pair: false };
    showSourceError(sourceId, "", false);
    if (!window.CardoriaLivePublisher) {
      showSourceError(sourceId, "Module caméra indisponible.", false);
      return;
    }
    if (sourceId === "secondary") {
      var gate = media().canStartSecondaryPc ? media().canStartSecondaryPc({
        phonePaired: secondaryMode === "phone",
        sourceCount: publishers.primary ? 1 : 0,
        max: 2
      }) : { ok: true };
      if (gate && gate.ok === false) {
        showSourceError("secondary", gate.text, gate.retry !== false);
        return;
      }
    }
    var choice = cameraChoice(sourceId);
    if (sourceId === "secondary" && warnSameCamera() && choice.cameraId && publishers.primary && publishers.primary.cameraId === choice.cameraId) {
      showSourceError("secondary", "La même webcam est choisie pour Caméra 1 et Caméra 2. Choisissez une autre webcam, puis réessayez.", true);
      return;
    }
    if (sourceId === "secondary" && choice.assigned && choice.assigned.conflict && !choice.assigned.distinctAvailable) {
      showSourceError("secondary", "Une seule webcam est détectée. Branchez une deuxième webcam pour Caméra 2 PC, ou utilisez Caméra 2 / téléphone.", true);
      return;
    }
    setSourceState(sourceId, "connecting", "ouverture de " + label);
    var ready = media().detectAvailability ? media().detectAvailability() : Promise.resolve({ ok: true });
    ready.then(function (availability) {
      if (availability && availability.cameras) fillDeviceSelects(availability);
      if (availability && availability.ok === false && availability.reason === "unsupported") {
        throw Object.assign(new Error(media().explainGetUserMediaError({ name: "NotSupportedError" }).text), { cardoriaRetry: false });
      }
      if (availability && availability.ok === false && (availability.reason === "denied" || availability.reason === "permissions-policy")) {
        throw Object.assign(new Error(media().explainGetUserMediaError({ name: "NotAllowedError" }).text), { cardoriaRetry: true });
      }
      choice = cameraChoice(sourceId);
      if (sourceId === "secondary" && warnSameCamera()) {
        throw Object.assign(new Error("La même webcam est choisie pour Caméra 1 et Caméra 2. Choisissez une autre webcam pour Caméra 2."), { cardoriaRetry: true });
      }
      return A.adminFetch("/api/admin/live/sessions/" + encodeURIComponent(id) + "/start", { method: "POST", body: "{}" });
    }).then(function (started) {
      if (started && started.ok === false) throw new Error(started.error || "Impossible de démarrer le Live.");
      return stopPublisher(sourceId).then(function () {
        return window.CardoriaLivePublisher.publish({
          liveId: id,
          sourceId: sourceId,
          token: token(),
          cameraId: choice.cameraId,
          microphoneId: choice.microphoneId,
          audio: choice.audio,
          isMobile: false,
          preview: A.qs(sourceId === "primary" ? "#livePublisherPreview1" : "#livePublisherPreview2")
        });
      });
    }).then(function (handle) {
      publishers[sourceId] = handle;
      if (sourceId === "secondary") {
        secondaryMode = "pc";
        setCam2PcEnabled(true);
        var pair = A.qs("#cameraPair");
        if (pair) pair.textContent = "";
      }
      setSourceState(sourceId, "live", label + " en diffusion");
      showSourceError(sourceId, "", false);
      detectDevices();
    }).catch(function (e) {
      var message = e && e.message || "Impossible d’ouvrir la caméra.";
      if (e && (e.code === "LIVE_CAMERA_LIMIT" || /deux caméras maximum/i.test(message))) {
        message = media().thirdSourceMessage ? media().thirdSourceMessage() : message;
      }
      showSourceError(sourceId, message, !e || e.cardoriaRetry !== false);
      if (!publishers[sourceId]) setSourceState(sourceId, "error");
    });
  }
  function pairSecond(id) {
    lastCameraAction = { id: id, pair: true };
    showSourceError("secondary", "", false);
    setSelectedLive(id);
    stopPublisher("secondary").then(function () {
      secondaryMode = "phone";
      setCam2PcEnabled(false);
      setSourceState("secondary", "phone", "lien d’appairage");
      return A.adminFetch("/api/admin/live/sessions/" + encodeURIComponent(id) + "/start", { method: "POST", body: "{}" });
    }).then(function (started) {
      if (started && started.ok === false) throw new Error(started.error || "Impossible de démarrer le Live.");
      return A.adminFetch("/api/live/webrtc/publisher/pair", { method: "POST", body: JSON.stringify({ liveSessionId: id, sourceId: "secondary" }) });
    }).then(function (d) {
      if (!d || d.ok === false) throw new Error((d && d.error) || "Lien d’appairage impossible.");
      var absolute = location.origin + d.url;
      A.qs("#cameraPair").innerHTML = "<strong>Caméra 2 / téléphone :</strong> ouvre ce lien sur le téléphone (valable 10 min, usage unique). Caméra 2 PC est désactivée pour rester à 2 sources : <a href='" + esc(absolute) + "' target='_blank' rel='noopener'>" + esc(absolute) + "</a>";
      if (navigator.clipboard) navigator.clipboard.writeText(absolute).catch(function () {});
      setSourceState("secondary", "phone", "en attente du téléphone");
    }).catch(function (e) {
      secondaryMode = "idle";
      setCam2PcEnabled(true);
      showSourceError("secondary", e.message, true);
    });
  }
  function stopCameras() {
    return Promise.all([stopPublisher("primary"), stopPublisher("secondary")]).then(function () {
      secondaryMode = "idle";
      setCam2PcEnabled(true);
      setSourceState("primary", "inactive");
      setSourceState("secondary", "inactive");
      var pair = A.qs("#cameraPair");
      if (pair) pair.textContent = "";
    });
  }
  function stopOne(sourceId) {
    return stopPublisher(sourceId).then(function () {
      if (sourceId === "secondary") {
        secondaryMode = "idle";
        setCam2PcEnabled(true);
        var pair = A.qs("#cameraPair");
        if (pair) pair.textContent = "";
      }
      setSourceState(sourceId, "inactive", "arrêtée");
      showSourceError(sourceId, "", false);
    });
  }
  function requireSelectedLive() {
    var session = selectedSession();
    if (!session) {
      alert("Créez ou sélectionnez un Live avant de lancer une caméra.");
      return "";
    }
    selectedLiveId = session.id;
    setSelectedLive(session.id);
    return session.id;
  }
  function load() {
    A.adminFetch("/api/admin/live/sessions").then(function (d) { renderSessions(d.sessions || []); });
    refreshPayments();
  }
  A.renderShell("live", "Studio Live Cardoria", "Tableau de bord liveur : un écran pour vendre. Les réglages techniques restent repliés.",
    [
      '<div class="live-studio">',
      '<header class="live-studio-controls"><div><h2>Contrôles Live</h2><p id="liveSelectedSession">Live sélectionné : créez un Live puis préparez vos lots.</p><p id="liveStudioStatus">Aucune salle</p></div>',
      '<div class="live-studio-control-btns">',
      '<button class="live-studio-btn live-studio-btn--go" type="button" id="liveGoStart" data-start="">Démarrer le Live</button>',
      '<button class="live-studio-btn live-studio-btn--pause" type="button" id="liveGoPause">Pause</button>',
      '<button class="live-studio-btn live-studio-btn--end" type="button" id="liveGoEnd" data-stop="">Terminer le Live</button>',
      '<button class="live-studio-btn live-studio-btn--ghost" type="button" id="liveGoWatch" data-enter-live="">Voir comme spectateur</button>',
      '<span class="live-studio-sr">Entrer dans le Live</span>',
      '</div></header>',
      '<div class="live-studio-layout"><section class="live-studio-video"><h2>Vidéo</h2><div class="live-studio-previews">',
      '<div class="admin-live-camera-block" id="liveCam1Block"><div class="live-studio-cam-status"><strong>Caméra 1</strong><p id="liveCam1State">État : inactive</p></div><video id="livePublisherPreview1" muted playsinline autoplay></video><p id="liveCam1Error" class="admin-live-camera-error" hidden></p><div class="admin-live-actions"><button class="live-studio-btn live-studio-btn--go" type="button" id="liveCam1Start">Démarrer Caméra 1</button> <button class="live-studio-btn" type="button" id="liveCam1Stop">Arrêter Caméra 1</button> <button class="live-studio-btn" type="button" id="liveCam1Retry" hidden>Réessayer</button></div></div>',
      '<div class="admin-live-camera-block" id="liveCam2Block"><div class="live-studio-cam-status"><strong>Caméra 2 PC</strong><p id="liveCam2State">État : inactive</p></div><video id="livePublisherPreview2" muted playsinline autoplay></video><p id="liveCam2SameWarn" class="admin-live-camera-warn" hidden></p><p id="liveCam2Error" class="admin-live-camera-error" hidden></p><div class="admin-live-actions"><button class="live-studio-btn live-studio-btn--go" type="button" id="liveCam2Start">Démarrer Caméra 2 PC</button> <button class="live-studio-btn" type="button" id="liveCam2Stop">Arrêter Caméra 2 PC</button> <button class="live-studio-btn" type="button" id="liveCam2Retry" hidden>Réessayer</button></div></div>',
      '</div><details class="live-studio-cam-settings"><summary>Réglages caméra</summary><p><strong>Paiement :</strong> Cardoria/Admin = SumUp uniquement lors d’une vente. Vendeur tiers = PayPal + commission.</p><p>2 sources maximum. Caméra 2 / téléphone remplace Caméra 2 PC pour rester à 2 flux.</p><div class="admin-filters"><select id="liveCameraSelect1"><option value="">Webcam automatique (PC)</option></select><select id="liveMicSelect1"><option value="">Micro automatique</option></select></div><div class="admin-filters"><select id="liveCameraSelect2"><option value="">Autre webcam (PC)</option></select><select id="liveMicSelect2"><option value="">Micro automatique</option></select></div><label class="admin-live-cam-mute"><input id="liveCam2NoMic" type="checkbox"> Caméra 2 sans micro</label><p id="liveCam2PhoneState">État : inactive</p><button class="live-studio-btn" type="button" id="liveCam2Phone">Caméra 2 / téléphone</button> <button class="live-studio-btn" type="button" id="liveCam2PhoneStop">Arrêter Caméra 2</button><p id="cameraPair"></p></details></section>',
      '<section id="liveActionStudio" class="live-studio-stage"></section></div>',
      '<section class="live-studio-activity"><article><h3>Spectateurs</h3><p id="liveStudioViewers">0</p></article><article><h3>Chat</h3><div id="liveStudioChat">Aucun message</div></article><article><h3>Dernière vente</h3><p id="liveStudioLastSale">—</p></article><article><h3>Paiements</h3><p id="livePaymentsSummary">Payés: 0 · En attente: 0 · Refusés: 0</p></article></section>',
      '<details class="live-studio-prepare admin-panel"><summary>Préparer le Live / historique</summary><h2>Nouveau Live</h2><div class="admin-filters"><input id="liveTitle" placeholder="Titre du Live" value="Live Cardoria"><button class="btn btn-primary" id="liveCreate">Créer le Live</button></div><p>Salle d’abord, ventes ensuite. Aucun prix n’est demandé pour créer la salle.</p><h2>Paiements du Live</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Statut</th><th>Acheteur</th><th>Produit / lot</th><th>Montant</th><th>Fournisseur</th><th>Mise à jour</th><th>ID paiement</th></tr></thead><tbody id="livePaymentsBody"><tr><td colspan="7">Chargement…</td></tr></tbody></table></div><h2>Mes Lives</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Titre</th><th>Statut</th><th>Paiement ventes</th><th>Actions/produits</th><th>Contrôles</th></tr></thead><tbody id="liveBody"></tbody></table></div><button type="button" id="liveGoCancel" class="live-studio-btn" data-cancel="" hidden>Annuler</button></details></div>'
    ].join(""));
  A.qs("#liveGoStart").onclick = function () {
    var id = requireSelectedLive();
    if (!id) return;
    A.adminFetch("/api/admin/live/sessions/" + encodeURIComponent(id) + "/start", { method: "POST", body: "{}" }).then(function () {
      load();
      if (!publishers.primary) publishCamera(id, "primary", "Caméra 1");
    }).catch(function (e) { alert(e.message); });
  };
  A.qs("#liveGoPause").onclick = function () {
    stopCameras().then(function () {
      var status = A.qs("#liveStudioStatus");
      if (status) status.textContent = "Pause — salle ouverte. Relancez une caméra pour reprendre.";
    });
  };
  A.qs("#liveGoEnd").onclick = function () {
    var id = requireSelectedLive();
    if (!id) return;
    if (!confirm("Terminer le Live ? La salle sera fermée.")) return;
    stopCameras().then(function () {
      return A.adminFetch("/api/admin/live/sessions/" + encodeURIComponent(id) + "/stop", { method: "POST", body: "{}" });
    }).then(load).catch(function (e) { alert(e.message); });
  };
  A.qs("#liveGoWatch").onclick = function () {
    var id = requireSelectedLive();
    if (id) openSpectator(id);
  };
  A.qs("#liveCreate").onclick = function () {
    var b = this;
    b.disabled = true;
    A.adminFetch("/api/admin/live/sessions", { method: "POST", body: JSON.stringify({ title: A.qs("#liveTitle").value, ownerRole: "admin", products:[] }) }).then(function (d) {
      if (d && d.session && d.session.id) selectedLiveId = d.session.id;
      load();
    }).catch(function (e) { alert(e.message); }).finally(function () { b.disabled = false; });
  };
  A.qs("#liveCam1Start").onclick = function () {
    var id = requireSelectedLive();
    if (id) publishCamera(id, "primary", "Caméra 1");
  };
  A.qs("#liveCam2Start").onclick = function () {
    var id = requireSelectedLive();
    if (id) publishCamera(id, "secondary", "Caméra 2 PC");
  };
  A.qs("#liveCam1Stop").onclick = function () { stopOne("primary"); };
  A.qs("#liveCam2Stop").onclick = function () { stopOne("secondary"); };
  A.qs("#liveCam2Phone").onclick = function () {
    var id = requireSelectedLive();
    if (id) pairSecond(id);
  };
  A.qs("#liveCam2PhoneStop").onclick = function () { stopOne("secondary"); };
  A.qs("#liveCam1Retry").onclick = function () {
    if (!lastCameraAction || lastCameraAction.sourceId !== "primary") {
      var id = requireSelectedLive();
      if (id) publishCamera(id, "primary", "Caméra 1");
      return;
    }
    publishCamera(lastCameraAction.id, "primary", "Caméra 1");
  };
  A.qs("#liveCam2Retry").onclick = function () {
    if (lastCameraAction && lastCameraAction.pair) return pairSecond(lastCameraAction.id);
    var id = (lastCameraAction && lastCameraAction.id) || requireSelectedLive();
    if (id) publishCamera(id, "secondary", "Caméra 2 PC");
  };
  ["#liveCameraSelect1", "#liveCameraSelect2"].forEach(function (sel) {
    var node = A.qs(sel);
    if (node) node.onchange = warnSameCamera;
  });
  detectDevices();
  load();
  startPaymentPolling();
  window.addEventListener("beforeunload", function () { if (paymentTimer) clearInterval(paymentTimer); stopCameras(); });
})();
