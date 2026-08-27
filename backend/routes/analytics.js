import { Router } from "express";
import { readJson, writeJson } from "../lib/storage.js";
import {
  isWitnotSource,
  recordWitnotVisit,
  recordWitnotEstimation,
  recordWitnotRegistration,
  recordWitnotPurchase,
  resolveTrafficSource,
  getWitnotStats
} from "../lib/attribution/witnot.js";

const router = Router();

const DEFAULT_ANALYTICS = {
  days: [],
  sources: { google: 42, facebook: 18, instagram: 12, direct: 28, witnot: 0 },
  devices: { mobile: 55, desktop: 38, tablet: 7 },
  avgSessionSeconds: 184,
  topPages: [],
  topSearches: [],
  topCards: [],
  sales: []
};

function normalizeAnalytics(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    ...DEFAULT_ANALYTICS,
    ...raw,
    days: Array.isArray(raw.days) ? raw.days : [],
    sources: { ...DEFAULT_ANALYTICS.sources, ...(raw.sources && typeof raw.sources === "object" ? raw.sources : {}) },
    devices: { ...DEFAULT_ANALYTICS.devices, ...(raw.devices && typeof raw.devices === "object" ? raw.devices : {}) },
    topPages: Array.isArray(raw.topPages) ? raw.topPages : [],
    topSearches: Array.isArray(raw.topSearches) ? raw.topSearches : [],
    topCards: Array.isArray(raw.topCards) ? raw.topCards : [],
    sales: Array.isArray(raw.sales) ? raw.sales : []
  };
}

router.post("/track", (req, res) => {
  const body = req.body || {};
  const { page, referrer, search, card, visitorId } = body;
  const resolvedSource = resolveTrafficSource(req, body);

  const analytics = normalizeAnalytics(readJson("analytics", DEFAULT_ANALYTICS));
  const today = new Date().toISOString().slice(0, 10);
  let day = analytics.days.find((d) => d && d.date === today);
  if (!day) {
    day = { date: today, visitors: 0, views: 0, revenue: 0, sales: 0 };
    analytics.days.unshift(day);
  }
  day.views = Number(day.views || 0) + 1;
  day.visitors = Number(day.visitors || 0) + 1;

  const ref = String(referrer || "direct").toLowerCase();
  if (resolvedSource === "witnot" || ref.includes("witnot.com")) {
    analytics.sources.witnot = Number(analytics.sources.witnot || 0) + 1;
  } else if (ref.includes("google")) analytics.sources.google = Number(analytics.sources.google || 0) + 1;
  else if (ref.includes("facebook")) analytics.sources.facebook = Number(analytics.sources.facebook || 0) + 1;
  else if (ref.includes("instagram")) analytics.sources.instagram = Number(analytics.sources.instagram || 0) + 1;
  else analytics.sources.direct = Number(analytics.sources.direct || 0) + 1;

  const requestedDevice = String(body.device || "desktop").toLowerCase();
  const dev = ["mobile", "desktop", "tablet"].includes(requestedDevice) ? requestedDevice : "desktop";
  analytics.devices[dev] = Number(analytics.devices[dev] || 0) + 1;

  if (page) {
    const p = analytics.topPages.find((x) => x && x.path === page);
    if (p) p.views = Number(p.views || 0) + 1;
    else analytics.topPages.push({ path: page, views: 1 });
    analytics.topPages.sort((a, b) => Number(b?.views || 0) - Number(a?.views || 0));
    analytics.topPages = analytics.topPages.slice(0, 20);
  }

  if (search) {
    const s = analytics.topSearches.find((x) => x && x.q === search);
    if (s) s.count = Number(s.count || 0) + 1;
    else analytics.topSearches.push({ q: search, count: 1 });
    analytics.topSearches.sort((a, b) => Number(b?.count || 0) - Number(a?.count || 0));
  }

  if (card) {
    const c = analytics.topCards.find((x) => x && x.name === card);
    if (c) c.views = Number(c.views || 0) + 1;
    else analytics.topCards.push({ name: card, views: 1 });
    analytics.topCards.sort((a, b) => Number(b?.views || 0) - Number(a?.views || 0));
  }

  analytics.days = analytics.days.slice(0, 365);
  writeJson("analytics", analytics);

  if (resolvedSource === "witnot") {
    recordWitnotVisit({
      visitorId,
      page,
      device: dev,
      referrer,
      trafficSource: "witnot"
    });
  }

  res.json({ ok: true });
});

router.post("/conversion", (req, res) => {
  const body = req.body || {};
  const source = resolveTrafficSource(req, body) || body.trafficSource;
  if (source !== "witnot") {
    return res.json({ ok: true, skipped: true });
  }

  const { type, visitorId, meta = {} } = body;
  let result = { ok: true, skipped: true };

  if (type === "registration") {
    result = recordWitnotRegistration({ email: meta.email, visitorId, trafficSource: "witnot", meta });
  } else if (type === "estimation") {
    result = recordWitnotEstimation({
      visitorId,
      trafficSource: "witnot",
      email: meta.email,
      estimationId: meta.estimationId,
      meta
    });
  } else if (type === "purchase") {
    result = recordWitnotPurchase({
      visitorId,
      trafficSource: "witnot",
      orderId: meta.orderId,
      amount: meta.amount,
      email: meta.email,
      meta
    });
  }

  res.json(result);
});

export { getWitnotStats, isWitnotSource, resolveTrafficSource };
export default router;
