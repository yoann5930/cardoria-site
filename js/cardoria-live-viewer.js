(() => {
  const API_BASE = "https://whatnot-live-studio-api-b3n5.onrender.com";
  const video = document.getElementById("cardoriaLiveVideo");
  const stateNode = document.getElementById("cardoriaLiveState");
  const viewersNode = document.getElementById("cardoriaLiveViewers");
  const soundButton = document.getElementById("cardoriaLiveSound");
  const stageNode = document.getElementById("cardoriaLiveStage");

  if (!(video instanceof HTMLVideoElement) || !stateNode || !viewersNode || !stageNode) return;

  let mediaSource = null;
  let sourceBuffer = null;
  let objectUrl = null;
  let activeSessionId = null;
  let pendingChunks = [];
  let liveActive = false;

  const setStatus = (message, active = false) => {
    stateNode.textContent = message;
    stageNode.dataset.live = active ? "true" : "false";
  };

  const setViewers = (count) => {
    const value = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
    viewersNode.textContent = `${value} spectateur${value > 1 ? "s" : ""}`;
  };

  const base64ToBytes = (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  };

  const clearPlayer = () => {
    pendingChunks = [];
    sourceBuffer = null;
    if (mediaSource && mediaSource.readyState === "open") {
      try { mediaSource.endOfStream(); } catch {}
    }
    mediaSource = null;
    activeSessionId = null;
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
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

  const startPlayer = (sessionId, mimeType) => {
    clearPlayer();
    activeSessionId = sessionId;
    if (!window.MediaSource || !MediaSource.isTypeSupported(mimeType)) {
      setStatus("Ce navigateur ne peut pas lire ce format Live. Utilisez Edge ou Chrome récent.", false);
      return;
    }

    mediaSource = new MediaSource();
    objectUrl = URL.createObjectURL(mediaSource);
    video.src = objectUrl;
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

  const stopPlayer = () => {
    liveActive = false;
    setStatus("Le live est terminé.", false);
    window.setTimeout(clearPlayer, 500);
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
    if (!live) return;
    setViewers(live.viewerCount);
    if (!live.active && !liveActive) setStatus("Aucun live public n’est actuellement en cours.", false);
  };

  const connectEvents = () => {
    const source = new EventSource(`${API_BASE}/api/v1/live/events`);

    source.addEventListener("state", (message) => {
      try { applyState(JSON.parse(message.data).state); } catch {}
    });

    source.addEventListener("stream-start", (message) => {
      try {
        const event = JSON.parse(message.data);
        startPlayer(event.sessionId, event.mimeType);
      } catch {
        setStatus("Impossible d’initialiser le direct.", false);
      }
    });

    source.addEventListener("chunk", (message) => {
      try { enqueueChunk(JSON.parse(message.data)); } catch {}
    });

    source.addEventListener("stream-stop", (message) => {
      try {
        const event = JSON.parse(message.data);
        if (!activeSessionId || event.sessionId === activeSessionId) stopPlayer();
      } catch {
        stopPlayer();
      }
    });

    source.onerror = () => {
      if (!liveActive) setStatus("Connexion au service Live…", false);
    };
  };

  soundButton?.addEventListener("click", () => {
    video.muted = !video.muted;
    soundButton.textContent = video.muted ? "Activer le son" : "Couper le son";
    if (!video.muted) video.play().catch(() => {});
  });

  fetch(`${API_BASE}/api/v1/live/state`, { headers: { Accept: "application/json" } })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("state")))
    .then((payload) => applyState(payload.live))
    .catch(() => setStatus("Connexion au service Live…", false))
    .finally(connectEvents);
})();
