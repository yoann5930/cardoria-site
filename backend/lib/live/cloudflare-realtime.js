const DEFAULT_BASE_URL = "https://rtc.live.cloudflare.com/v1";

function config() {
  const appId = String(process.env.CLOUDFLARE_REALTIME_APP_ID || "").trim();
  const secret = String(process.env.CLOUDFLARE_REALTIME_APP_SECRET || "").trim();
  const baseUrl = String(process.env.CLOUDFLARE_REALTIME_API_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  if (!appId || !secret) {
    const error = new Error("Cloudflare Realtime is not configured.");
    error.status = 503;
    error.code = "CLOUDFLARE_REALTIME_NOT_CONFIGURED";
    throw error;
  }
  return { appId, secret, baseUrl };
}

async function cloudflareRequest(path, init = {}) {
  const { appId, secret, baseUrl } = config();
  const response = await fetch(`${baseUrl}/apps/${encodeURIComponent(appId)}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${secret}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {})
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.errorCode) {
    const error = new Error(payload?.errorDescription || `Cloudflare Realtime request failed (${response.status}).`);
    error.status = 502;
    error.code = payload?.errorCode || "CLOUDFLARE_REALTIME_ERROR";
    throw error;
  }
  return payload;
}

export function isCloudflareRealtimeConfigured() {
  return Boolean(process.env.CLOUDFLARE_REALTIME_APP_ID && process.env.CLOUDFLARE_REALTIME_APP_SECRET);
}

export async function createCloudflareSession() {
  const result = await cloudflareRequest("/sessions/new", { method: "POST" });
  if (!result.sessionId) {
    const error = new Error("Cloudflare did not return a session id.");
    error.status = 502;
    error.code = "CLOUDFLARE_REALTIME_INVALID_RESPONSE";
    throw error;
  }
  return result.sessionId;
}

export async function publishCloudflareTracks({ cloudflareSessionId, offer, tracks }) {
  const result = await cloudflareRequest(`/sessions/${encodeURIComponent(cloudflareSessionId)}/tracks/new`, {
    method: "POST",
    body: JSON.stringify({
      sessionDescription: offer,
      tracks: tracks.map((track) => ({ location: "local", mid: track.mid, trackName: track.trackName, kind: track.kind }))
    })
  });
  if (!result.sessionDescription) {
    const error = new Error("Cloudflare did not return a WebRTC answer.");
    error.status = 502;
    error.code = "CLOUDFLARE_REALTIME_INVALID_RESPONSE";
    throw error;
  }
  const publishedTracks = (result.tracks || [])
    .filter((track) => !track.errorCode && track.trackName)
    .map((track) => ({ location: "remote", sessionId: cloudflareSessionId, trackName: track.trackName }));
  if (!publishedTracks.length) {
    const error = new Error("Cloudflare did not publish any media tracks.");
    error.status = 502;
    error.code = "CLOUDFLARE_REALTIME_NO_TRACKS";
    throw error;
  }
  return { answer: result.sessionDescription, tracks: publishedTracks };
}

export async function subscribeCloudflareTracks({ tracks }) {
  const cloudflareSessionId = await createCloudflareSession();
  const result = await cloudflareRequest(`/sessions/${encodeURIComponent(cloudflareSessionId)}/tracks/new`, {
    method: "POST",
    body: JSON.stringify({ tracks })
  });
  if (!result.sessionDescription) {
    const error = new Error("Cloudflare did not return a viewer WebRTC offer.");
    error.status = 502;
    error.code = "CLOUDFLARE_REALTIME_INVALID_RESPONSE";
    throw error;
  }
  return {
    cloudflareSessionId,
    offer: result.sessionDescription,
    mids: (result.tracks || []).filter((track) => !track.errorCode).map((track) => track.mid)
  };
}

export async function renegotiateCloudflareSession({ cloudflareSessionId, answer }) {
  await cloudflareRequest(`/sessions/${encodeURIComponent(cloudflareSessionId)}/renegotiate`, {
    method: "PUT",
    body: JSON.stringify({ sessionDescription: answer })
  });
}
