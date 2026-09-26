(function (global) {
  "use strict";

  var ICE = {
    iceServers: [
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:stun.l.google.com:19302" }
    ],
    bundlePolicy: "max-bundle",
    iceCandidatePoolSize: 4
  };

  function waitIce(pc) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (!done) { done = true; resolve(); } }
      pc.addEventListener("icegatheringstatechange", function () {
        if (pc.iceGatheringState === "complete") finish();
      });
      setTimeout(finish, 3000);
    });
  }

  function waitConnected(pc, timeoutMs) {
    timeoutMs = timeoutMs || 10000;
    if (pc.connectionState === "connected" || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        finish(false, new Error("La connexion vidéo temps réel n'a pas pu être établie."));
      }, timeoutMs);
      function cleanup() {
        clearTimeout(timer);
        pc.removeEventListener("connectionstatechange", onChange);
        pc.removeEventListener("iceconnectionstatechange", onChange);
      }
      function finish(ok, error) {
        if (done) return;
        done = true;
        cleanup();
        if (ok) resolve();
        else reject(error || new Error("Connexion vidéo interrompue."));
      }
      function onChange() {
        if (pc.connectionState === "connected" || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
          finish(true);
          return;
        }
        if (pc.connectionState === "failed" || pc.connectionState === "closed" || pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") {
          finish(false, new Error("La connexion vidéo temps réel a échoué."));
        }
      }
      pc.addEventListener("connectionstatechange", onChange);
      pc.addEventListener("iceconnectionstatechange", onChange);
      onChange();
    });
  }

  function tuneLiveTrack(track) {
    try {
      if (track && track.kind === "video" && "contentHint" in track) track.contentHint = "motion";
    } catch (e) {}
  }

  function usedCameraId(stream, fallback) {
    try {
      var track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
      var settings = track && track.getSettings ? track.getSettings() : {};
      return String(settings.deviceId || fallback || "");
    } catch (e) {
      return String(fallback || "");
    }
  }

  async function devices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return { cameras: [], microphones: [] };
    var list = await navigator.mediaDevices.enumerateDevices();
    return {
      cameras: list.filter(function (d) { return d.kind === "videoinput"; }),
      microphones: list.filter(function (d) { return d.kind === "audioinput"; })
    };
  }

  async function post(path, body, headers, keepalive) {
    var response = await fetch(path, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
      cache: "no-store",
      keepalive: Boolean(keepalive)
    });
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok || payload.ok === false) {
      var err = new Error(payload.error || "Publication WebRTC impossible.");
      err.status = response.status;
      err.code = payload.code || "";
      throw err;
    }
    return payload;
  }

  function waitForPreview(preview, stream, timeoutMs) {
    if (!preview) return Promise.resolve(true);
    preview.srcObject = stream;
    preview.muted = true;
    preview.playsInline = true;
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = null;
      function finish(ok, error) {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        preview.removeEventListener("loadeddata", ready);
        preview.removeEventListener("playing", ready);
        if (ok) resolve(true);
        else reject(error || new Error("La caméra ne fournit aucune image."));
      }
      function ready() {
        if (preview.videoWidth > 0 && preview.videoHeight > 0) {
          preview.play().catch(function () {});
          finish(true);
        }
      }
      preview.addEventListener("loadeddata", ready);
      preview.addEventListener("playing", ready);
      preview.play().catch(function () {});
      timer = setTimeout(function () {
        var track = stream.getVideoTracks && stream.getVideoTracks()[0];
        var reason = track && track.muted
          ? "La caméra est active mais son flux vidéo est muet. Essayez un autre port USB ou relancez la caméra."
          : "La caméra est ouverte mais aucune image vidéo n'est reçue. Essayez un autre port USB ou relancez la caméra.";
        finish(false, new Error(reason));
      }, timeoutMs || 5000);
      ready();
    });
  }

  async function publish(opts) {
    opts = opts || {};
    var liveId = String(opts.liveId || "");
    var token = String(opts.token || "");
    var grantToken = String(opts.grantToken || "");
    var pairToken = String(opts.pairToken || "");
    var sourceId = String(opts.sourceId || (pairToken ? "secondary" : "primary"));
    var preview = opts.preview;
    if (!liveId && !pairToken) throw new Error("Identifiant Live manquant.");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Ce navigateur ne peut pas publier de caméra/micro.");
    }

    var headers = { Accept: "application/json", "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    if (grantToken) headers["x-live-admin-grant"] = grantToken;

    var stream;
    var videoProfile = sourceId === "secondary" && !pairToken ? "secondary" : "primary";
    if (global.CardoriaLiveMedia && CardoriaLiveMedia.getUserMediaStream) {
      stream = await CardoriaLiveMedia.getUserMediaStream({
        cameraId: opts.cameraId,
        microphoneId: opts.microphoneId,
        audio: opts.audio,
        isMobile: opts.isMobile,
        videoProfile: videoProfile
      });
    } else {
      var video = opts.cameraId ? { deviceId: { exact: opts.cameraId } } : true;
      if (sourceId === "secondary" && video !== true) {
        video.width = { ideal: 640, max: 1280 };
        video.height = { ideal: 480, max: 720 };
        video.frameRate = { ideal: 24, max: 30 };
      }
      var audio = opts.microphoneId
        ? { deviceId: { exact: opts.microphoneId } }
        : (opts.audio === false ? false : true);
      stream = await navigator.mediaDevices.getUserMedia({ video: video, audio: audio });
    }

    var videoTrack = stream.getVideoTracks && stream.getVideoTracks()[0];
    if (!videoTrack) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      throw new Error("Aucun flux vidéo reçu depuis cette caméra.");
    }
    stream.getTracks().forEach(tuneLiveTrack);

    try {
      await waitForPreview(preview, stream, 5000);
    } catch (previewError) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      if (preview) preview.srcObject = null;
      throw previewError;
    }

    var bootstrap = new RTCPeerConnection(ICE);
    stream.getTracks().forEach(function (track) { bootstrap.addTrack(track, stream); });
    var offer = await bootstrap.createOffer();
    await bootstrap.setLocalDescription(offer);
    await waitIce(bootstrap);
    var local = bootstrap.localDescription || offer;
    var tracks = bootstrap.getTransceivers()
      .filter(function (item) { return item.sender && item.sender.track; })
      .map(function (item) {
        return {
          mid: item.mid,
          trackName: sourceId + "-" + (item.sender.track.kind === "video" ? "camera" : "microphone"),
          kind: item.sender.track.kind
        };
      });

    var response = await fetch("/api/live/webrtc/publisher/start", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        liveSessionId: liveId,
        pairToken: pairToken || undefined,
        sourceId: sourceId,
        offer: { type: "offer", sdp: local.sdp || "" },
        tracks: tracks
      }),
      cache: "no-store"
    });
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok || payload.ok === false) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      bootstrap.close();
      if (preview) preview.srcObject = null;
      var startError = new Error(payload.error || "Publication WebRTC impossible.");
      startError.status = response.status;
      startError.code = payload.code || "";
      throw startError;
    }

    liveId = payload.liveId || liveId;
    sourceId = payload.sourceId || sourceId;
    var publisherKey = String(payload.publisherKey || "");
    if (!publisherKey) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      bootstrap.close();
      if (preview) preview.srcObject = null;
      throw new Error("Clé de diffusion manquante.");
    }

    var stopped = false;
    var heartbeatTimer = null;

    function startPublisherHeartbeat() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(function () {
        if (stopped) return;
        post("/api/live/webrtc/publisher/heartbeat", {
          liveSessionId: liveId,
          sourceId: sourceId,
          publisherKey: publisherKey
        }, headers).catch(function () {});
      }, 5000);
    }

    async function stopServerRegistration() {
      try {
        await post("/api/live/webrtc/publisher/stop", {
          liveSessionId: liveId,
          sourceId: sourceId,
          publisherKey: publisherKey
        }, headers, true);
      } catch (e) {}
    }

    if (payload.mode !== "p2p") {
      try {
        if (payload.answer) await bootstrap.setRemoteDescription(payload.answer);
        await waitConnected(bootstrap, 10000);
        await post("/api/live/webrtc/publisher/ready", {
          liveSessionId: liveId,
          sourceId: sourceId,
          publisherKey: publisherKey
        }, headers);
      } catch (error) {
        stopped = true;
        stream.getTracks().forEach(function (track) { track.stop(); });
        bootstrap.close();
        if (preview) preview.srcObject = null;
        await stopServerRegistration();
        throw error;
      }
      startPublisherHeartbeat();
      return {
        liveId: liveId,
        sourceId: sourceId,
        stream: stream,
        cameraId: usedCameraId(stream, opts.cameraId),
        mode: "cloudflare",
        stop: async function () {
          if (stopped) return;
          stopped = true;
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          stream.getTracks().forEach(function (track) { track.stop(); });
          bootstrap.close();
          if (preview) preview.srcObject = null;
          await stopServerRegistration();
        }
      };
    }

    bootstrap.close();
    var peers = new Map();
    var pollDelay = 500;
    var pollTimer = null;
    var pollBusy = false;

    function removePeer(viewerId, pc) {
      if (peers.get(viewerId) === pc) peers.delete(viewerId);
      try { pc.close(); } catch (e) {}
    }

    async function handleOffer(item) {
      if (stopped || peers.has(item.viewerId)) return;
      var pc = new RTCPeerConnection(ICE);
      peers.set(item.viewerId, pc);
      stream.getTracks().forEach(function (track) { pc.addTrack(track, stream); });
      pc.addEventListener("connectionstatechange", function () {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") removePeer(item.viewerId, pc);
        if (pc.connectionState === "disconnected") {
          setTimeout(function () {
            if (pc.connectionState === "disconnected") removePeer(item.viewerId, pc);
          }, 3000);
        }
      });
      try {
        await pc.setRemoteDescription(item.offer);
        var answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitIce(pc);
        var desc = pc.localDescription || answer;
        await post("/api/live/webrtc/publisher/answer", {
          liveSessionId: liveId,
          sourceId: sourceId,
          publisherKey: publisherKey,
          viewerId: item.viewerId,
          answer: { type: "answer", sdp: desc.sdp || "" }
        }, headers);
      } catch (e) {
        removePeer(item.viewerId, pc);
      }
    }

    function schedulePoll(delay) {
      if (stopped) return;
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = setTimeout(poll, delay == null ? pollDelay : delay);
    }

    async function poll() {
      if (stopped || pollBusy) return;
      pollBusy = true;
      try {
        var data = await post("/api/live/webrtc/publisher/offers", {
          liveSessionId: liveId,
          sourceId: sourceId,
          publisherKey: publisherKey
        }, headers);
        pollDelay = 500;
        (data.offers || []).forEach(function (item) { void handleOffer(item); });
      } catch (e) {
        if (e && e.status === 429) pollDelay = Math.min(10000, Math.max(2000, pollDelay * 2));
        else pollDelay = Math.min(5000, pollDelay + 1000);
      } finally {
        pollBusy = false;
        schedulePoll(pollDelay);
      }
    }

    startPublisherHeartbeat();
    schedulePoll(0);

    return {
      liveId: liveId,
      sourceId: sourceId,
      stream: stream,
      cameraId: usedCameraId(stream, opts.cameraId),
      mode: "p2p",
      stop: async function () {
        if (stopped) return;
        stopped = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (pollTimer) clearTimeout(pollTimer);
        peers.forEach(function (pc, viewerId) { removePeer(viewerId, pc); });
        peers.clear();
        stream.getTracks().forEach(function (track) { track.stop(); });
        if (preview) preview.srcObject = null;
        await stopServerRegistration();
      }
    };
  }

  global.CardoriaLivePublisher = { publish: publish, devices: devices };
})(window);
