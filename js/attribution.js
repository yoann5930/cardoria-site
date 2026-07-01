/**
 * Suivi visiteurs Witnot — invisible côté client public, stats admin uniquement.
 */
(function (global) {
  "use strict";

  var VISITOR_KEY = "cardoria_vid";
  var SOURCE_KEY = "cardoria_source";
  var SOURCE_TS = "cardoria_source_ts";
  var ATTRIBUTION_MS = 30 * 86400000;

  var BACKEND = global.CARDORIA_BACKEND ||
    (global.CARDORIA_SEO && global.CARDORIA_SEO.backendUrl) ||
    "https://cardoria-site-2.onrender.com";

  function detectWitnotFromUrl() {
    try {
      var params = new URLSearchParams(location.search);
      var src = params.get("source") || params.get("utm_source") || "";
      return String(src).toLowerCase() === "witnot";
    } catch (e) {
      return false;
    }
  }

  function detectWitnotFromReferrer() {
    var ref = String(document.referrer || "").toLowerCase();
    return ref.indexOf("witnot.com") !== -1;
  }

  function persistWitnotSource() {
    if (!detectWitnotFromUrl() && !detectWitnotFromReferrer()) return;
    try {
      localStorage.setItem(SOURCE_KEY, "witnot");
      localStorage.setItem(SOURCE_TS, String(Date.now()));
      sessionStorage.setItem(SOURCE_KEY, "witnot");
    } catch (e) { /* private mode */ }
  }

  function getSource() {
    try {
      if (sessionStorage.getItem(SOURCE_KEY) === "witnot") return "witnot";
      if (localStorage.getItem(SOURCE_KEY) === "witnot") {
        var ts = Number(localStorage.getItem(SOURCE_TS) || 0);
        if (Date.now() - ts <= ATTRIBUTION_MS) return "witnot";
        localStorage.removeItem(SOURCE_KEY);
        localStorage.removeItem(SOURCE_TS);
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function getVisitorId() {
    try {
      var id = localStorage.getItem(VISITOR_KEY);
      if (!id) {
        id = "v_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
        localStorage.setItem(VISITOR_KEY, id);
      }
      return id;
    } catch (e) {
      return "v_anon";
    }
  }

  function getPayload() {
    return {
      visitorId: getVisitorId(),
      trafficSource: getSource()
    };
  }

  persistWitnotSource();

  function trackPageView() {
    if (String(location.pathname).indexOf("admin") !== -1) return;
    var device = global.innerWidth < 768 ? "mobile" : global.innerWidth < 1024 ? "tablet" : "desktop";
    var payload = {
      page: location.pathname + location.search,
      referrer: document.referrer || "direct",
      device: device,
      visitorId: getVisitorId(),
      trafficSource: getSource()
    };
    fetch(BACKEND + "/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(function () {});
  }

  function trackConversion(type, meta) {
    if (!getSource()) return;
    fetch(BACKEND + "/api/analytics/conversion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: type,
        visitorId: getVisitorId(),
        trafficSource: getSource(),
        meta: meta || {}
      })
    }).catch(function () {});
  }

  global.CardoriaAttribution = {
    getSource: getSource,
    getVisitorId: getVisitorId,
    getPayload: getPayload,
    isWitnot: function () { return getSource() === "witnot"; },
    trackPageView: trackPageView,
    trackConversion: trackConversion
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", trackPageView);
  } else {
    trackPageView();
  }
})(window);
