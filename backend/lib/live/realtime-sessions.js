import { randomUUID, randomBytes, createHash } from "node:crypto";
import { getLiveSession } from "./sessions.js";
import { readJson, writeJson } from "../storage.js";
import { createCloudflareSession, publishCloudflareTracks, subscribeCloudflareTracks, renegotiateCloudflareSession, isCloudflareRealtimeConfigured } from "./cloudflare-realtime.js";

const publishedLives = new Map();
const viewerSessions = new Map();
const publisherPairs = new Map();
const PUBLISHER_STORE_KEY = "live-realtime-publishers.json";
const VIEWER_TTL_MS = 90_000;
const PAIR_TTL_MS = 10 * 60_000;
const PUBLISHER_TTL_MS = 30_000;
const MAX_PUBLISHERS_PER_LIVE = 2;
const LIVE_PUBLISHER_ADMIN_ROLES = ["super_admin", "admin", "employee"];

function cleanSourceId(value) {
  const raw = String(value || "primary").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
  return raw || "primary";
}

function sourceIsReady(source) {
  return Boolean(source && (source.mode === "p2p" || source.ready === true));
}

function readySources(entry) {
  return entry ? [...entry.sources.values()].filter(sourceIsReady) : [];
}

function persistPublishedLives() {
  const lives = [];
  for (const [liveId, entry] of publishedLives) {
    lives.push({
      liveId,
      startedAt: entry.startedAt || "",
      sources: [...entry.sources.values()]
        .filter((source) => source.mode === "p2p")
        .map((source) => ({
          mode: "p2p",
          ready: true,
          sourceId: source.sourceId,
          publisherId: source.publisherId,
          publisherKey: source.publisherKey,
          tracks: source.tracks || [],
          startedAt: source.startedAt || ""
        }))
    });
  }
  try { writeJson(PUBLISHER_STORE_KEY, { lives }); } catch {}
}

function hydratePublishedLives() {
  try {
    const data = readJson(PUBLISHER_STORE_KEY, { lives: [] });
    for (const live of data.lives || []) {
      const session = getLiveSession(live.liveId);
      if (!session || session.status !== "live") continue;
      const entry = { sources: new Map(), startedAt: live.startedAt || new Date().toISOString() };
      for (const source of live.sources || []) {
        if (source.mode !== "p2p" || !source.sourceId || !source.publisherKey) continue;
        entry.sources.set(source.sourceId, { ...source, ready: true, offers: new Map(), lastSeenAt: Date.now() });
      }
      if (entry.sources.size) publishedLives.set(live.liveId, entry);
    }
  } catch {}
}
hydratePublishedLives();

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
  return readySources(entry).flatMap((source) =>
    (source.tracks || []).map((track) => ({ ...track, sourceId: source.sourceId }))
  );
}

function pairHash(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function cleanupPairs() {
  const now = Date.now();
  for (const [hash, pair] of publisherPairs) {
    if (pair.expiresAt <= now || pair.used) publisherPairs.delete(hash);
  }
}

function cleanupPublisherSources() {
  const cutoff = Date.now() - PUBLISHER_TTL_MS;
  let changed = false;
  for (const [liveId, entry] of publishedLives) {
    for (const [sourceId, source] of entry.sources) {
      if (Number(source.lastSeenAt || 0) < cutoff) {
        entry.sources.delete(sourceId);
        changed = true;
      }
    }
    if (!entry.sources.size) {
      publishedLives.delete(liveId);
      changed = true;
    }
  }
  if (changed) persistPublishedLives();
}

export function cleanupRealtimeViewers() {
  const cutoff = Date.now() - VIEWER_TTL_MS;
  for (const [id, viewer] of viewerSessions) {
    if (viewer.lastSeenAt < cutoff) viewerSessions.delete(id);
  }
  cleanupPairs();
  cleanupPublisherSources();
}

const cleanupTimer = setInterval(cleanupRealtimeViewers, 10_000);
cleanupTimer.unref?.();

export function realtimeProvider() {
  return isCloudflareRealtimeConfigured() ? "cloudflare-realtime" : "cardoria-p2p";
}

export function viewerCountForLive(liveId) {
  cleanupRealtimeViewers();
  let count = 0;
  for (const viewer of viewerSessions.values()) {
    if (String(viewer.liveId) === String(liveId)) count += 1;
  }
  return count;
}

export function realtimeStatusForLive(liveId) {
  cleanupRealtimeViewers();
  const entry = livePublishers(String(liveId || ""));
  const ready = readySources(entry);
  return {
    liveId: String(liveId || ""),
    published: ready.length > 0,
    publishers: ready.length,
    connectingPublishers: Math.max(0, (entry?.sources.size || 0) - ready.length),
    viewers: viewerCountForLive(liveId),
    maxPublishersPerLive: MAX_PUBLISHERS_PER_LIVE,
    sources: ready.map((source) => source.sourceId),
    provider: realtimeProvider()
  };
}

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

  const publisherKey = randomBytes(32).toString("base64url");
  const publisherId = String(actor.id || actor.sellerId || "admin");
  const startedAt = new Date().toISOString();

  if (isCloudflareRealtimeConfigured()) {
    const cloudflareSessionId = await createCloudflareSession();
    const namedTracks = tracks.map((track) => ({
      ...track,
      trackName: `${normalizedSource}-${track.kind === "video" ? "camera" : "microphone"}`
    }));
    const published = await publishCloudflareTracks({ cloudflareSessionId, offer, tracks: namedTracks });
    entry.sources.set(normalizedSource, {
      mode: "cloudflare",
      ready: false,
      sourceId: normalizedSource,
      publisherId,
      publisherKey,
      cloudflareSessionId,
      tracks: published.tracks,
      startedAt,
      lastSeenAt: Date.now()
    });
    return {
      provider: "cloudflare-realtime",
      mode: "cloudflare",
      liveId,
      sourceId: normalizedSource,
      sourceCount: readySources(entry).length,
      connecting: true,
      publisherKey,
      answer: published.answer
    };
  }

  entry.sources.set(normalizedSource, {
    mode: "p2p",
    ready: true,
    sourceId: normalizedSource,
    publisherId,
    publisherKey,
    tracks: (tracks || []).map((track) => ({
      kind: track.kind,
      trackName: track.trackName || `${normalizedSource}-${track.kind}`
    })),
    offers: new Map(),
    startedAt,
    lastSeenAt: Date.now()
  });
  persistPublishedLives();
  return {
    provider: "cardoria-p2p",
    mode: "p2p",
    liveId,
    sourceId: normalizedSource,
    sourceCount: readySources(entry).length,
    publisherKey
  };
}

function requirePublisherSource({ liveId, sourceId, publisherKey, mode = "" }) {
  const entry = livePublishers(String(liveId || ""));
  const source = entry?.sources.get(cleanSourceId(sourceId));
  if (!source) {
    const error = new Error("Source caméra introuvable.");
    error.status = 404;
    error.code = "LIVE_PUBLISHER_SOURCE_NOT_FOUND";
    throw error;
  }
  if (mode && source.mode !== mode) {
    const error = new Error("Mode de diffusion incompatible.");
    error.status = 409;
    error.code = "LIVE_PUBLISHER_MODE_MISMATCH";
    throw error;
  }
  if (!publisherKey || String(source.publisherKey) !== String(publisherKey)) {
    const error = new Error("Clé diffuseur invalide.");
    error.status = 401;
    error.code = "LIVE_PUBLISHER_KEY_INVALID";
    throw error;
  }
  source.lastSeenAt = Date.now();
  return { entry, source };
}

export function markRealtimePublisherReady({ liveId, sourceId, publisherKey }) {
  const { entry, source } = requirePublisherSource({ liveId, sourceId, publisherKey });
  source.ready = true;
  source.readyAt = source.readyAt || new Date().toISOString();
  source.lastSeenAt = Date.now();
  if (source.mode === "p2p") persistPublishedLives();
  return {
    ok: true,
    liveId,
    sourceId: cleanSourceId(sourceId),
    provider: source.mode === "cloudflare" ? "cloudflare-realtime" : "cardoria-p2p",
    ready: true,
    sourceCount: readySources(entry).length
  };
}

export function heartbeatRealtimePublisher({ liveId, sourceId, publisherKey }) {
  const { entry, source } = requirePublisherSource({ liveId, sourceId, publisherKey });
  return {
    ok: true,
    liveId,
    sourceId: cleanSourceId(sourceId),
    ready: sourceIsReady(source),
    sourceCount: readySources(entry).length
  };
}

function requireP2PSource(args) {
  return requirePublisherSource({ ...args, mode: "p2p" }).source;
}

export function pollRealtimePublisherOffers({ liveId, sourceId, publisherKey }) {
  const source = requireP2PSource({ liveId, sourceId, publisherKey });
  const offers = [];
  for (const [viewerId, item] of source.offers) {
    if (!item.answer) offers.push({ viewerId, offer: item.offer });
  }
  return { ok: true, liveId, sourceId: cleanSourceId(sourceId), offers };
}

export function submitRealtimePublisherAnswer({ liveId, sourceId, publisherKey, viewerId, answer }) {
  const source = requireP2PSource({ liveId, sourceId, publisherKey });
  const item = source.offers.get(String(viewerId || ""));
  const viewer = viewerSessions.get(String(viewerId || ""));
  if (!item || !viewer || viewer.liveId !== liveId) {
    const error = new Error("Spectateur P2P introuvable.");
    error.status = 404;
    error.code = "LIVE_P2P_VIEWER_NOT_FOUND";
    throw error;
  }
  item.answer = answer;
  item.answeredAt = Date.now();
  viewer.answers.set(cleanSourceId(sourceId), answer);
  viewer.lastSeenAt = Date.now();
  return { ok: true, viewerId, sourceId: cleanSourceId(sourceId) };
}

export function submitRealtimeViewerOffer({ viewerId, sourceId, offer }) {
  const viewer = viewerSessions.get(String(viewerId || ""));
  if (!viewer || viewer.mode !== "p2p") {
    const error = new Error("Session spectateur P2P introuvable.");
    error.status = 404;
    error.code = "LIVE_P2P_VIEWER_NOT_FOUND";
    throw error;
  }
  const entry = livePublishers(viewer.liveId);
  const normalizedSource = cleanSourceId(sourceId);
  const source = entry?.sources.get(normalizedSource);
  if (!source || source.mode !== "p2p" || !sourceIsReady(source)) {
    const error = new Error("Caméra P2P indisponible.");
    error.status = 404;
    error.code = "LIVE_P2P_SOURCE_NOT_FOUND";
    throw error;
  }
  source.offers.set(String(viewerId), { offer, createdAt: Date.now(), answer: null });
  viewer.lastSeenAt = Date.now();
  return { ok: true, viewerId, sourceId: normalizedSource };
}

export function pollRealtimeViewerAnswers(viewerId) {
  const viewer = viewerSessions.get(String(viewerId || ""));
  if (!viewer || viewer.mode !== "p2p") {
    const error = new Error("Session spectateur P2P introuvable.");
    error.status = 404;
    error.code = "LIVE_P2P_VIEWER_NOT_FOUND";
    throw error;
  }
  viewer.lastSeenAt = Date.now();
  return {
    ok: true,
    viewerId: String(viewerId),
    liveId: viewer.liveId,
    answers: Object.fromEntries(viewer.answers)
  };
}

export function stopRealtimePublisher({ liveId, actor = null, sourceId, publisherKey = "" }) {
  const normalizedSource = cleanSourceId(sourceId);
  const entry = livePublishers(liveId);
  if (!entry) return { ok: true, liveId, sourceId: normalizedSource, sourceCount: 0 };

  if (publisherKey) {
    requirePublisherSource({ liveId, sourceId: normalizedSource, publisherKey });
  } else {
    const live = getLiveSession(liveId);
    if (live) assertPublisher(live, actor);
  }

  if (sourceId) entry.sources.delete(normalizedSource);
  else entry.sources.clear();
  if (!entry.sources.size) publishedLives.delete(liveId);
  persistPublishedLives();
  return { ok: true, liveId, sourceId: sourceId ? normalizedSource : null, sourceCount: readySources(entry).length };
}

export async function startRealtimeViewer(liveId) {
  cleanupRealtimeViewers();
  requireLive(liveId);
  const entry = livePublishers(liveId);
  const ready = readySources(entry);
  const p2pSources = ready.filter((source) => source.mode === "p2p");
  const cloudflareSources = ready.filter((source) => source.mode === "cloudflare");

  if (cloudflareSources.length && !p2pSources.length) {
    const tracks = allPublishedTracks(liveId);
    const subscribed = await subscribeCloudflareTracks({ tracks });
    const viewerId = randomUUID();
    viewerSessions.set(viewerId, {
      mode: "cloudflare",
      liveId,
      cloudflareSessionId: subscribed.cloudflareSessionId,
      lastSeenAt: Date.now()
    });
    return {
      provider: "cloudflare-realtime",
      mode: "cloudflare",
      waiting: false,
      viewerId,
      liveId,
      offer: subscribed.offer,
      mids: subscribed.mids,
      subscriptions: subscribed.subscriptions,
      sourceCount: cloudflareSources.length,
      viewerCount: viewerCountForLive(liveId)
    };
  }

  if (!p2pSources.length && isCloudflareRealtimeConfigured()) {
    const viewerId = randomUUID();
    viewerSessions.set(viewerId, { mode: "cloudflare-waiting", liveId, lastSeenAt: Date.now() });
    return {
      provider: "cloudflare-realtime",
      mode: "cloudflare-waiting",
      waiting: true,
      viewerId,
      liveId,
      sources: [],
      sourceCount: 0,
      viewerCount: viewerCountForLive(liveId)
    };
  }

  const viewerId = randomUUID();
  const sources = p2pSources.map((source) => ({ sourceId: source.sourceId, tracks: source.tracks || [] }));
  viewerSessions.set(viewerId, { mode: "p2p", liveId, lastSeenAt: Date.now(), answers: new Map() });
  return {
    provider: "cardoria-p2p",
    mode: "p2p",
    waiting: !sources.length,
    viewerId,
    liveId,
    sources,
    sourceCount: sources.length,
    viewerCount: viewerCountForLive(liveId)
  };
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
  if (viewer.mode !== "cloudflare") {
    const error = new Error("Réponse spectateur non utilisée pour cette session.");
    error.status = 409;
    error.code = "LIVE_VIEWER_ANSWER_NOT_EXPECTED";
    throw error;
  }
  await renegotiateCloudflareSession({ cloudflareSessionId: viewer.cloudflareSessionId, answer });
  return { ok: true, liveId: viewer.liveId, viewerCount: viewerCountForLive(viewer.liveId) };
}

export function heartbeatRealtimeViewer(viewerId) {
  const viewer = viewerSessions.get(viewerId);
  if (!viewer) {
    return { active: false, waiting: false, published: false, viewerCount: 0, sources: [], sourceCount: 0 };
  }
  viewer.lastSeenAt = Date.now();
  const live = getLiveSession(viewer.liveId);
  const status = realtimeStatusForLive(viewer.liveId);
  const liveOpen = Boolean(live && live.status === "live");
  const provider = viewer.mode.startsWith("cloudflare") ? "cloudflare-realtime" : "cardoria-p2p";
  return {
    active: liveOpen,
    waiting: liveOpen && !(status.sources || []).length,
    published: Boolean(status.published),
    liveId: viewer.liveId,
    viewerCount: viewerCountForLive(viewer.liveId),
    provider,
    sources: status.sources || [],
    sourceCount: status.publishers || 0
  };
}

export function stopRealtimeViewer(viewerId) {
  const id = String(viewerId || "");
  const liveId = viewerSessions.get(id)?.liveId;
  viewerSessions.delete(id);
  if (liveId) {
    const entry = livePublishers(liveId);
    for (const source of entry?.sources.values() || []) source.offers?.delete(id);
  }
  return { ok: true, liveId: liveId || "", viewerCount: liveId ? viewerCountForLive(liveId) : 0 };
}

export function isRealtimePublished(liveId) {
  return readySources(livePublishers(String(liveId || ""))).length > 0;
}

export function isLivePublisher(live, actor) {
  try { assertPublisher(live, actor); return true; } catch { return false; }
}

export function realtimeStatus() {
  cleanupRealtimeViewers();
  let publishers = 0;
  let connectingPublishers = 0;
  for (const entry of publishedLives.values()) {
    const ready = readySources(entry).length;
    publishers += ready;
    connectingPublishers += Math.max(0, entry.sources.size - ready);
  }
  return {
    published: [...publishedLives.values()].filter((entry) => readySources(entry).length > 0).length,
    publishers,
    connectingPublishers,
    viewers: viewerSessions.size,
    maxPublishersPerLive: MAX_PUBLISHERS_PER_LIVE,
    provider: realtimeProvider()
  };
}

export function __resetRealtimeStoreForTests() {
  publishedLives.clear();
  viewerSessions.clear();
  publisherPairs.clear();
}
