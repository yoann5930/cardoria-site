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
  const focusLiveId = String(search.get("session") || "").trim();
  const urlPrivilegeFlags = {
    admin: search.get("admin"),
    free: search.get("free"),
    noFee: search.get("noFee")
  };
  const urlFlagsNeverGrantAdmin = true;
  void urlPrivilegeFlags;

  const grantFromHash = () => {
    const match = String(window.location.hash || "").match(/cardoriaAdminGrant=([A-Za-z0-9_-]+)/);
    return match ? match[1] : "";
  };

  const adminSessionToken = () => {
    try { return sessionStorage.getItem("cardoria_session_token") || ""; } catch { return ""; }
  };

  const liveAccessHeaders = () => {
    const headers = { Accept: "application/json", "Content-Type": "application/json" };
    const token = adminSessionToken();
    const grant = grantFromHash();
    if (token) headers.Authorization = "Bearer " + token;
    if (grant) headers["x-live-admin-grant"] = grant;
    return headers;
  };

  const paymentLabel = (session) => (
    session?.paymentProvider === "paypal" || session?.ownerRole === "seller" ? "PayPal" : "SumUp"
  );

  const renderAdminBar = (access) => {
    const bar = document.getElementById("cardoriaLiveAdminBar");
    if (!bar || !access) return;
    const session = access.session || {};
    const title = access.title || session.title || "Live Cardoria";
    bar.hidden = false;
    const titleNode = document.getElementById("cardoriaLiveAdminTitle");
    const modeNode = document.getElementById("cardoriaLiveAdminMode");
    const metaNode = document.getElementById("cardoriaLiveAdminMeta");
    const toolsNode = document.getElementById("cardoriaLiveAdminTools");
    if (titleNode) titleNode.textContent = title;
    if (modeNode) modeNode.textContent = "Mode Admin / Cardoria — accès interne sans frais";
    if (metaNode) {
      metaNode.textContent = `${title} · ${session.status || ""} · ventes visiteurs : ${paymentLabel(session)} (inchangé, aucun paiement créé pour cet accès)`;
    }
    document.title = title + " — Admin Cardoria";
    const heading = document.querySelector(".live-brand h1");
    if (heading) heading.textContent = title;
    if (toolsNode && adminSessionToken() && session.id) {
      toolsNode.innerHTML =
        `<button type="button" data-admin-live-start="${session.id}">Démarrer</button>` +
        `<button type="button" data-admin-live-publish="${session.id}">Diffuser caméra</button>` +
        `<button type="button" data-admin-live-unpublish="${session.id}">Couper la diffusion</button>` +
        `<button type="button" data-admin-live-stop="${session.id}">Arrêter</button>` +
        `<a href="/admin-live.html">Retour Admin Lives</a>` +
        `<video id="cardoriaLivePublisherPreview" muted playsinline autoplay style="width:220px;max-width:100%;border-radius:10px;background:#000"></video>`;
      toolsNode.querySelector("[data-admin-live-start]")?.addEventListener("click", () => {
        fetch(`/api/admin/live/sessions/${encodeURIComponent(session.id)}/start`, { method: "POST", headers: liveAccessHeaders(), body: "{}" })
          .then((response) => response.json().then((payload) => ({ ok: response.ok && payload.ok !== false, payload })))
          .then((result) => { if (!result.ok) throw new Error(result.payload.error || "Démarrage impossible"); location.reload(); })
          .catch((error) => alert(error.message));
      });
      toolsNode.querySelector("[data-admin-live-stop]")?.addEventListener("click", () => {
        fetch(`/api/admin/live/sessions/${encodeURIComponent(session.id)}/stop`, { method: "POST", headers: liveAccessHeaders(), body: "{}" })
          .then((response) => response.json().then((payload) => ({ ok: response.ok && payload.ok !== false, payload })))
          .then((result) => { if (!result.ok) throw new Error(result.payload.error || "Arrêt impossible"); location.reload(); })
          .catch((error) => alert(error.message));
      });
      toolsNode.querySelector("[data-admin-live-publish]")?.addEventListener("click", () => void startAdminPublish(session.id));
      toolsNode.querySelector("[data-admin-live-unpublish]")?.addEventListener("click", () => void stopAdminPublish());
    }
  };

  const loadFocusedLiveTitle = async () => {
    if (!focusLiveId) return;
    try {
      const response = await fetch(`/api/live/sessions/${encodeURIComponent(focusLiveId)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!payload?.session?.title) return;
      const heading = document.querySelector(".live-brand h1");
      if (heading) heading.textContent = payload.session.title;
      document.title = payload.session.title + " — Live Cardoria";
    } catch {}
  };

  const loadAdminLiveAccess = async () => {
    if (!focusLiveId || !urlFlagsNeverGrantAdmin) return;
    if (!adminSessionToken() && !grantFromHash()) return;
    try {
      const response = await fetch(`/api/live/sessions/${encodeURIComponent(focusLiveId)}/admin-access`, {
        headers: liveAccessHeaders(),
        cache: "no-store"
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) return;
      if (payload.accessRole === "admin" && payload.accessContext === "cardoria") renderAdminBar(payload);
    } catch {}
  };

  let activeSessionId = null;
  let liveActive = false;
  let directoryTimer = null;
  let peerConnection = null;
  let viewerId = null;
  let heartbeatTimer = null;
  let publisherHandle = null;
  let webrtcConfigured = null;

  const setStatus = (message, active = false) => {
    stateNode.textContent = message;
    stageNode.dataset.live = active ? "true" : "false";
  };

  const setViewers = (count) => {
    const value = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
    viewersNode.textContent = `${value} spectateur${value > 1 ? "s" : ""}`;
  };

  const apiPost = async (path, body, keepalive = false) => {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      keepalive,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (payload?.code === "CLOUDFLARE_REALTIME_NOT_CONFIGURED" || response.status === 503) {
        throw new Error("Service vidéo Live indisponible");
      }
      const message = payload?.error || `Erreur Live (${response.status}).`;
      throw new Error(message);
    }
    return payload;
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  const stopWebRtcViewer = async (notifyServer = true) => {
    stopHeartbeat();
    peerConnection?.close();
    peerConnection = null;
    const currentViewerId = viewerId;
    viewerId = null;
    if (notifyServer && currentViewerId) {
      try {
        await apiPost("/api/live/webrtc/viewer/stop", { viewerId: currentViewerId }, true);
      } catch {}
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

  const connectCloudflare = async (sessionId) => {
    await stopWebRtcViewer(true);
    setStatus("Connexion WebRTC au live…", false);

    const start = await apiPost("/api/live/webrtc/viewer/start", { liveSessionId: sessionId });
    if (!start?.viewerId || !start?.offer?.sdp) throw new Error("Signal WebRTC incomplet.");
    viewerId = start.viewerId;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
      bundlePolicy: "max-bundle",
    });
    peerConnection = pc;
    const remoteStream = new MediaStream();

    pc.addEventListener("track", (event) => {
      if (activeSessionId !== sessionId) return;
      remoteStream.addTrack(event.track);
      video.srcObject = remoteStream;
      video.removeAttribute("src");
      video.muted = true;
      soundButton?.removeAttribute("hidden");
      liveActive = true;
      setStatus("LIVE EN COURS", true);
      video.play().catch(() => {});
    });

    pc.addEventListener("connectionstatechange", () => {
      if (activeSessionId !== sessionId) return;
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        setStatus("Connexion au live interrompue. Reconnexion…", false);
      }
    });

    await pc.setRemoteDescription(start.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await apiPost("/api/live/webrtc/viewer/answer", {
      viewerId,
      answer: { type: "answer", sdp: answer.sdp || "" },
    });

    heartbeatTimer = window.setInterval(async () => {
      if (!viewerId || activeSessionId !== sessionId) return;
      try {
        const heartbeat = await apiPost("/api/live/webrtc/viewer/heartbeat", { viewerId });
        if (heartbeat?.active === false) {
          setStatus("Le live est terminé.", false);
          liveActive = false;
          await stopWebRtcViewer(false);
          window.setTimeout(loadDirectory, 500);
        }
      } catch {
        // A transient heartbeat error must not immediately stop media playback.
      }
    }, 30_000);
  };

  const connectSession = async (sessionId) => {
    if (!sessionId) return;
    await disconnectSession();
    activeSessionId = sessionId;
    setStatus("Connexion au live…", false);
    setViewers(0);

    try {
      await connectCloudflare(sessionId);
    } catch (error) {
      liveActive = false;
      setStatus(error instanceof Error ? error.message : "Impossible de rejoindre ce live.", false);
    }

    directoryNode.querySelectorAll("[data-session-id]").forEach((button) => {
      button.dataset.selected = button.dataset.sessionId === sessionId ? "true" : "false";
    });
  };

  const renderDirectory = (sessions) => {
    if (directoryStateNode) {
      directoryStateNode.textContent = sessions.length
        ? `${sessions.length} live${sessions.length > 1 ? "s" : ""} en cours`
        : "Aucun live en cours";
    }

    directoryNode.innerHTML = "";
    if (!sessions.length) {
      const empty = document.createElement("div");
      empty.className = "live-directory-empty";
      empty.textContent = "Aucun vendeur n’est en direct pour le moment.";
      directoryNode.appendChild(empty);
      if (!liveActive) {
        activeSessionId = null;
        setStatus("Aucun live public n’est actuellement en cours.", false);
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
      const timeLabel = started && !Number.isNaN(started.getTime())
        ? started.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
        : "maintenant";
      const streamLabel = session.streamPublished ? "vidéo en cours" : "en attente de diffusion";
      button.innerHTML = `<span class="live-card-dot"></span><span><strong>${session.title || "Live Cardoria"}</strong><small>Démarré à ${timeLabel} · ${paymentLabel(session)} · ${streamLabel}</small></span>`;
      button.addEventListener("click", () => void connectSession(session.id));
      directoryNode.appendChild(button);
    });

    const preferred = sessions.find((session) => session.id === focusLiveId)
      || sessions.find((session) => session.id === activeSessionId)
      || sessions.find((session) => session.streamPublished)
      || sessions[0];
    if (webrtcConfigured && preferred && preferred.id !== activeSessionId) void connectSession(preferred.id);
  };

  async function checkRealtime() {
    if (webrtcConfigured != null) return webrtcConfigured;
    try {
      const response = await fetch("/api/live/webrtc/status", { headers: { Accept: "application/json" }, cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      webrtcConfigured = Boolean(payload.configured);
    } catch {
      webrtcConfigured = false;
    }
    if (!webrtcConfigured) setStatus("Service vidéo Live indisponible", false);
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
      if (!ready && directoryStateNode) {
        directoryStateNode.textContent = sessions.length
          ? `${sessions.length} live${sessions.length > 1 ? "s" : ""} · Service vidéo Live indisponible`
          : "Service vidéo Live indisponible";
      }
    } catch {
      if (directoryStateNode) {
        directoryStateNode.textContent = ready ? "Impossible de lister les Lives." : "Service vidéo Live indisponible";
      }
    }
  }

  const buyLiveProduct = async (liveId, productId) => {
    const email = window.prompt("Email pour le paiement Live :");
    if (!email) return;
    const name = window.prompt("Nom (facultatif) :") || "Client Live";
    const response = await fetch("/api/live/checkout", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        liveId,
        productId,
        qty: 1,
        customerEmail: email,
        customerName: name,
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
        if (state) state.textContent = "Live Admin = SumUp · Live vendeur = PayPal";
        return;
      }
      list.innerHTML = sessions.map((session) => {
        const provider = paymentLabel(session);
        const products = (session.products || []).map((item) => (
          `<button type="button" class="live-tools" data-live-buy="${session.id}" data-product-id="${item.id}">Acheter ${item.name} (${Number(item.price || 0).toFixed(2)} €) — ${provider}</button>`
        )).join("");
        const selected = focusLiveId && session.id === focusLiveId ? "true" : "false";
        return `<article class="live-card-select" data-live-pay="${session.id}" data-selected="${selected}"><span class="live-card-dot"></span><span><strong>${session.title || "Live Cardoria"}</strong><small>${session.status} · ${provider}${session.streamPublished ? " · vidéo en cours" : ""}</small>${products}</span></article>`;
      }).join("");
      list.querySelectorAll("[data-live-buy]").forEach((button) => {
        button.addEventListener("click", () => {
          buyLiveProduct(button.dataset.liveBuy, button.dataset.productId).catch((error) => alert(error.message));
        });
      });
      if (state) state.textContent = `${sessions.length} session(s) · paiement forcé par le serveur`;
    } catch {
      if (state) state.textContent = "Live Admin = SumUp · Live vendeur = PayPal";
    }
  };

  async function startAdminPublish(liveId) {
    if (!window.CardoriaLivePublisher) {
      alert("Module de diffusion Live indisponible.");
      return;
    }
    try {
      await stopAdminPublish();
      publisherHandle = await window.CardoriaLivePublisher.publish({
        liveId,
        token: adminSessionToken(),
        preview: document.getElementById("cardoriaLivePublisherPreview")
      });
      setStatus("Diffusion WebRTC en cours.", true);
    } catch (error) {
      alert(error.message || "Publication impossible.");
    }
  }

  async function stopAdminPublish() {
    if (!publisherHandle) return;
    const handle = publisherHandle;
    publisherHandle = null;
    await handle.stop();
  }

  soundButton?.addEventListener("click", () => {
    video.muted = !video.muted;
    soundButton.textContent = video.muted ? "Activer le son" : "Couper le son";
    if (!video.muted) video.play().catch(() => {});
  });

  void loadDirectory();
  void loadCardoriaSales();
  void loadFocusedLiveTitle();
  void loadAdminLiveAccess();
  directoryTimer = window.setInterval(loadDirectory, 5000);
  window.setInterval(loadCardoriaSales, 8000);
  window.addEventListener("beforeunload", () => {
    if (directoryTimer) window.clearInterval(directoryTimer);
    stopHeartbeat();
    void stopAdminPublish();
    if (viewerId) {
      try {
        navigator.sendBeacon?.("/api/live/webrtc/viewer/stop", new Blob([
          JSON.stringify({ viewerId }),
        ], { type: "application/json" }));
      } catch {}
    }
    peerConnection?.close();
  }, { once: true });
})();
