(() => {
  const video = document.getElementById("cardoriaLiveVideo");
  const stateNode = document.getElementById("cardoriaLiveState");
  const viewersNode = document.getElementById("cardoriaLiveViewers");
  const soundButton = document.getElementById("cardoriaLiveSound");
  const stageNode = document.getElementById("cardoriaLiveStage");
  const directoryNode = document.getElementById("cardoriaLiveDirectory");
  const directoryStateNode = document.getElementById("cardoriaLiveDirectoryState");
  const scheduledNode = document.getElementById("cardoriaLiveScheduledDirectory");
  const scheduledStateNode = document.getElementById("cardoriaLiveScheduledState");
  const categoryFilter = document.getElementById("cardoriaLiveCategoryFilter");
  if (!(video instanceof HTMLVideoElement) || !stateNode || !viewersNode || !stageNode || !directoryNode || !scheduledNode) return;
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

  const search = new URLSearchParams(window.location.search);
  let focusLiveId = String(search.get("session") || "").trim();
  const roomMode = Boolean(focusLiveId);
  document.body.dataset.liveView = roomMode ? "room" : "directory";
  const urlPrivilegeFlags = { admin: search.get("admin"), free: search.get("free"), noFee: search.get("noFee") };
  const urlFlagsNeverGrantAdmin = true;
  void urlPrivilegeFlags;
  void urlFlagsNeverGrantAdmin;

  const WAITING_TITLE = "Live en cours — en attente de diffusion";
  const WAITING_COPY = "La salle est ouverte. La vidéo apparaîtra dès qu'une caméra diffuse.";
  const ICE = { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }], bundlePolicy: "max-bundle", iceCandidatePoolSize: 4 };

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
  let reconnectTimer = null;
  let reconnectBusy = false;
  let currentTransport = "";
  let connectedSourceIds = new Set();
  let directorySelection = { id: "", kind: "live" };
  let selectedCategory = String(search.get("category") || "").trim().toLowerCase();
  const CATEGORY_LABELS = { pokemon: "Pokémon", yugioh: "Yu-Gi-Oh!", onepiece: "One Piece", lorcana: "Lorcana", magic: "Magic", other: "Autre" };
  const PLAN_BADGE_CLASS = { cardoria: "is-cardoria", elite: "is-elite", pro: "is-pro", starter: "is-starter" };

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

  const hasLiveVideo = (node) => {
    try { return Boolean(node?.srcObject?.getVideoTracks?.().some((track) => track.readyState !== "ended")); }
    catch { return false; }
  };

  const layoutStage = () => {
    const mediaCount = (hasLiveVideo(video) ? 1 : 0)
      + [...stageNode.querySelectorAll("[data-live-source-video]")].filter(hasLiveVideo).length;
    const count = Math.max(mediaCount, peerConnections.size);
    stageNode.dataset.sources = String(count);
    stageNode.querySelectorAll("[data-live-source-video]").forEach((node) => {
      node.style.cssText = count >= 2
        ? "width:100%;height:100%;object-fit:contain;background:#000;position:static;inset:auto;border:0;border-radius:0"
        : "position:absolute;right:12px;bottom:12px;width:34%;height:34%;object-fit:cover;border:2px solid #e6c25a;border-radius:12px;background:#000;z-index:3";
    });
  };

  const sourceTarget = (sourceId) => {
    if (sourceId === "primary") return video;
    let target = stageNode.querySelector(`[data-live-source-video="${sourceId}"]`);
    if (!target) {
      target = document.createElement("video");
      target.dataset.liveSourceVideo = sourceId;
      target.autoplay = true;
      target.playsInline = true;
      target.muted = true;
      stageNode.style.position = "relative";
      stageNode.appendChild(target);
    }
    return target;
  };

  const sameSources = (a, b) => a.size === b.size && [...a].every((value) => b.has(value));

  const clearReconnect = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const scheduleReconnect = (sessionId, delay = 750) => {
    if (!sessionId || activeSessionId !== sessionId || reconnectTimer || reconnectBusy) return;
    setStatus("Connexion au live interrompue. Reconnexion…", false, true);
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (activeSessionId !== sessionId || reconnectBusy) return;
      reconnectBusy = true;
      let failed = false;
      try {
        await connectRealtime(sessionId);
      } catch {
        failed = true;
      } finally {
        reconnectBusy = false;
      }
      if (failed && activeSessionId === sessionId) scheduleReconnect(sessionId, 1500);
    }, delay);
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

  const tuneReceiverForLowLatency = (receiver) => {
    if (!receiver) return;
    try { if ("jitterBufferTarget" in receiver) receiver.jitterBufferTarget = 50; } catch {}
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
    }, 250);
  });

  const attachRemote = (sessionId, sourceId, pc, index) => {
    const remoteStream = new MediaStream();
    let disconnectTimer = null;
    pc.addEventListener("track", (event) => {
      if (activeSessionId !== sessionId) return;
      tuneReceiverForLowLatency(event.receiver);
      remoteStream.addTrack(event.track);
      const target = sourceId === "primary" || index === 0 ? video : sourceTarget(sourceId);
      target.srcObject = remoteStream;
      target.muted = target === video ? video.muted : true;
      soundButton?.removeAttribute("hidden");
      liveActive = true;
      connectedSourceIds.add(sourceId);
      setStatus("LIVE EN COURS", true, false);
      layoutStage();
      target.play().catch(() => {});
    });
    pc.addEventListener("connectionstatechange", () => {
      if (activeSessionId !== sessionId) return;
      if (pc.connectionState === "connected") {
        if (disconnectTimer) clearTimeout(disconnectTimer);
        disconnectTimer = null;
        return;
      }
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        detachSource(sourceId);
        connectedSourceIds.delete(sourceId);
        scheduleReconnect(sessionId, 500);
        return;
      }
      if (pc.connectionState === "disconnected" && !disconnectTimer) {
        disconnectTimer = setTimeout(() => {
          disconnectTimer = null;
          if (pc.connectionState === "disconnected" && activeSessionId === sessionId) {
            detachSource(sourceId);
            connectedSourceIds.delete(sourceId);
            scheduleReconnect(sessionId, 500);
          }
        }, 1500);
      }
    });
  };

  const attachCloudflareRemote = (sessionId, pc, subscriptions = []) => {
    const byMid = new Map((subscriptions || []).map((item) => [String(item.mid ?? ""), item]));
    const sourceOrder = [...new Set((subscriptions || []).map((item) => String(item.sourceId || "")).filter(Boolean))];
    const mainSourceId = sourceOrder.includes("primary") ? "primary" : (sourceOrder[0] || "primary");
    const streams = new Map();
    pc.addEventListener("track", (event) => {
      if (activeSessionId !== sessionId) return;
      tuneReceiverForLowLatency(event.receiver);
      const mid = String(event.transceiver?.mid ?? "");
      const meta = byMid.get(mid) || {};
      const sourceId = String(meta.sourceId || "primary");
      let remoteStream = streams.get(sourceId);
      if (!remoteStream) {
        remoteStream = new MediaStream();
        streams.set(sourceId, remoteStream);
      }
      remoteStream.addTrack(event.track);
      const target = sourceId === mainSourceId ? video : sourceTarget(sourceId);
      target.srcObject = remoteStream;
      target.muted = target === video ? video.muted : true;
      connectedSourceIds.add(sourceId);
      soundButton?.removeAttribute("hidden");
      liveActive = true;
      setStatus("LIVE EN COURS", true, false);
      layoutStage();
      target.play().catch(() => {});
    });
    let disconnectTimer = null;
    pc.addEventListener("connectionstatechange", () => {
      if (activeSessionId !== sessionId) return;
      if (pc.connectionState === "connected") {
        if (disconnectTimer) clearTimeout(disconnectTimer);
        disconnectTimer = null;
        return;
      }
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        scheduleReconnect(sessionId, 500);
        return;
      }
      if (pc.connectionState === "disconnected" && !disconnectTimer) {
        disconnectTimer = setTimeout(() => {
          disconnectTimer = null;
          if (pc.connectionState === "disconnected" && activeSessionId === sessionId) {
            scheduleReconnect(sessionId, 500);
          }
        }, 1500);
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
    clearReconnect();
    peerConnection?.close();
    peerConnection = null;
    peerConnections.forEach((pc) => pc.close());
    peerConnections.clear();
    video.pause();
    video.srcObject = null;
    removeSecondaryVideos();
    connectedSourceIds = new Set();
    currentTransport = "";
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
    setOfflineCopy("Ce Live n'est plus disponible", "Il est terminé ou a été retiré. Retour à la liste des Lives.");
    setTimeout(() => location.assign("/live.html"), 1200);
  };

  const startHeartbeat = (sessionId, intervalMs = 3000) => {
    heartbeatTimer = setInterval(async () => {
      if (!viewerId || activeSessionId !== sessionId) return;
      try {
        const heartbeat = await apiPost("/api/live/webrtc/viewer/heartbeat", { viewerId });
        if (Number.isFinite(Number(heartbeat?.viewerCount))) setViewers(heartbeat.viewerCount);
        if (heartbeat?.active === false) {
          await markLiveEnded("Ce Live est terminé. Retour à l'annuaire.");
          return;
        }
        const sources = Array.isArray(heartbeat?.sources) ? heartbeat.sources.map(String) : [];
        if (heartbeat?.provider === "cardoria-p2p") {
          try {
            await syncViewerSources(sessionId, sources);
            connectedSourceIds = new Set(sources);
          } catch {}
        } else if (heartbeat?.provider === "cloudflare-realtime") {
          const nextSources = new Set(sources);
          if ((currentTransport === "cloudflare-waiting" && nextSources.size)
            || (currentTransport === "cloudflare" && !sameSources(nextSources, connectedSourceIds))) {
            scheduleReconnect(sessionId, 250);
          }
        }
        if (!sources.length) {
          liveActive = false;
          setStatus(WAITING_TITLE, false, true);
        }
      } catch {}
    }, intervalMs);
  };

  const connectP2P = async (sessionId, start) => {
    viewerId = start.viewerId;
    currentTransport = "p2p";
    const sources = Array.isArray(start.sources) ? start.sources : [];
    connectedSourceIds = new Set(sources.map((source) => String(source.sourceId || "")));
    startHeartbeat(sessionId, 1000);
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
    currentTransport = "cloudflare";
    const subscriptions = Array.isArray(start.subscriptions) ? start.subscriptions : [];
    connectedSourceIds = new Set(subscriptions.map((item) => String(item.sourceId || "")).filter(Boolean));
    const pc = new RTCPeerConnection(ICE);
    peerConnection = pc;
    attachCloudflareRemote(sessionId, pc, subscriptions);
    await pc.setRemoteDescription(start.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await apiPost("/api/live/webrtc/viewer/answer", { viewerId, answer: { type: "answer", sdp: answer.sdp || "" } });
    startHeartbeat(sessionId, 1000);
  };

  const connectRealtime = async (sessionId) => {
    await stopWebRtcViewer(true);
    if (activeSessionId !== sessionId) return;
    setStatus("Connexion WebRTC au live…", false, true);
    const start = await apiPost("/api/live/webrtc/viewer/start", { liveSessionId: sessionId });
    setViewers(start.viewerCount || 0);
    if (start.waiting && start.provider === "cloudflare-realtime") {
      viewerId = start.viewerId;
      currentTransport = "cloudflare-waiting";
      connectedSourceIds = new Set();
      liveActive = false;
      setStatus(WAITING_TITLE, false, true);
      startHeartbeat(sessionId, 1000);
      return;
    }
    if (start.mode === "p2p" || start.provider === "cardoria-p2p") await connectP2P(sessionId, start);
    else await connectCloudflare(sessionId, start);
  };

  const highlightDirectory = (sessionId) => {
    document.querySelectorAll("[data-session-id]").forEach((button) => {
      button.dataset.selected = button.dataset.sessionId === sessionId ? "true" : "false";
    });
  };

  const safeCover = (session) => {
    const cover = String(session?.coverUrl || "/assets/logo/cardoria-premium.png");
    return cover.startsWith("/") && !cover.startsWith("//") && !cover.includes("..") ? cover : "/assets/logo/cardoria-premium.png";
  };

  const formatWhen = (value) => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "";
  };

  const appendDirectoryCard = (target, session, { selectable, selected }) => {
    const card = document.createElement("article");
    const planId = String(session.planId || "starter");
    card.className = "live-card-select" + (session.featured ? " is-featured" : planId === "pro" ? " is-pro" : "");
    card.dataset.sessionId = session.id;
    card.dataset.liveStatus = session.status || "";
    card.dataset.liveCategory = session.category || "other";
    card.dataset.livePlan = planId;
    if (selectable) card.dataset.liveOpen = "true";
    card.dataset.selected = selected ? "true" : "false";
    const host = session.hostName || (session.ownerRole === "admin" ? "Cardoria" : "Liveur Cardoria");
    const live = session.status === "live";
    const statusLabel = live
      ? (session.streamPublished ? "En direct · vidéo en cours" : "En direct · en attente de diffusion")
      : "Programmé";
    const when = live
      ? (formatWhen(session.startedAt) ? "Démarré le " + formatWhen(session.startedAt) : "En cours")
      : (formatWhen(session.scheduledAt) ? formatWhen(session.scheduledAt) : "Bientôt");
    const viewers = live ? `${Math.max(0, Number(session.viewerCount || 0))} spectateur${Number(session.viewerCount || 0) > 1 ? "s" : ""}` : "";
    const planLabel = session.planLabel || (planId === "elite" ? "Elite" : planId === "pro" ? "Pro" : planId === "cardoria" ? "Officiel" : "Starter");
    const categoryLabel = CATEGORY_LABELS[session.category] || "";
    card.innerHTML = `<span class="live-card-thumb"><img src="${esc(safeCover(session))}" alt=""></span><span><strong>${esc(session.title || "Live Cardoria")}</strong><small>${esc(host)}</small><small>${esc(statusLabel)} · ${esc(when)}${viewers ? " · " + esc(viewers) : ""}</small><span class="live-plan-badge ${PLAN_BADGE_CLASS[planId] || "is-starter"}">${esc(planLabel)}</span>${categoryLabel ? `<span class="live-cat-badge">${esc(categoryLabel)}</span>` : ""}</span><button type="button" class="live-card-cta${selectable ? "" : " is-soon"}">${selectable ? "Regarder" : "À venir"}</button>`;
    if (selectable) {
      card.addEventListener("click", () => {
        location.assign(`/live.html?session=${encodeURIComponent(session.id)}`);
      });
    }
    target.appendChild(card);
  };

  const connectSession = async (sessionId) => {
    if (!sessionId || connectingSessionId === sessionId) return;
    connectingSessionId = sessionId;
    directorySelection = { id: sessionId, kind: "live" };
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

  const renderLiveDirectory = (visible, allLive = visible) => {
    if (directoryStateNode) directoryStateNode.textContent = visible.length ? `${visible.length} live${visible.length > 1 ? "s" : ""} en cours` : "Aucun live en cours";
    directoryNode.innerHTML = "";
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "live-directory-empty";
      empty.textContent = selectedCategory ? "Aucun live en cours dans cette catégorie." : "Aucun liveur n’est en direct pour le moment.";
      directoryNode.appendChild(empty);
      if (!focusLiveId && !liveActive && !allLive.length) {
        activeSessionId = null;
        setStatus("Aucun live public n’est actuellement en cours.", false, false);
        setViewers(0);
      }
    } else {
      visible.forEach((session) => {
        appendDirectoryCard(directoryNode, session, { selectable: true, selected: session.id === directorySelection.id || session.id === activeSessionId || session.id === focusLiveId });
      });
    }
    const promoted = directorySelection.kind === "scheduled"
      ? allLive.find((session) => session.id === directorySelection.id)
      : null;
    if (promoted) {
      directorySelection = { id: promoted.id, kind: "live" };
      if (webrtcConfigured && promoted.id !== activeSessionId) void connectSession(promoted.id);
      return;
    }
    if (directorySelection.kind === "scheduled") return;
    const preferred = focusLiveId
      ? allLive.find((session) => session.id === focusLiveId)
      : allLive.find((session) => session.id === activeSessionId) || allLive.find((session) => session.streamPublished) || allLive[0];
    if (focusLiveId && !preferred && activeSessionId !== focusLiveId) {
      void markLiveEnded("Ce Live n'est plus disponible. Retour à l'annuaire.");
      return;
    }
    if (webrtcConfigured && preferred && preferred.id !== activeSessionId) void connectSession(preferred.id);
  };

  const renderScheduledDirectory = (sessions) => {
    if (scheduledStateNode) scheduledStateNode.textContent = sessions.length ? `${sessions.length} live${sessions.length > 1 ? "s" : ""} programmé${sessions.length > 1 ? "s" : ""}` : "Aucun live programmé";
    scheduledNode.innerHTML = "";
    if (!sessions.length) {
      const empty = document.createElement("div");
      empty.className = "live-directory-empty";
      empty.textContent = selectedCategory ? "Aucun live programmé dans cette catégorie." : "Aucun live n’est programmé pour le moment.";
      scheduledNode.appendChild(empty);
      return;
    }
    sessions.forEach((session) => {
      appendDirectoryCard(scheduledNode, session, { selectable: false, selected: session.id === directorySelection.id });
    });
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
    try {
      const response = await fetch("/api/live/sessions?status=all", { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error("directory");
      const payload = await response.json();
      const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
      const liveSessions = sessions.filter((session) => session.status === "live");
      const scheduledSessions = sessions.filter((session) => session.status === "scheduled");
      const visibleLive = selectedCategory ? liveSessions.filter((session) => session.category === selectedCategory) : liveSessions;
      const visibleScheduled = selectedCategory ? scheduledSessions.filter((session) => session.category === selectedCategory) : scheduledSessions;
      renderLiveDirectory(visibleLive, liveSessions);
      renderScheduledDirectory(visibleScheduled);
    } catch {
      if (directoryStateNode) directoryStateNode.textContent = "Impossible de lister les Lives.";
      if (scheduledStateNode) scheduledStateNode.textContent = "Impossible de lister les Lives programmés.";
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

  const syncCategoryUrl = (value) => {
    selectedCategory = String(value || "").trim().toLowerCase();
    try {
      const url = new URL(window.location.href);
      if (selectedCategory) url.searchParams.set("category", selectedCategory);
      else url.searchParams.delete("category");
      history.replaceState({}, "", url.pathname + url.search + url.hash);
    } catch {}
  };

  if (categoryFilter) {
    if (selectedCategory && ![...categoryFilter.options].some((option) => option.value === selectedCategory)) selectedCategory = "";
    categoryFilter.value = selectedCategory;
    categoryFilter.addEventListener("change", () => {
      syncCategoryUrl(categoryFilter.value);
      void loadDirectory();
    });
  }

  soundButton?.addEventListener("click", () => {
    video.muted = !video.muted;
    soundButton.textContent = video.muted ? "Activer le son" : "Couper le son";
    if (!video.muted) video.play().catch(() => {});
  });

  if (roomMode) {
    void loadFocusedLive();
  } else {
    void loadDirectory();
    directoryTimer = setInterval(loadDirectory, 10000);
  }
  window.addEventListener("beforeunload", () => {
    if (directoryTimer) clearInterval(directoryTimer);
    stopHeartbeat();
    clearReconnect();
    if (viewerId) {
      try { navigator.sendBeacon?.("/api/live/webrtc/viewer/stop", new Blob([JSON.stringify({ viewerId })], { type: "application/json" })); } catch {}
    }
    peerConnection?.close();
    peerConnections.forEach((pc) => pc.close());
  }, { once: true });
})();
