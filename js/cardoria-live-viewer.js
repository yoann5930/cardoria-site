(() => {
  const API_BASE = "https://whatnot-live-studio-api-b3n5.onrender.com";
  const CLOUDFLARE_MIME = "application/x-cloudflare-webrtc";
  const video = document.getElementById("cardoriaLiveVideo");
  const stateNode = document.getElementById("cardoriaLiveState");
  const viewersNode = document.getElementById("cardoriaLiveViewers");
  const soundButton = document.getElementById("cardoriaLiveSound");
  const stageNode = document.getElementById("cardoriaLiveStage");
  const directoryNode = document.getElementById("cardoriaLiveDirectory");
  const directoryStateNode = document.getElementById("cardoriaLiveDirectoryState");

  if (!(video instanceof HTMLVideoElement) || !stateNode || !viewersNode || !stageNode || !directoryNode) return;

  let mediaSource = null;
  let sourceBuffer = null;
  let objectUrl = null;
  let activeSessionId = null;
  let pendingChunks = [];
  let liveActive = false;
  let eventSource = null;
  let directoryTimer = null;
  let peerConnection = null;
  let viewerId = null;
  let heartbeatTimer = null;

  const setStatus = (message, active = false) => {
    stateNode.textContent = message;
    stageNode.dataset.live = active ? "true" : "false";
  };

  const setViewers = (count) => {
    const value = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
    viewersNode.textContent = `${value} spectateur${value > 1 ? "s" : ""}`;
  };

  const apiPost = async (path, body, keepalive = false) => {
    const response = await fetch(`${API_BASE}${path}`, {
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
      const message = payload?.error?.message || `Erreur Live (${response.status}).`;
      throw new Error(message);
    }
    return payload;
  };

  const base64ToBytes = (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  const clearLegacyPlayer = () => {
    pendingChunks = [];
    sourceBuffer = null;
    if (mediaSource && mediaSource.readyState === "open") {
      try { mediaSource.endOfStream(); } catch {}
    }
    mediaSource = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };

  const stopWebRtcViewer = async (notifyServer = true) => {
    stopHeartbeat();
    peerConnection?.close();
    peerConnection = null;
    const currentViewerId = viewerId;
    viewerId = null;
    if (notifyServer && currentViewerId) {
      try {
        await apiPost("/api/v1/live/webrtc/viewer/stop", { viewerId: currentViewerId }, true);
      } catch {}
    }
  };

  const clearPlayer = async () => {
    eventSource?.close();
    eventSource = null;
    await stopWebRtcViewer(true);
    clearLegacyPlayer();
    video.pause();
    video.srcObject = null;
    video.removeAttribute("src");
    video.load();
  };

  const disconnectSession = async () => {
    liveActive = false;
    await clearPlayer();
  };

  const appendNext = () => {
    if (!sourceBuffer || sourceBuffer.updating || pendingChunks.length === 0) return;
    const next = pendingChunks.shift();
    try {
      sourceBuffer.appendBuffer(next);
    } catch {
      pendingChunks.unshift(next);
      window.setTimeout(appendNext, 120);
    }
  };

  const startLegacyPlayer = (sessionId, mimeType) => {
    clearLegacyPlayer();
    activeSessionId = sessionId;
    if (!window.MediaSource || !MediaSource.isTypeSupported(mimeType)) {
      setStatus("Ce navigateur ne peut pas lire ce format Live. Utilisez Edge ou Chrome récent.", false);
      return;
    }

    mediaSource = new MediaSource();
    objectUrl = URL.createObjectURL(mediaSource);
    video.src = objectUrl;
    video.srcObject = null;
    video.muted = true;
    soundButton?.removeAttribute("hidden");

    mediaSource.addEventListener("sourceopen", () => {
      if (!mediaSource || mediaSource.readyState !== "open" || activeSessionId !== sessionId) return;
      try {
        sourceBuffer = mediaSource.addSourceBuffer(mimeType);
        sourceBuffer.mode = "sequence";
        sourceBuffer.addEventListener("updateend", appendNext);
        sourceBuffer.addEventListener("error", () => setStatus("Le flux Live a rencontré une erreur de lecture.", false));
        appendNext();
      } catch {
        setStatus("Impossible d’ouvrir le flux Live dans ce navigateur.", false);
      }
    }, { once: true });

    liveActive = true;
    setStatus("LIVE EN COURS", true);
    video.play().catch(() => {});
  };

  const connectCloudflare = async (sessionId) => {
    await stopWebRtcViewer(true);
    clearLegacyPlayer();
    setStatus("Connexion WebRTC au live…", false);

    const start = await apiPost("/api/v1/live/webrtc/viewer/start", { liveSessionId: sessionId });
    if (!start?.viewerId || !start?.offer?.sdp) throw new Error("Signal WebRTC incomplet.");
    viewerId = start.viewerId;
    setViewers(start.live?.viewerCount || 0);

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
    await apiPost("/api/v1/live/webrtc/viewer/answer", {
      viewerId,
      answer: { type: "answer", sdp: answer.sdp || "" },
    });

    heartbeatTimer = window.setInterval(async () => {
      if (!viewerId || activeSessionId !== sessionId) return;
      try {
        const heartbeat = await apiPost("/api/v1/live/webrtc/viewer/heartbeat", { viewerId });
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

  const stopPlayer = async () => {
    liveActive = false;
    setStatus("Le live est terminé.", false);
    await clearPlayer();
    window.setTimeout(loadDirectory, 500);
  };

  const enqueueChunk = (event) => {
    if (!event || !event.data || event.sessionId !== activeSessionId) return;
    try {
      pendingChunks.push(base64ToBytes(event.data));
      appendNext();
      if (video.paused) video.play().catch(() => {});
    } catch {
      setStatus("Un fragment du direct n’a pas pu être lu.", false);
    }
  };

  const applyState = (live) => {
    if (!live || live.sessionId !== activeSessionId) return;
    setViewers(live.viewerCount);
    if (!live.active && !liveActive) setStatus("Ce live n’est plus en cours.", false);
  };

  const connectLegacy = (sessionId) => {
    eventSource = new EventSource(`${API_BASE}/api/v1/live/sessions/${encodeURIComponent(sessionId)}/events`);
    eventSource.addEventListener("state", (message) => {
      try { applyState(JSON.parse(message.data).state); } catch {}
    });
    eventSource.addEventListener("stream-start", (message) => {
      try {
        const event = JSON.parse(message.data);
        if (event.sessionId === activeSessionId) startLegacyPlayer(event.sessionId, event.mimeType);
      } catch {
        setStatus("Impossible d’initialiser le direct.", false);
      }
    });
    eventSource.addEventListener("chunk", (message) => {
      try { enqueueChunk(JSON.parse(message.data)); } catch {}
    });
    eventSource.addEventListener("stream-stop", (message) => {
      try {
        const event = JSON.parse(message.data);
        if (event.sessionId === activeSessionId) void stopPlayer();
      } catch {}
    });
    eventSource.onerror = () => {
      if (!liveActive) setStatus("Connexion au live…", false);
    };
  };

  const connectSession = async (sessionId, mimeType) => {
    if (!sessionId) return;
    await disconnectSession();
    activeSessionId = sessionId;
    setStatus("Connexion au live…", false);
    setViewers(0);

    try {
      if (mimeType === CLOUDFLARE_MIME) {
        await connectCloudflare(sessionId);
      } else {
        connectLegacy(sessionId);
      }
    } catch (error) {
      liveActive = false;
      setStatus(error instanceof Error ? error.message : "Impossible de rejoindre ce live.", false);
    }

    directoryNode.querySelectorAll("[data-session-id]").forEach((button) => {
      button.dataset.selected = button.dataset.sessionId === sessionId ? "true" : "false";
    });
  };

  const renderDirectory = (directory) => {
    const sessions = Array.isArray(directory?.sessions) ? directory.sessions : [];
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

    sessions.forEach((session, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "live-card-select";
      button.dataset.sessionId = session.sessionId;
      button.dataset.selected = session.sessionId === activeSessionId ? "true" : "false";
      const started = session.startedAt ? new Date(session.startedAt) : null;
      const timeLabel = started && !Number.isNaN(started.getTime())
        ? started.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
        : "maintenant";
      button.innerHTML = `<span class="live-card-dot"></span><span><strong>Live ${index + 1}</strong><small>Démarré à ${timeLabel} · ${session.viewerCount || 0} spectateur${Number(session.viewerCount) > 1 ? "s" : ""}</small></span>`;
      button.addEventListener("click", () => void connectSession(session.sessionId, session.mimeType));
      directoryNode.appendChild(button);
    });

    const current = sessions.find((session) => session.sessionId === activeSessionId);
    if (!current) void connectSession(sessions[0].sessionId, sessions[0].mimeType);
  };

  async function loadDirectory() {
    try {
      const response = await fetch(`${API_BASE}/api/v1/live/sessions`, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error("directory");
      const payload = await response.json();
      renderDirectory(payload.live);
    } catch {
      if (directoryStateNode) directoryStateNode.textContent = "Connexion au service Live…";
    }
  }

  soundButton?.addEventListener("click", () => {
    video.muted = !video.muted;
    soundButton.textContent = video.muted ? "Activer le son" : "Couper le son";
    if (!video.muted) video.play().catch(() => {});
  });

  void loadDirectory();
  directoryTimer = window.setInterval(loadDirectory, 5000);
  window.addEventListener("beforeunload", () => {
    if (directoryTimer) window.clearInterval(directoryTimer);
    stopHeartbeat();
    if (viewerId) {
      try {
        navigator.sendBeacon?.(`${API_BASE}/api/v1/live/webrtc/viewer/stop`, new Blob([
          JSON.stringify({ viewerId }),
        ], { type: "application/json" }));
      } catch {}
    }
    eventSource?.close();
    peerConnection?.close();
  }, { once: true });
})();
