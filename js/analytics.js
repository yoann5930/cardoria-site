(function () {
  "use strict";

  var BACKEND = (window.CARDORIA_SEO && CARDORIA_SEO.backendUrl) || "https://cardoria-backend.onrender.com";
  var loaded = { ga4: false, clarity: false };

  function hasConsent() {
    try { return localStorage.getItem("cardoria_cookie_consent") === "accepted"; } catch (e) { return false; }
  }

  function loadGa4(id) {
    if (!id || loaded.ga4 || !hasConsent()) return;
    loaded.ga4 = true;
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("config", id, { anonymize_ip: true, send_page_view: true });
  }

  function loadClarity(id) {
    if (!id || loaded.clarity || !hasConsent()) return;
    loaded.clarity = true;
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, "clarity", "script", id);
  }

  function initFromConfig() {
    var cfg = window.CARDORIA_SEO || {};
    if (cfg.ga4Id) loadGa4(cfg.ga4Id);
    if (cfg.clarityId) loadClarity(cfg.clarityId);
  }

  function fetchTracking() {
    fetch(BACKEND + "/api/seo/tracking", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) return;
        if (d.ga4Id) { window.CARDORIA_SEO = window.CARDORIA_SEO || {}; CARDORIA_SEO.ga4Id = d.ga4Id; }
        if (d.clarityId) { window.CARDORIA_SEO = window.CARDORIA_SEO || {}; CARDORIA_SEO.clarityId = d.clarityId; }
        if (hasConsent()) initFromConfig();
      })
      .catch(function () { if (hasConsent()) initFromConfig(); });
  }

  window.CardoriaAnalytics = {
    init: function () { if (hasConsent()) { initFromConfig(); fetchTracking(); } },
    onConsent: function () { fetchTracking(); initFromConfig(); },
    trackEvent: function (name, params) {
      if (window.gtag) gtag("event", name, params || {});
    }
  };

  document.addEventListener("DOMContentLoaded", function () {
    if (hasConsent()) fetchTracking();
  });
})();
