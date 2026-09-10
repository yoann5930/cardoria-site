import { randomUUID } from "node:crypto";
import { getLiveSession } from "./sessions.js";
import {
  createCloudflareSession,
  publishCloudflareTracks,
  subscribeCloudflareTracks,
  renegotiateCloudflareSession
} from "./cloudflare-realtime.js";

const publishedLives = new Map();
const viewerSessions = new Map();
const VIEWER_TTL_MS = 90_000;
const LIVE_PUBLISHER_ADMIN_ROLES = ["super_admin", "admin", "employee"];

function requireLive(liveId) {
  const live = getLiveSession(liveId);
  if (!live || live.status !== "live") {
    const error = new Error("Ce Live n'est pas disponible.");
    error.status = 404;
    error.code = "LIVE_SESSION_NOT_FOUND";
    throw error;
  }
  return live;
}

function assertPublisher(live, actor) {
  if (!actor) {
    const error = new Error("Authentification diffuseur requise.");
    error.status = 401;
    throw error;
  }
  const admin = LIVE_PUBLISHER_ADMIN_ROLES.includes(String(actor.role || "").toLowerCase());
  const sellerOwner = live.ownerRole === "seller" && String(live.ownerId || "") === String(actor.id || actor.sellerId || "");
  const adminOwner = live.ownerRole === "admin" && admin;
  if (!sellerOwner && !adminOwner) {
    const error = new Error("Ce Live appartient à un autre diffuseur.");
    error.status = 403;
    error.code = "LIVE_PUBLISHER_MISMATCH";
    throw error;
  }
}

export function cleanupRealtimeViewers() {
  const cutoff = Date.now() - VIEWER_TTL_MS;
  for (const [viewerId, viewer] of viewerSessions) {
    if (viewer.lastSeenAt >= cutoff) continue;
    viewerSessions.delete(viewerId);
  }
}

const cleanupTimer = setInterval(cleanupRealtimeViewers, 30_000);
cleanupTimer.unref?.();

export async function startRealtimePublisher({ liveId, actor, offer, tracks }) {
  const live = requireLive(liveId);
  assertPublisher(live, actor);
  const cloudflareSessionId = await createCloudflareSession();
  const published = await publishCloudflareTracks({ cloudflareSessionId, offer, tracks });
  publishedLives.set(liveId, {
    publisherId: String(actor.id || actor.sellerId || "admin"),
    cloudflareSessionId,
    tracks: published.tracks,
    startedAt: new Date().toISOString()
  });
  return { provider: "cloudflare-realtime", liveId, answer: published.answer };
}

export function stopRealtimePublisher({ liveId, actor }) {
  const live = getLiveSession(liveId);
  if (live) assertPublisher(live, actor);
  publishedLives.delete(liveId);
  for (const [viewerId, viewer] of viewerSessions) {
    if (viewer.liveId === liveId) viewerSessions.delete(viewerId);
  }
  return { ok: true, liveId };
}

export async function startRealtimeViewer(liveId) {
  cleanupRealtimeViewers();
  requireLive(liveId);
  const published = publishedLives.get(liveId);
  if (!published) {
    const error = new Error("La diffusion vidéo n'est pas encore disponible.");
    error.status = 404;
    error.code = "LIVE_STREAM_NOT_PUBLISHED";
    throw error;
  }
  const subscribed = await subscribeCloudflareTracks({ tracks: published.tracks });
  const viewerId = randomUUID();
  viewerSessions.set(viewerId, {
    liveId,
    cloudflareSessionId: subscribed.cloudflareSessionId,
    lastSeenAt: Date.now()
  });
  return { provider: "cloudflare-realtime", viewerId, liveId, offer: subscribed.offer, mids: subscribed.mids };
}

export async function answerRealtimeViewer({ viewerId, answer }) {
  const viewer = viewerSessions.get(viewerId);
  if (!viewer) {
    const error = new Error("Session spectateur expirée.");
    error.status = 404;
    error.code = "LIVE_VIEWER_SESSION_NOT_FOUND";
    throw error;
  }
  viewer.lastSeenAt = Date.now();
  await renegotiateCloudflareSession({ cloudflareSessionId: viewer.cloudflareSessionId, answer });
  return { ok: true, liveId: viewer.liveId };
}

export function heartbeatRealtimeViewer(viewerId) {
  const viewer = viewerSessions.get(viewerId);
  if (!viewer) return { active: false };
  viewer.lastSeenAt = Date.now();
  const live = getLiveSession(viewer.liveId);
  return { active: Boolean(live && live.status === "live" && publishedLives.has(viewer.liveId)) };
}

export function stopRealtimeViewer(viewerId) {
  viewerSessions.delete(viewerId);
  return { ok: true };
}

export function isRealtimePublished(liveId) {
  return publishedLives.has(String(liveId || ""));
}

export function isLivePublisher(live, actor) {
  try {
    assertPublisher(live, actor);
    return true;
  } catch {
    return false;
  }
}

export function realtimeStatus() {
  cleanupRealtimeViewers();
  return { published: publishedLives.size, viewers: viewerSessions.size };
}
