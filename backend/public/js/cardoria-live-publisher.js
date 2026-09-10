(function (global) {
  "use strict";

  var ICE = { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], bundlePolicy: "max-bundle" };

  function waitIce(pc) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        resolve();
      }
      pc.addEventListener("icegatheringstatechange", function () {
        if (pc.iceGatheringState === "complete") finish();
      });
      setTimeout(finish, 2500);
    });
  }

  async function publish(opts) {
    var liveId = String((opts && opts.liveId) || "");
    var token = String((opts && opts.token) || "");
    var preview = opts && opts.preview;
    if (!liveId) throw new Error("Identifiant Live manquant.");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Ce navigateur ne peut pas publier de caméra/micro.");
    }
    var headers = { Accept: "application/json", "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    var stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    var pc = new RTCPeerConnection(ICE);
    stream.getTracks().forEach(function (track) {
      pc.addTrack(track, stream);
    });
    if (preview) {
      preview.srcObject = stream;
      preview.muted = true;
      preview.playsInline = true;
      preview.play().catch(function () {});
    }
    var offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIce(pc);
    var local = pc.localDescription || offer;
    var tracks = pc.getTransceivers().filter(function (item) {
      return item.sender && item.sender.track;
    }).map(function (item) {
      return {
        mid: item.mid,
        trackName: item.sender.track.kind === "video" ? "camera" : "microphone",
        kind: item.sender.track.kind
      };
    });
    var response = await fetch("/api/live/webrtc/publisher/start", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        liveSessionId: liveId,
        offer: { type: "offer", sdp: local.sdp || "" },
        tracks: tracks
      })
    });
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok || payload.ok === false) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      pc.close();
      if (payload.code === "CLOUDFLARE_REALTIME_NOT_CONFIGURED" || response.status === 503) {
        throw new Error("Service vidéo Live indisponible");
      }
      throw new Error(payload.error || "Publication WebRTC impossible.");
    }
    if (payload.answer) await pc.setRemoteDescription(payload.answer);
    return {
      liveId: liveId,
      stream: stream,
      stop: async function () {
        stream.getTracks().forEach(function (track) { track.stop(); });
        pc.close();
        if (preview) preview.srcObject = null;
        try {
          await fetch("/api/live/webrtc/publisher/stop", {
            method: "POST",
            headers: headers,
            body: JSON.stringify({ liveSessionId: liveId }),
            keepalive: true
          });
        } catch (error) {}
      }
    };
  }

  global.CardoriaLivePublisher = { publish: publish };
})(window);
