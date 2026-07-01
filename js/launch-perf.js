/**
 * Performance lancement V1 — lazy loading, prefetch, cache hints.
 * Charger en fin de body : <script src="js/launch-perf.js" defer></script>
 */
(function () {
  "use strict";

  if ("loading" in HTMLImageElement.prototype) {
    document.querySelectorAll("img:not([loading])").forEach(function (img) {
      if (!img.closest(".hero-logo, .brand")) img.loading = "lazy";
      if (!img.decoding) img.decoding = "async";
    });
  }

  document.querySelectorAll('link[rel="stylesheet"]').forEach(function (link) {
    if (!link.media) link.media = "all";
  });

  var preconnect = document.createElement("link");
  preconnect.rel = "preconnect";
  preconnect.href = (window.CARDORIA_SEO && CARDORIA_SEO.backendUrl) || "https://cardoria-backend.onrender.com";
  preconnect.crossOrigin = "anonymous";
  if (!document.querySelector('link[rel="preconnect"][href="' + preconnect.href + '"]')) {
    document.head.appendChild(preconnect);
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.documentElement.classList.add("reduce-motion");
  }
})();
