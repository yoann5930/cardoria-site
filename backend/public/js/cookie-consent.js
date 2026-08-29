(function () {
  "use strict";

  var KEY = "cardoria_cookie_consent";
  var PREFS_KEY = "cardoria_cookie_prefs";
  var BACKEND = (window.CARDORIA_SEO && CARDORIA_SEO.backendUrl) || "https://cardoria-site-2.onrender.com";

  function hasConsent() {
    try { return localStorage.getItem(KEY) === "accepted"; } catch (e) { return false; }
  }

  function savePrefs(prefs) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
    fetch(BACKEND + "/api/gdpr/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitorId: window.CardoriaAttribution ? CardoriaAttribution.getVisitorId() : "",
        analytics: !!prefs.analytics,
        marketing: !!prefs.marketing,
        preferences: prefs
      })
    }).catch(function () {});
  }

  function renderBanner() {
    if (document.getElementById("cookieConsent") || localStorage.getItem(KEY)) return;

    var box = document.createElement("div");
    box.id = "cookieConsent";
    box.className = "cookie-consent";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Consentement cookies");
    box.innerHTML =
      '<div class="cookie-consent-inner">' +
      "<p><strong>Cookies & confidentialité</strong> — Cardoria utilise des cookies analytics (Google Analytics 4, Microsoft Clarity) pour améliorer le site, conformément au RGPD. " +
      '<a href="' + rootPath() + 'pages/confidentialite/">En savoir plus</a></p>' +
      '<div class="cookie-consent-actions">' +
      '<button type="button" class="btn btn-secondary" id="cookiePrefs">Préférences</button>' +
      '<button type="button" class="btn btn-secondary" id="cookieReject">Refuser</button>' +
      '<button type="button" class="btn btn-primary" id="cookieAccept">Accepter</button>' +
      "</div></div>";
    document.body.appendChild(box);

    document.getElementById("cookieAccept").onclick = function () {
      try { localStorage.setItem(KEY, "accepted"); } catch (e) { /* ignore */ }
      savePrefs({ analytics: true, marketing: false });
      box.remove();
      if (window.CardoriaAnalytics) CardoriaAnalytics.onConsent();
    };
    document.getElementById("cookieReject").onclick = function () {
      try { localStorage.setItem(KEY, "rejected"); } catch (e) { /* ignore */ }
      savePrefs({ analytics: false, marketing: false });
      box.remove();
    };
    document.getElementById("cookiePrefs").onclick = function () {
      var analytics = confirm("Autoriser les cookies analytics (GA4, Clarity) ?");
      var marketing = confirm("Autoriser les cookies marketing ?");
      try { localStorage.setItem(KEY, analytics ? "accepted" : "rejected"); } catch (e) { /* ignore */ }
      savePrefs({ analytics: analytics, marketing: marketing });
      box.remove();
      if (analytics && window.CardoriaAnalytics) CardoriaAnalytics.onConsent();
    };
  }

  function rootPath() {
    return location.pathname.indexOf("/pages/") !== -1 ? "../../" : "";
  }

  document.addEventListener("DOMContentLoaded", renderBanner);
})();
