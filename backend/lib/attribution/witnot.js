/**
 * Suivi attribution partenaire Witnot — admin uniquement.
 */
import { readJson, writeJson } from "../storage.js";

const STORE_KEY = "witnot-attribution";

const DEFAULT_DATA = {
  events: [],
  registeredEmails: []
};

function loadData() {
  return readJson(STORE_KEY, DEFAULT_DATA);
}

function saveData(data) {
  data.events = (data.events || []).slice(0, 50000);
  data.registeredEmails = (data.registeredEmails || []).slice(0, 10000);
  writeJson(STORE_KEY, data);
}

export function isWitnotSource({ referrer = "", page = "", trafficSource = "", querySource = "" } = {}) {
  if (String(trafficSource).toLowerCase() === "witnot") return true;
  if (String(querySource).toLowerCase() === "witnot") return true;

  const ref = String(referrer).toLowerCase();
  if (ref.includes("witnot.com")) return true;

  try {
    const url = new URL(page, "https://cardoria.fr");
    const src = url.searchParams.get("source") || url.searchParams.get("utm_source") || "";
    if (String(src).toLowerCase() === "witnot") return true;
  } catch { /* ignore */ }

  return false;
}

function makeEventId() {
  return "wn_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function recordWitnotEvent({ type, visitorId = "", meta = {}, trafficSource = "witnot" }) {
  if (String(trafficSource).toLowerCase() !== "witnot") {
    return { ok: false, skipped: true };
  }

  const data = loadData();
  const event = {
    id: makeEventId(),
    type,
    source: "witnot",
    visitorId: visitorId || "",
    at: new Date().toISOString(),
    meta: meta || {}
  };

  data.events.unshift(event);
  saveData(data);
  return { ok: true, event };
}

export function recordWitnotVisit(payload = {}) {
  if (!isWitnotSource(payload)) return { ok: false, skipped: true };

  const data = loadData();
  const visitorId = payload.visitorId || "";
  const today = new Date().toISOString().slice(0, 10);

  const alreadyToday = data.events.some((e) =>
    e.type === "visit" &&
    e.visitorId === visitorId &&
    e.at?.slice(0, 10) === today
  );

  if (alreadyToday && visitorId) {
    return { ok: true, duplicate: true };
  }

  return recordWitnotEvent({
    type: "visit",
    visitorId,
    trafficSource: "witnot",
    meta: {
      page: payload.page || "",
      device: payload.device || "",
      referrer: payload.referrer || ""
    }
  });
}

export function recordWitnotRegistration({ email, visitorId, trafficSource = "witnot", meta = {} }) {
  if (String(trafficSource).toLowerCase() !== "witnot" || !email) {
    return { ok: false, skipped: true };
  }

  const data = loadData();
  const key = String(email).toLowerCase().trim();
  if (data.registeredEmails.includes(key)) {
    return { ok: true, duplicate: true };
  }

  data.registeredEmails.push(key);
  saveData(data);

  return recordWitnotEvent({
    type: "registration",
    visitorId,
    trafficSource: "witnot",
    meta: { email: key, ...meta }
  });
}

export function recordWitnotEstimation({ visitorId, trafficSource = "witnot", email, estimationId, meta = {} }) {
  if (String(trafficSource).toLowerCase() !== "witnot") {
    return { ok: false, skipped: true };
  }

  if (email) {
    recordWitnotRegistration({ email, visitorId, trafficSource, meta: { via: "estimation" } });
  }

  return recordWitnotEvent({
    type: "estimation",
    visitorId,
    trafficSource: "witnot",
    meta: { email: email || "", estimationId: estimationId || "", ...meta }
  });
}

export function recordWitnotPurchase({ visitorId, trafficSource = "witnot", orderId, amount, email, meta = {} }) {
  if (String(trafficSource).toLowerCase() !== "witnot") {
    return { ok: false, skipped: true };
  }

  return recordWitnotEvent({
    type: "purchase",
    visitorId,
    trafficSource: "witnot",
    meta: { orderId: orderId || "", amount: amount ?? null, email: email || "", ...meta }
  });
}

function periodFilter(isoDate, period) {
  const d = new Date(isoDate);
  const now = new Date();
  if (period === "day") return d.toDateString() === now.toDateString();
  if (period === "week") return now - d <= 7 * 86400000;
  if (period === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (period === "year") return d.getFullYear() === now.getFullYear();
  return true;
}

export function getWitnotStats(period = "month") {
  const data = loadData();
  const events = (data.events || []).filter((e) => e.source === "witnot" && periodFilter(e.at, period));

  const visitEvents = events.filter((e) => e.type === "visit");
  const uniqueVisitors = new Set(visitEvents.map((e) => e.visitorId).filter(Boolean)).size;
  const visitors = uniqueVisitors || visitEvents.length;

  const registrations = events.filter((e) => e.type === "registration").length;
  const estimations = events.filter((e) => e.type === "estimation").length;
  const purchases = events.filter((e) => e.type === "purchase").length;

  const conversionRate = visitors > 0 ? Math.round((purchases / visitors) * 1000) / 10 : 0;
  const engagementRate = visitors > 0 ? Math.round(((estimations + purchases) / visitors) * 1000) / 10 : 0;

  return {
    source: "witnot",
    period,
    visitors,
    registrations,
    estimations,
    purchases,
    conversionRate,
    engagementRate,
    totalEvents: events.length
  };
}

export function resolveTrafficSource(req, body = {}) {
  const referer = req.headers?.referer || req.headers?.referrer || body.referrer || "";
  const page = body.page || "";
  const trafficSource = body.trafficSource || "";
  let querySource = body.querySource || "";

  if (!querySource && page) {
    try {
      const url = new URL(page, "https://cardoria.fr");
      querySource = url.searchParams.get("source") || url.searchParams.get("utm_source") || "";
    } catch { /* ignore */ }
  }

  if (isWitnotSource({ referrer: referer, page, trafficSource, querySource })) {
    return "witnot";
  }
  return trafficSource || null;
}
