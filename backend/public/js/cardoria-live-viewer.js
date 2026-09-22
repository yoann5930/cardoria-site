(() => {
  const video = document.getElementById("cardoriaLiveVideo");
  const stateNode = document.getElementById("cardoriaLiveState");
  const viewersNode = document.getElementById("cardoriaLiveViewers");
  const soundButton = document.getElementById("cardoriaLiveSound");
  const stageNode = document.getElementById("cardoriaLiveStage");
  const directoryNode = document.getElementById("cardoriaLiveDirectory");
  const directoryStateNode = document.getElementById("cardoriaLiveDirectoryState");
  if (!(video instanceof HTMLVideoElement) || !stateNode || !viewersNode || !stageNode || !directoryNode) return;

  const search = new URLSearchParams(window.location.search);
  let focusLiveId = String(search.get("session") || "").trim();
  const urlPrivilegeFlags = { admin: search.get("admin"), free: search.get("free"), noFee: search.get("noFee") };
  const urlFlagsNeverGrantAdmin = true;
  void urlPrivilegeFlags;
  void urlFlagsNeverGrantAdmin;

  const WAITING_TITLE = "Live en cours — en attente de diffusion";
  const WAITING_COPY = "La salle est ouverte. La vidéo apparaîtra dès qu'une caméra diffuse.";
  const ICE = { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }], bundlePolicy: "max-bundle" };

  const paymentLabel = (session) => (session?.paymentProvider === "paypal" || session?.ownerRole === "seller" ? "PayPal" : "SumUp");
  void paymentLabel;

  let activeSessionId = null;
  let liveActive = false;
  let directoryTimer = null;
  let peerConnection = null;
  const peerConnections = new Map();
  let viewerId = null;
  let heartbeatTimer = null;
  let answerTimer = null;
  let webrtcConfigured = null;
  let connectingSessionId = null;

  const setOfflineCopy = (title, detail) => {
    const offline = stageNode.querySelector(".live-offline");
    if (!offline) return;
    offline.innerHTML = `<div><strong>${title}</strong><p>${detail}</p></div>`;
  };

  const setStatus = (message, active = false, waiting = false) => {
    stateNode.textContent = message;
    stageNode.dataset.live = active ? "true" : waiting ? "waiting" : "false";
    if (waiting) setOfflineCopy(WAITING_TITLE, WAITING_COPY);
  };

  const setViewers = (count) => {
    const value = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
    viewersNode.textContent = `${value} spectateur${value > 1 ? "s" : ""}`;
  };

  const waitIce = (pc) => {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") finish(); });
      setTimeout(finish, 3000);
    });
  };

  const apiPost = async (path, body, keepalive = false) => {
    const response = await fetch(path, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", keepalive });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error || `Erreur Live (${response.status}).`);
      error.status = response.status;
      error.code = payload?.code || "";
      throw error;
    }
    return payload;
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    if (answerTimer) clearInterval(answerTimer);
    answerTimer = null;
  };

  const removeSecondaryVideos = () => {
    stageNode.querySelectorAll("[data-live-source-video]").forEach((node) => node.remove());
    stageNode.style.removeProperty("position");
    stageNode.removeAttribute("data-sources");
  };

  const layoutStage = () => {
    const count = peerConnections.size;
    stageNode.dataset.sources = String(count);
    stageNode.querySelectorAll("[data-live-source-video]").forEach((node) => {
      node.style.cssText = count >= 2
        ? "width:100%;height:100%;object-fit:contain;background:#000;position:static;inset:auto;border:0;border-radius:0"
        : "position:absolute;right:12px;bottom:12px;width:34%;height:34%;object-fit:cover;border:2px solid #e6c25a;border-radius:12px;background:#000;z-index:3";
    });
  };

  const detachSource = (sourceId) => {
    const pc = peerConnections.get(sourceId);
    if (pc) { pc.close(); peerConnections.delete(sourceId); }
    const extra = stageNode.querySelector(`[data-live-source-video="${sourceId}"]`);
    if (extra) extra.remove();
    if (sourceId === "primary") {
      const leftover = stageNode.querySelector("[data-live-source-video]");
      if (leftover && leftover.srcObject) { video.srcObject = leftover.srcObject; leftover.remove(); }
      else if (!peerConnections.size) video.srcObject = null;
    }
    layoutStage();
  };

  const waitForAnswers = (pending, sessionId) => new Promise((resolve, reject) => {
    let attempts = 0;
    if (answerTimer) clearInterval(answerTimer);
    answerTimer = setInterval(async () => {
      attempts++;
      try {
        const data = await apiPost("/api/live/webrtc/viewer/answers", { viewerId });
        for (const [sourceId, answer] of Object.entries(data.answers || {})) {
          const pc = peerConnections.get(sourceId);
          if (pc && pending.has(sourceId) && answer?.sdp) {
            await pc.setRemoteDescription(answer);
            pending.delete(sourceId);
          }
        }
        if (!pending.size) { clearInterval(answerTimer); answerTimer = null; resolve(); }
        else if (attempts > 30) { clearInterval(answerTimer); answerTimer = null; reject(new Error("Délai de connexion caméra dépassé.")); }
      } catch (error) {
        if (attempts > 30) { clearInterval(answerTimer); answerTimer = null; reject(error); }
      }
    }, 500);
  });

  const attachRemote = (sessionId, sourceId, pc, index) => {
    const remoteStream = new MediaStream();
    pc.addEventListener("track", (event) => {
      if (activeSessionId !== sessionId) return;
      remoteStream.addTrack(event.track);
      let target = video;
      const useMain = index === 0 || (sourceId === "primary" && !stageNode.querySelector("[data-live-source-video]"));
      if (!useMain || (sourceId !== "primary" && index > 0)) {
        target = stageNode.querySelector(`[data-live-source-video="${sourceId}"]`);
        if (!target) {
          target = document.createElement("video");
          target.dataset.liveSourceVideo = sourceId;
          target.autoplay = true;
          target.playsInline = true;
          target.muted = true;
          stageNode.style.position = "relative";
          stageNode.appendChild(target);
        }
      }
      target.srcObject = remoteStream;
      target.muted = target === video ? video.muted : true;
      soundButton?.removeAttribute("hidden");
      liveActive = true;
      setStatus("LIVE EN COURS", true, false);
      layoutStage();
      target.play().catch(() => {});
    });
    pc.addEventListener("connectionstatechange", () => {
      if (activeSessionId !== sessionId) return;
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        setStatus("Connexion au live interrompue. Reconnexion…", false, !peerConnections.size);
      }
    });
  };

  const attachP2PSource = async (sessionId, sourceId, index) => {
    if (peerConnections.has(sourceId)) return;
    const pc = new RTCPeerConnection(ICE);
    peerConnections.set(sourceId, pc);
    attachRemote(sessionId, sourceId, pc, index);
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIce(pc);
    const local = pc.localDescription || offer;
    await apiPost("/api/live/webrtc/viewer/offer", { viewerId, sourceId, offer: { type: "offer", sdp: local.sdp || "" } });
  };

  const syncViewerSources = async (sessionId, sourceIds) => {
    const wanted = new Set((sourceIds || []).map((id) => String(id)));
    for (const sourceId of [...peerConnections.keys()]) {
      if (!wanted.has(sourceId)) detachSource(sourceId);
    }
    const pending = new Set();
    for (let index = 0; index < (sourceIds || []).length; index++) {
      const sourceId = String(sourceIds[index] || `source-${index}`);
      if (peerConnections.has(sourceId)) continue;
      await attachP2PSource(sessionId, sourceId, index);
      pending.add(sourceId);
    }
    if (pending.size) await waitForAnswers(pending, sessionId);
    layoutStage();
    if (!wanted.size) {
      liveActive = false;
      setStatus(WAITING_TITLE, false, true);
    }
  };

  const stopWebRtcViewer = async (notifyServer = true) => {
    stopHeartbeat();
    peerConnection?.close();
    peerConnection = null;
    peerConnections.forEach((pc) => pc.close());
    peerConnections.clear();
    removeSecondaryVideos();
    const currentViewerId = viewerId;
    viewerId = null;
    if (notifyServer && currentViewerId) {
      try { await apiPost("/api/live/webrtc/viewer/stop", { viewerId: currentViewerId }, true); } catch {}
    }
  };

  const clearPlayer = async () => {
    await stopWebRtcViewer(true);
    video.pause();
    video.srcObject = null;
    video.removeAttribute("src");
    video.load();
  };

  const disconnectSession = async () => {
    liveActive = false;
    await clearPlayer();
  };

  const markLiveEnded = async (message) => {
    liveActive = false;
    await stopWebRtcViewer(false);
    setStatus(message || "Ce Live est terminé. Retour à l'annuaire.", false, false);
    setOfflineCopy("Ce Live n'est plus disponible", "Il est terminé ou a été retiré. Voici l'annuaire des Lives en cours.");
    if (focusLiveId) {
      focusLiveId = "";
      try { history.replaceState({}, "", "/live.html"); } catch {}
    }
    setTimeout(loadDirectory, 500);
  };

  const startHeartbeat = (sessionId) => {
    heartbeatTimer = setInterval(async () => {
      if (!viewerId || activeSessionId !== sessionId) return;
      try {
        const heartbeat = await apiPost("/api/live/webrtc/viewer/heartbeat", { viewerId });
        if (Number.isFinite(Number(heartbeat?.viewerCount))) setViewers(heartbeat.viewerCount);
        if (heartbeat?.active === false) {
          await markLiveEnded("Ce Live est terminé. Retour à l'annuaire.");
          return;
        }
        const sources = Array.isArray(heartbeat?.sources) ? heartbeat.sources : [];
        if (heartbeat?.provider === "cardoria-p2p") {
          try { await syncViewerSources(sessionId, sources); } catch {}
        }
        if (!sources.length) {
          liveActive = false;
          setStatus(WAITING_TITLE, false, true);
        }
      } catch {}
    }, 5000);
  };

  const connectP2P = async (sessionId, start) => {
    viewerId = start.viewerId;
    const sources = Array.isArray(start.sources) ? start.sources : [];
    startHeartbeat(sessionId);
    if (!sources.length || start.waiting) {
      liveActive = false;
      setStatus(WAITING_TITLE, false, true);
      setViewers(start.viewerCount || 0);
      return;
    }
    const pending = new Set();
    for (let index = 0; index < sources.length; index++) {
      const sourceId = String(sources[index].sourceId || `source-${index}`);
      await attachP2PSource(sessionId, sourceId, index);
      pending.add(sourceId);
    }
    await waitForAnswers(pending, sessionId);
    layoutStage();
  };

  const connectCloudflare = async (sessionId, start) => {
    if (!start?.viewerId || !start?.offer?.sdp) throw new Error("Signal WebRTC incomplet.");
    viewerId = start.viewerId;
    const pc = new RTCPeerConnection(ICE);
    peerConnection = pc;
    attachRemote(sessionId, "primary", pc, 0);
    await pc.setRemoteDescription(start.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await apiPost("/api/live/webrtc/viewer/answer", { viewerId, answer: { type: "answer", sdp: answer.sdp || "" } });
    startHeartbeat(sessionId);
  };

  const connectRealtime = async (sessionId) => {
    await stopWebRtcViewer(true);
    setStatus("Connexion WebRTC au live…", false, true);
    const start = await apiPost("/api/live/webrtc/viewer/start", { liveSessionId: sessionId });
    setViewers(start.viewerCount || 0);
    if (start.mode === "p2p" || start.provider === "cardoria-p2p") await connectP2P(sessionId, start);
    else await connectCloudflare(sessionId, start);
  };

  const highlightDirectory = (sessionId) => {
    directoryNode.querySelectorAll("[data-session-id]").forEach((button) => {
      button.dataset.selected = button.dataset.sessionId === sessionId ? "true" : "false";
    });
  };

  const connectSession = async (sessionId) => {
    if (!sessionId || connectingSessionId === sessionId) return;
    connectingSessionId = sessionId;
    await disconnectSession();
    activeSessionId = sessionId;
    setStatus("Connexion au live…", false, true);
    setViewers(0);
    highlightDirectory(sessionId);
    try {
      await connectRealtime(sessionId);
    } catch (error) {
      if (error?.code === "LIVE_STREAM_NOT_PUBLISHED" || error?.status === 404 && String(error.message || "").includes("diffusion")) {
        liveActive = false;
        setStatus(WAITING_TITLE, false, true);
        return;
      }
      if (error?.status === 404) {
        await markLiveEnded("Ce Live n'est plus disponible. Retour à l'annuaire.");
        return;
      }
      liveActive = false;
      setStatus(error instanceof Error ? error.message : "Impossible de rejoindre ce live.", false, false);
    } finally {
      if (connectingSessionId === sessionId) connectingSessionId = null;
      highlightDirectory(sessionId);
    }
  };

  const renderDirectory = (sessions) => {
    if (directoryStateNode) directoryStateNode.textContent = sessions.length ? `${sessions.length} live${sessions.length > 1 ? "s" : ""} en cours` : "Aucun live en cours";
    directoryNode.innerHTML = "";
    if (!sessions.length) {
      const empty = document.createElement("div");
      empty.className = "live-directory-empty";
      empty.textContent = "Aucun vendeur n’est en direct pour le moment.";
      directoryNode.appendChild(empty);
      if (focusLiveId) return;
      if (!liveActive) {
        activeSessionId = null;
        setStatus("Aucun live public n’est actuellement en cours.", false, false);
        setViewers(0);
      }
      return;
    }
    sessions.forEach((session) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "live-card-select";
      button.dataset.sessionId = session.id;
      button.dataset.selected = session.id === activeSessionId ? "true" : "false";
      const started = session.startedAt ? new Date(session.startedAt) : null;
      const timeLabel = started && !Number.isNaN(started.getTime()) ? started.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "maintenant";
      const streamLabel = session.streamPublished ? "vidéo en cours" : "en attente de diffusion";
      button.innerHTML = `<span class="live-card-dot"></span><span><strong>${session.title || "Live Cardoria"}</strong><small>Démarré à ${timeLabel} · ${streamLabel}</small></span>`;
      button.addEventListener("click", () => {
        focusLiveId = session.id;
        try { history.replaceState({}, "", "/live.html?session=" + encodeURIComponent(session.id)); } catch {}
        void connectSession(session.id);
      });
      directoryNode.appendChild(button);
    });
    const preferred = focusLiveId
      ? sessions.find((session) => session.id === focusLiveId)
      : sessions.find((session) => session.id === activeSessionId) || sessions.find((session) => session.streamPublished) || sessions[0];
    if (focusLiveId && !preferred && activeSessionId !== focusLiveId) {
      void markLiveEnded("Ce Live n'est plus disponible. Retour à l'annuaire.");
      return;
    }
    if (webrtcConfigured && preferred && preferred.id !== activeSessionId) void connectSession(preferred.id);
  };

  async function checkRealtime() {
    if (webrtcConfigured != null) return webrtcConfigured;
    try {
      const response = await fetch("/api/live/webrtc/status", { headers: { Accept: "application/json" }, cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      webrtcConfigured = Boolean(payload.configured);
    } catch { webrtcConfigured = false; }
    if (!webrtcConfigured) setStatus("Service vidéo Live indisponible", false, false);
    return webrtcConfigured;
  }

  async function loadDirectory() {
    const ready = await checkRealtime();
    try {
      const response = await fetch("/api/live/sessions?status=live", { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error("directory");
      const payload = await response.json();
      const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
      renderDirectory(sessions);
      if (!ready && directoryStateNode) directoryStateNode.textContent = sessions.length ? `${sessions.length} live${sessions.length > 1 ? "s" : ""} · Service vidéo Live indisponible` : "Service vidéo Live indisponible";
    } catch {
      if (directoryStateNode) directoryStateNode.textContent = ready ? "Impossible de lister les Lives." : "Service vidéo Live indisponible";
    }
  }

  const loadFocusedLive = async () => {
    if (!focusLiveId) return;
    try {
      const response = await fetch(`/api/live/sessions/${encodeURIComponent(focusLiveId)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.session?.id) {
        if (payload.session.title) document.title = payload.session.title + " — Live Cardoria";
        await connectSession(payload.session.id);
        return;
      }
    } catch {}
    await markLiveEnded("Ce Live n'est plus disponible. Retour à l'annuaire.");
  };

  const clientAuthToken = () => {
    try {
      const token = localStorage.getItem("cardoria_session_token") || "";
      const legacy = localStorage.getItem("cardoria_client_session") || "";
      if (token) return token;
      if (legacy) {
        localStorage.setItem("cardoria_session_token", legacy);
        localStorage.removeItem("cardoria_client_session");
        return legacy;
      }
      return "";
    } catch { return ""; }
  };

  const buyLiveProduct = async (liveId, productId) => {
    const shipping = await window.CardoriaLiveShippingAddress?.collect({ liveId });
    if (!shipping) return;
    const headers = { Accept: "application/json", "Content-Type": "application/json" };
    const token = clientAuthToken();
    if (token) headers.Authorization = "Bearer " + token;
    const response = await fetch("/api/live/checkout", {
      method: "POST",
      headers,
      body: JSON.stringify({
        liveId,
        productId,
        qty: 1,
        customerEmail: shipping.email,
        customerName: shipping.name,
        shippingAddress: shipping.address,
        servicePoint: shipping.servicePoint,
        successUrl: `${location.origin}/live.html?session=${encodeURIComponent(liveId)}`,
        cancelUrl: `${location.origin}/live.html?session=${encodeURIComponent(liveId)}`
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Paiement Live indisponible.");
    if (payload.checkout?.url) location.assign(payload.checkout.url);
    else throw new Error("Lien de paiement Live non reçu.");
  };

  const loadCardoriaSales = async () => {
    const list = document.getElementById("cardoriaLivePayList");
    const state = document.getElementById("cardoriaLivePayState");
    if (!list) return;
    try {
      const response = await fetch("/api/live/sessions?status=all", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
      if (!sessions.length) {
        list.innerHTML = "<p class='live-directory-empty'>Aucun Live Cardoria programmé. Le lecteur ci-dessus reste disponible.</p>";
        if (state) state.textContent = "";
        return;
      }
      list.innerHTML = sessions.map((session) => {
        const isLive = session.status === "live";
        const when = session.scheduledAt ? new Date(session.scheduledAt) : null;
        const whenLabel = when && !Number.isNaN(when.getTime()) ? when.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "";
        const products = isLive ? (session.products || []).map((item) => `<button type="button" class="live-tools" data-live-buy="${session.id}" data-product-id="${item.id}">Acheter ${item.name} (${Number(item.price || 0).toFixed(2)} €)</button>`).join("") : "";
        const selected = focusLiveId && session.id === focusLiveId ? "true" : "false";
        const label = isLive ? `EN DIRECT${session.streamPublished ? " · vidéo en cours" : ""}` : `Programmé${whenLabel ? " · " + whenLabel : ""}`;
        return `<article class="live-card-select" data-live-pay="${session.id}" data-selected="${selected}"><span class="live-card-dot"></span><span><strong>${session.title || "Live Cardoria"}</strong><small>${label}</small>${products}</span></article>`;
      }).join("");
      list.querySelectorAll("[data-live-buy]").forEach((button) => button.addEventListener("click", () => buyLiveProduct(button.dataset.liveBuy, button.dataset.productId).catch((error) => alert(error.message))));
      if (state) state.textContent = `${sessions.length} session(s)`;
    } catch { if (state) state.textContent = ""; }
  };

  soundButton?.addEventListener("click", () => {
    video.muted = !video.muted;
    soundButton.textContent = video.muted ? "Activer le son" : "Couper le son";
    if (!video.muted) video.play().catch(() => {});
  });

  void loadDirectory();
  void loadCardoriaSales();
  void loadFocusedLive();
  directoryTimer = setInterval(loadDirectory, 5000);
  setInterval(loadCardoriaSales, 8000);
  window.addEventListener("beforeunload", () => {
    if (directoryTimer) clearInterval(directoryTimer);
    stopHeartbeat();
    if (viewerId) {
      try { navigator.sendBeacon?.("/api/live/webrtc/viewer/stop", new Blob([JSON.stringify({ viewerId })], { type: "application/json" })); } catch {}
    }
    peerConnection?.close();
    peerConnections.forEach((pc) => pc.close());
  }, { once: true });
})();
