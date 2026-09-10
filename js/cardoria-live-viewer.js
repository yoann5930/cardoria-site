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

  const search = new URLSearchParams(window.location.search);
  const focusLiveId = String(search.get("session") || "").trim();
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
  const providerLabel = (session = {}) => session.ownerRole === "seller" || session.paymentProvider === "paypal" ? "PayPal" : "SumUp";

  const renderAdminBar = (access) => {
    const bar = document.getElementById("cardoriaLiveAdminBar");
    if (!bar || !access) return;
    const session = access.session || {};
    const title = access.title || session.title || "Live Cardoria";
    bar.hidden = false;
    document.getElementById("cardoriaLiveAdminTitle").textContent = title;
    document.getElementById("cardoriaLiveAdminMode").textContent = "Mode Admin / Cardoria — accès interne sans frais";
    const metaNode = document.getElementById("cardoriaLiveAdminMeta");
    if (metaNode) metaNode.textContent = `${title} · ${session.status || ""} · ventes visiteurs : ${providerLabel(session)} (aucun paiement créé pour cet accès)`;
    document.title = title + " — Admin Cardoria";
    const heading = document.querySelector(".live-brand h1");
    if (heading) heading.textContent = title;
    const toolsNode = document.getElementById("cardoriaLiveAdminTools");
    if (toolsNode && adminSessionToken() && session.id) {
      toolsNode.innerHTML = `<button type="button" data-admin-live-start="${session.id}">Démarrer</button><button type="button" data-admin-live-stop="${session.id}">Arrêter</button><a href="/admin-live.html">Retour Admin Lives</a>`;
      toolsNode.querySelector("[data-admin-live-start]")?.addEventListener("click", () => adminAction(session.id, "start"));
      toolsNode.querySelector("[data-admin-live-stop]")?.addEventListener("click", () => adminAction(session.id, "stop"));
    }
  };
  const adminAction = async (id, action) => {
    try {
      const response = await fetch(`/api/admin/live/sessions/${encodeURIComponent(id)}/${action}`, { method: "POST", headers: liveAccessHeaders(), body: "{}" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Action Live impossible");
      location.reload();
    } catch (error) { alert(error.message); }
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
    if (!focusLiveId || (!adminSessionToken() && !grantFromHash())) return;
    try {
      const response = await fetch(`/api/live/sessions/${encodeURIComponent(focusLiveId)}/admin-access`, { headers: liveAccessHeaders(), cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok && payload.accessRole === "admin" && payload.accessContext === "cardoria") renderAdminBar(payload);
    } catch {}
  };

  let mediaSource = null, sourceBuffer = null, objectUrl = null, activeSessionId = null, eventSource = null, peerConnection = null, viewerId = null, heartbeatTimer = null, directoryTimer = null;
  let pendingChunks = [], liveActive = false;
  const setStatus = (message, active = false) => { stateNode.textContent = message; stageNode.dataset.live = active ? "true" : "false"; };
  const setViewers = (count) => { const value = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0; viewersNode.textContent = `${value} spectateur${value > 1 ? "s" : ""}`; };
  const apiPost = async (path, body, keepalive = false) => {
    const response = await fetch(`${API_BASE}${path}`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", keepalive });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message || `Service vidéo Live indisponible (${response.status}).`);
    return payload;
  };
  const base64ToBytes = (base64) => { const binary = atob(base64); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i); return bytes; };
  const stopHeartbeat = () => { if (heartbeatTimer) clearInterval(heartbeatTimer); heartbeatTimer = null; };
  const clearLegacyPlayer = () => { pendingChunks = []; sourceBuffer = null; if (mediaSource?.readyState === "open") { try { mediaSource.endOfStream(); } catch {} } mediaSource = null; if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; };
  const stopWebRtcViewer = async (notify = true) => { stopHeartbeat(); peerConnection?.close(); peerConnection = null; const id = viewerId; viewerId = null; if (notify && id) { try { await apiPost("/api/v1/live/webrtc/viewer/stop", { viewerId: id }, true); } catch {} } };
  const clearPlayer = async () => { eventSource?.close(); eventSource = null; await stopWebRtcViewer(true); clearLegacyPlayer(); video.pause(); video.srcObject = null; video.removeAttribute("src"); video.load(); };
  const appendNext = () => { if (!sourceBuffer || sourceBuffer.updating || !pendingChunks.length) return; const next = pendingChunks.shift(); try { sourceBuffer.appendBuffer(next); } catch { pendingChunks.unshift(next); setTimeout(appendNext, 120); } };
  const startLegacyPlayer = (sessionId, mimeType) => {
    clearLegacyPlayer(); activeSessionId = sessionId;
    if (!window.MediaSource || !MediaSource.isTypeSupported(mimeType)) return setStatus("Format Live non pris en charge par ce navigateur.", false);
    mediaSource = new MediaSource(); objectUrl = URL.createObjectURL(mediaSource); video.src = objectUrl; video.srcObject = null; video.muted = true; soundButton?.removeAttribute("hidden");
    mediaSource.addEventListener("sourceopen", () => { try { sourceBuffer = mediaSource.addSourceBuffer(mimeType); sourceBuffer.mode = "sequence"; sourceBuffer.addEventListener("updateend", appendNext); appendNext(); } catch { setStatus("Impossible d’ouvrir le flux Live.", false); } }, { once: true });
    liveActive = true; setStatus("LIVE EN COURS", true); video.play().catch(() => {});
  };
  const connectCloudflare = async (sessionId) => {
    await stopWebRtcViewer(true); clearLegacyPlayer(); setStatus("Connexion WebRTC au live…", false);
    const start = await apiPost("/api/v1/live/webrtc/viewer/start", { liveSessionId: sessionId });
    if (!start?.viewerId || !start?.offer?.sdp) throw new Error("Signal WebRTC incomplet.");
    viewerId = start.viewerId; setViewers(start.live?.viewerCount || 0);
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], bundlePolicy: "max-bundle" }); peerConnection = pc; const remoteStream = new MediaStream();
    pc.addEventListener("track", (event) => { if (activeSessionId !== sessionId) return; remoteStream.addTrack(event.track); video.srcObject = remoteStream; video.removeAttribute("src"); video.muted = true; soundButton?.removeAttribute("hidden"); liveActive = true; setStatus("LIVE EN COURS", true); video.play().catch(() => {}); });
    await pc.setRemoteDescription(start.offer); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); await apiPost("/api/v1/live/webrtc/viewer/answer", { viewerId, answer: { type: "answer", sdp: answer.sdp || "" } });
    heartbeatTimer = setInterval(async () => { if (!viewerId || activeSessionId !== sessionId) return; try { const hb = await apiPost("/api/v1/live/webrtc/viewer/heartbeat", { viewerId }); if (hb?.active === false) { liveActive = false; setStatus("Le live est terminé.", false); await stopWebRtcViewer(false); } } catch {} }, 30000);
  };
  const connectLegacy = (sessionId) => { eventSource = new EventSource(`${API_BASE}/api/v1/live/sessions/${encodeURIComponent(sessionId)}/events`); eventSource.addEventListener("stream-start", (m) => { try { const e = JSON.parse(m.data); if (e.sessionId === activeSessionId) startLegacyPlayer(e.sessionId, e.mimeType); } catch {} }); eventSource.addEventListener("chunk", (m) => { try { const e = JSON.parse(m.data); if (e.data && e.sessionId === activeSessionId) { pendingChunks.push(base64ToBytes(e.data)); appendNext(); } } catch {} }); eventSource.addEventListener("stream-stop", () => { liveActive = false; setStatus("Le live est terminé.", false); }); eventSource.onerror = () => { if (!liveActive) setStatus("Service vidéo Live indisponible.", false); }; };
  const connectSession = async (sessionId, mimeType) => { if (!sessionId) return; await clearPlayer(); activeSessionId = sessionId; setStatus("Connexion au live…", false); setViewers(0); try { if (mimeType === CLOUDFLARE_MIME) await connectCloudflare(sessionId); else connectLegacy(sessionId); } catch (error) { liveActive = false; setStatus(error.message || "Impossible de rejoindre ce live.", false); } };
  const renderDirectory = (directory) => {
    const sessions = Array.isArray(directory?.sessions) ? directory.sessions : [];
    if (directoryStateNode) directoryStateNode.textContent = sessions.length ? `${sessions.length} live${sessions.length > 1 ? "s" : ""} en cours` : "Aucun live vidéo en cours";
    directoryNode.innerHTML = "";
    if (!sessions.length) { const empty = document.createElement("div"); empty.className = "live-directory-empty"; empty.textContent = "Aucun flux vidéo n’est en direct pour le moment."; directoryNode.appendChild(empty); if (!liveActive) { activeSessionId = null; setStatus("Aucun live public n’est actuellement en cours.", false); setViewers(0); } return; }
    sessions.forEach((session, index) => { const button = document.createElement("button"); button.type = "button"; button.className = "live-card-select"; button.dataset.sessionId = session.sessionId; button.innerHTML = `<span class="live-card-dot"></span><span><strong>Live ${index + 1}</strong><small>${session.viewerCount || 0} spectateur(s)</small></span>`; button.addEventListener("click", () => connectSession(session.sessionId, session.mimeType)); directoryNode.appendChild(button); });
    if (!sessions.some((s) => s.sessionId === activeSessionId)) connectSession(sessions[0].sessionId, sessions[0].mimeType);
  };
  async function loadDirectory() { try { const response = await fetch(`${API_BASE}/api/v1/live/sessions`, { headers: { Accept: "application/json" }, cache: "no-store" }); if (!response.ok) throw new Error(); const payload = await response.json(); renderDirectory(payload.live); } catch { if (directoryStateNode) directoryStateNode.textContent = "Service vidéo Live indisponible"; if (!liveActive) setStatus("Le service vidéo Live est actuellement indisponible.", false); } }
  const loadCardoriaSales = async () => {
    const list = document.getElementById("cardoriaLivePayList"), state = document.getElementById("cardoriaLivePayState"); if (!list) return;
    try { const response = await fetch("/api/live/sessions?status=all", { cache: "no-store" }); const payload = await response.json().catch(() => ({})); const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
      if (!sessions.length) { list.innerHTML = "<p class='live-directory-empty'>Aucun Live Cardoria programmé.</p>"; if (state) state.textContent = "Live Admin = SumUp · Live vendeur = PayPal"; return; }
      list.innerHTML = sessions.map((session) => { const products = (session.products || []).map((item) => `${item.name} (${Number(item.price || 0).toFixed(2)} €)`).join(" · "); return `<article class="live-card-select"><span class="live-card-dot"></span><span><strong>${session.title || "Live Cardoria"}</strong><small>${session.status} · ${providerLabel(session)}${products ? " · " + products : ""}</small></span></article>`; }).join(""); if (state) state.textContent = `${sessions.length} session(s) · paiement forcé par le serveur`;
    } catch { if (state) state.textContent = "Live Admin = SumUp · Live vendeur = PayPal"; }
  };
  soundButton?.addEventListener("click", () => { video.muted = !video.muted; soundButton.textContent = video.muted ? "Activer le son" : "Couper le son"; if (!video.muted) video.play().catch(() => {}); });
  loadDirectory(); loadCardoriaSales(); loadFocusedLiveTitle(); loadAdminLiveAccess(); directoryTimer = setInterval(loadDirectory, 5000); setInterval(loadCardoriaSales, 8000);
  window.addEventListener("beforeunload", () => { if (directoryTimer) clearInterval(directoryTimer); stopHeartbeat(); eventSource?.close(); peerConnection?.close(); }, { once: true });
})();
