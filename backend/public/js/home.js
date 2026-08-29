(function () {
  "use strict";

  function initLoader() {
    if (!document.body || document.getElementById("cardoriaLoader")) return;

    document.documentElement.classList.add("cardoria-loading");

    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/css/site-loader.css?v=2";
    document.head.appendChild(css);

    var loader = document.createElement("div");
    loader.id = "cardoriaLoader";
    loader.className = "cardoria-loader";
    loader.setAttribute("role", "status");
    loader.setAttribute("aria-live", "polite");
    loader.setAttribute("aria-label", "Chargement de Cardoria");
    loader.innerHTML =
      '<span class="cardoria-loader__corner cardoria-loader__corner--tl" aria-hidden="true"></span>' +
      '<span class="cardoria-loader__corner cardoria-loader__corner--br" aria-hidden="true"></span>' +
      '<div class="cardoria-loader__content">' +
        '<div class="cardoria-loader__emblem" aria-hidden="true">' +
          '<span class="cardoria-loader__orbit"></span>' +
          '<span class="cardoria-loader__logo-shell">' +
            '<img class="cardoria-loader__logo" src="/assets/logo/cardoria-premium.png" alt="">' +
          '</span>' +
        '</div>' +
        '<p class="cardoria-loader__eyebrow">Le Royaume des Collectionneurs</p>' +
        '<p class="cardoria-loader__tagline">L\'univers premium des cartes à collectionner.</p>' +
        '<div class="cardoria-loader__progress" aria-hidden="true">' +
          '<div class="cardoria-loader__track"><span class="cardoria-loader__bar" id="cardoriaLoaderBar"></span></div>' +
          '<div class="cardoria-loader__meta"><span>Initialisation</span><span class="cardoria-loader__percent" id="cardoriaLoaderPercent">0%</span></div>' +
        '</div>' +
      '</div>';

    document.body.prepend(loader);

    var bar = document.getElementById("cardoriaLoaderBar");
    var percent = document.getElementById("cardoriaLoaderPercent");
    var start = performance.now();
    var minimumDuration = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 350 : 1900;
    var completed = false;

    function setProgress(value) {
      var safe = Math.max(0, Math.min(100, Math.round(value)));
      if (bar) bar.style.transform = "scaleX(" + (safe / 100) + ")";
      if (percent) percent.textContent = safe + "%";
    }

    function finish() {
      if (completed) return;
      completed = true;
      setProgress(100);
      window.setTimeout(function () {
        loader.classList.add("is-leaving");
        document.documentElement.classList.remove("cardoria-loading");
        window.setTimeout(function () {
          if (loader.parentNode) loader.parentNode.removeChild(loader);
        }, 760);
      }, 160);
    }

    function tick(now) {
      if (completed) return;
      var elapsed = now - start;
      var ratio = Math.min(elapsed / minimumDuration, 0.94);
      var eased = 1 - Math.pow(1 - ratio, 2.4);
      setProgress(eased * 94);
      if (elapsed < minimumDuration) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);

    function waitUntilMinimum() {
      var elapsed = performance.now() - start;
      var remaining = minimumDuration - elapsed;
      if (remaining > 0) window.setTimeout(finish, remaining);
      else finish();
    }

    if (document.readyState === "complete") waitUntilMinimum();
    else window.addEventListener("load", waitUntilMinimum, { once: true });

    window.setTimeout(finish, 5000);
  }

  function initReveal() {
    var elements = document.querySelectorAll(".home-reveal");
    if (!elements.length) return;

    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      elements.forEach(function (element) { element.classList.add("is-visible"); });
      return;
    }

    if (!("IntersectionObserver" in window)) {
      elements.forEach(function (element) { element.classList.add("is-visible"); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -24px 0px" });

    elements.forEach(function (element) { observer.observe(element); });
  }

  function initMenu() {
    var button = document.getElementById("homeMenuBtn");
    var menu = document.getElementById("homeMenu");
    if (!button || !menu) return;

    button.addEventListener("click", function () {
      var open = menu.classList.toggle("is-open");
      button.setAttribute("aria-expanded", open ? "true" : "false");
    });

    menu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        menu.classList.remove("is-open");
        button.setAttribute("aria-expanded", "false");
      });
    });
  }

  function initSearch() {
    var form = document.getElementById("homeCardSearch");
    var input = document.getElementById("homeCardQuery");
    if (!form || !input) return;

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var query = input.value.trim();
      if (!query) {
        input.focus();
        return;
      }
      location.href = "/recherche-ia.html?q=" + encodeURIComponent(query);
    });
  }

  function initYear() {
    var year = document.getElementById("homeYear");
    if (year) year.textContent = String(new Date().getFullYear());
  }

  initLoader();

  document.addEventListener("DOMContentLoaded", function () {
    initReveal();
    initMenu();
    initSearch();
    initYear();
  });
})();
