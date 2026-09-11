import { randomUUID, randomBytes, createHash } from "node:crypto";
import { getLiveSession } from "./sessions.js";
import {
  createCloudflareSession,
  publishCloudflareTracks,
  subscribeCloudflareTracks,
  renegotiateCloudflareSession
} from "./cloudflare-realtime.js";

const publishedLives = new Map();
const viewerSessions = new Map();
const publisherPairs = new Map();
const VIEWER_TTL_MS = 90_000;
const PAIR_TTL_MS = 10 * 60_000;
const MAX_PUBLISHERS_PER_LIVE = 2;
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

function cleanSourceId(value) {
  const raw = String(value || "primary").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
  return raw || "primary";
}

function livePublishers(liveId, create = false) {
  let entry = publishedLives.get(liveId);
  if (!entry && create) {
    entry = { sources: new Map(), startedAt: new Date().toISOString() };
    publishedLives.set(liveId, entry);
  }
  return entry;
}

function allPublishedTracks(liveId) {
  const entry = livePublishers(liveId);
  if (!entry) return [];
  return [...entry.sources.values()].flatMap((source) => source.tracks || []);
}

function pairHash(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function cleanupPairs() {
  const now = Date.now();
  for (const [hash, pair] of publisherPairs) if (pair.expiresAt <= now || pair.used) publisherPairs.delete(hash);
}

export function cleanupRealtimeViewers() {
  const cutoff = Date.now() - VIEWER_TTL_MS;
  for (const [viewerId, viewer] of viewerSessions) {
    if (viewer.lastSeenAt >= cutoff) continue;
    viewerSessions.delete(viewerId);
  }
  cleanupPairs();
}

const cleanupTimer = setInterval(cleanupRealtimeViewers, 30_000);
cleanupTimer.unref?.();

export function createPublisherPair({ liveId, actor, sourceId = "secondary" }) {
  const live = requireLive(liveId);
  assertPublisher(live, actor);
  cleanupPairs();
  const normalizedSource = cleanSourceId(sourceId);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + PAIR_TTL_MS;
  publisherPairs.set(pairHash(token), {
    liveId,
    sourceId: normalizedSource,
    actor: {
      role: actor.role,
      id: actor.id || actor.sellerId || "admin",
      sellerId: actor.sellerId || "",
      email: actor.email || ""
    },
    expiresAt,
    used: false
  });
  return { token, liveId, sourceId: normalizedSource, expiresAt: new Date(expiresAt).toISOString() };
}

export function claimPublisherPair(token) {
  cleanupPairs();
  const hash = pairHash(token);
  const pair = publisherPairs.get(hash);
  if (!pair || pair.used || pair.expiresAt <= Date.now()) {
    const error = new Error("Lien caméra expiré ou invalide.");
    error.status = 401;
    error.code = "LIVE_CAMERA_PAIR_INVALID";
    throw error;
  }
  pair.used = true;
  publisherPairs.delete(hash);
  return pair;
}

export async function startRealtimePublisher({ liveId, actor, offer, tracks, sourceId = "primary" }) {
  const live = requireLive(liveId);
  assertPublisher(live, actor);
  const normalizedSource = cleanSourceId(sourceId);
  const entry = livePublishers(liveId, true);
  if (!entry.sources.has(normalizedSource) && entry.sources.size >= MAX_PUBLISHERS_PER_LIVE) {
    const error = new Error("Deux caméras maximum sont autorisées sur ce Live.");
    error.status = 409;
    error.code = "LIVE_CAMERA_LIMIT";
    throw error;
  }
  const cloudflareSessionId = await createCloudflareSession();
  const namedTracks = tracks.map((track) => ({ ...track, trackName: `${normalizedSource}-${track.kind === "video" ? "camera" : "microphone"}` }));
  const published = await publishCloudflareTracks({ cloudflareSessionId, offer, tracks: namedTracks });
  entry.sources.set(normalizedSource, {
    sourceId: normalizedSource,
    publisherId: String(actor.id || actor.sellerId || "admin"),
    cloudflareSessionId,
    tracks: published.tracks,
    startedAt: new Date().toISOString()
  });
  return { provider: "cloudflare-realtime", liveId, sourceId: normalizedSource, sourceCount: entry.sources.size, answer: published.answer };
}

export function stopRealtimePublisher({ liveId, actor, sourceId }) {
  const live = getLiveSession(liveId);
  if (live) assertPublisher(live, actor);
  const entry = livePublishers(liveId);
  if (entry) {
    if (sourceId) entry.sources.delete(cleanSourceId(sourceId));
    else entry.sources.clear();
    if (!entry.sources.size) {
      publishedLives.delete(liveId);
      for (const [viewerId, viewer] of viewerSessions) if (viewer.liveId === liveId) viewerSessions.delete(viewerId);
    }
  }
  return { ok: true, liveId, sourceId: sourceId ? cleanSourceId(sourceId) : null, sourceCount: entry?.sources.size || 0 };
}

export async function startRealtimeViewer(liveId) {
  cleanupRealtimeViewers();
  requireLive(liveId);
  const tracks = allPublishedTracks(liveId);
  if (!tracks.length) {
    const error = new Error("La diffusion vidéo n'est pas encore disponible.");
    error.status = 404;
    error.code = "LIVE_STREAM_NOT_PUBLISHED";
    throw error;
  }
  const subscribed = await subscribeCloudflareTracks({ tracks });
  const viewerId = randomUUID();
  viewerSessions.set(viewerId, { liveId, cloudflareSessionId: subscribed.cloudflareSessionId, lastSeenAt: Date.now() });
  return { provider: "cloudflare-realtime", viewerId, liveId, offer: subscribed.offer, mids: subscribed.mids, sourceCount: livePublishers(liveId)?.sources.size || 0 };
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
  return (livePublishers(String(liveId || ""))?.sources.size || 0) > 0;
}

export function isLivePublisher(live, actor) {
  try { assertPublisher(live, actor); return true; } catch { return false; }
}

export function realtimeStatus() {
  cleanupRealtimeViewers();
  let publishers = 0;
  for (const entry of publishedLives.values()) publishers += entry.sources.size;
  return { published: publishedLives.size, publishers, viewers: viewerSessions.size, maxPublishersPerLive: MAX_PUBLISHERS_PER_LIVE };
}
