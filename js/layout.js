(function () {
  "use strict";

  var A = window.CARDORIA_ASSETS || { logo: "/assets/logo/cardoria-premium.png" };

  function renderHeader() {
    var slot = document.getElementById("site-header");
    if (!slot) return;
    slot.innerHTML =
      '<header class="header"><div class="container nav">' +
      '<a class="brand" href="/" aria-label="CardoriaShop.fr — site officiel Cardoria"><img src="' + A.logo + '" alt="CardoriaShop.fr — site officiel Cardoria" width="58" height="42" loading="eager" decoding="async"><span>CARDORIA</span></a>' +
      '<button class="burger" type="button" aria-label="Ouvrir le menu" onclick="toggleMenu()">Menu</button>' +
      '<nav class="menu" id="menu" aria-label="Navigation principale">' +
      '<a href="/">Accueil</a>' +
      '<a href="/boutique.html">Boutique</a>' +
      '<a href="/marketplace.html">Marketplace</a>' +
      '<a href="/estimation.html">Estimation</a>' +
      '<a href="/pages/licences/">Licences</a>' +
      '<a href="/pages/contact/">Contact</a>' +
      '<a href="/admin-login.html">Admin</a>' +
      "</nav></div></header>";
  }

  function renderFooter() {
    var slot = document.getElementById("site-footer");
    if (!slot) return;
    var lic = window.CARDORIA_SEO && CARDORIA_SEO.licenses ? CARDORIA_SEO.licenses : {};
    var licLinks = Object.keys(lic).map(function (k) {
      var l = lic[k];
      return '<li><a href="/pages/licences/' + k + '/">' + l.name + "</a></li>";
    }).join("");

    slot.innerHTML =
      '<footer class="footer-premium">' +
      '<div class="container footer-grid">' +
      '<div class="footer-brand">' +
      '<img src="' + A.logo + '" alt="CardoriaShop.fr — logo Cardoria" width="90" height="65" loading="lazy" decoding="async">' +
      '<p><strong>CardoriaShop.fr</strong> est le site officiel de Cardoria : catalogue, estimation, boutique et marketplace de cartes TCG.</p>' +
      '<p class="footer-email"><a href="mailto:Cardoria59330@gmail.com">Cardoria59330@gmail.com</a></p>' +
      "</div>" +
      '<div class="footer-col"><h4>Navigation</h4><ul>' +
      '<li><a href="/">Accueil</a></li>' +
      '<li><a href="/boutique.html">Boutique</a></li>' +
      '<li><a href="/marketplace.html">Marketplace</a></li>' +
      '<li><a href="/estimation.html">Estimation</a></li>' +
      '<li><a href="/tendances.html">Tendances</a></li>' +
      "</ul></div>" +
      '<div class="footer-col"><h4>Informations</h4><ul>' +
      '<li><a href="/pages/a-propos/">À propos de CardoriaShop</a></li>' +
      '<li><a href="/pages/faq/">FAQ</a></li>' +
      '<li><a href="/pages/blog/">Blog TCG</a></li>' +
      '<li><a href="/referencement.html">Référencement</a></li>' +
      '<li><a href="/pages/contact/">Contact</a></li>' +
      '<li><a href="/admin-login.html">Admin</a></li>' +
      "</ul></div>" +
      '<div class="footer-col"><h4>Légal</h4><ul>' +
      '<li><a href="/pages/mentions-legales/">Mentions légales</a></li>' +
      '<li><a href="/pages/confidentialite/">Confidentialité</a></li>' +
      '<li><a href="/pages/cgv/">CGV</a></li>' +
      "</ul></div>" +
      '<div class="footer-col"><h4>Licences TCG</h4><ul>' + licLinks + "</ul></div>" +
      "</div>" +
      '<div class="footer-bottom"><div class="container footer-cta">' +
      '<div class="footer-cta-text"><h3>Estimez vos cartes avec CardoriaShop</h3><p>Photos + analyse multi-sources — sans engagement.</p></div>' +
      '<a class="btn btn-primary" href="/estimation.html">Faire estimer une carte</a></div>' +
      '<div class="container footer-bottom-inner">' +
      '<p class="small">© ' + new Date().getFullYear() + ' CardoriaShop.fr — Site officiel Cardoria</p>' +
      '<p class="small"><a href="/pages/a-propos/">Identité CardoriaShop</a> • <a href="/sitemap.xml">Sitemap</a></p></div></div></footer>';
  }

  document.addEventListener("DOMContentLoaded", function () {
    renderHeader();
    renderFooter();
    if (location.pathname.indexOf("admin") === -1) {
      var attr = document.createElement("script");
      attr.src = "/js/attribution.js";
      attr.defer = true;
      document.head.appendChild(attr);
    }
    if (window.CardoriaAnalytics) CardoriaAnalytics.init();
  });
})();
