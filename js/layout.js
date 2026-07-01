(function () {
  "use strict";

  function rootPath() {
    return location.pathname.indexOf("/pages/") !== -1 ? "../../" : "";
  }

  function renderHeader() {
    var base = rootPath();
    var slot = document.getElementById("site-header");
    if (!slot) return;
    slot.innerHTML =
      '<header class="header"><div class="container nav">' +
      '<a class="brand" href="' + base + 'index.html"><img src="' + base + 'assets/logo/cardoria-premium.png" alt="Cardoria — cartes TCG premium" width="58" height="42" loading="eager" decoding="async" onerror="this.src=\'' + base + 'logo-cardoria.jpg\'"><span>CARDORIA</span></a>' +
      '<button class="burger" type="button" aria-label="Ouvrir le menu" onclick="toggleMenu()">Menu</button>' +
      '<nav class="menu" id="menu" aria-label="Navigation principale">' +
      '<a href="' + base + 'index.html">Accueil</a>' +
      '<a href="' + base + 'pages/boutique/">Boutique</a>' +
      '<a href="' + base + 'marketplace.html">Marketplace</a>' +
      '<a href="' + base + 'pages/estimation/">Estimation IA</a>' +
      '<a href="' + base + 'rachat-cartes.html">Rachat</a>' +
      '<a href="' + base + 'pages/licences/">Licences</a>' +
      '<a href="' + base + 'pages/blog/">Blog</a>' +
      '<a href="' + base + 'pages/faq/">FAQ</a>' +
      '<a href="' + base + 'pages/contact/">Contact</a>' +
      "</nav></div></header>";
  }

  function renderFooter() {
    var base = rootPath();
    var slot = document.getElementById("site-footer");
    if (!slot) return;
    var lic = window.CARDORIA_SEO && CARDORIA_SEO.licenses ? CARDORIA_SEO.licenses : {};
    var licLinks = Object.keys(lic).map(function (k) {
      var l = lic[k];
      return '<li><a href="' + base + 'pages/licences/' + k + '/">' + l.name + "</a></li>";
    }).join("");

    slot.innerHTML =
      '<footer class="footer-premium">' +
      '<div class="container footer-grid">' +
      '<div class="footer-brand">' +
      '<img src="' + base + 'assets/logo/cardoria-premium.png" alt="Cardoria logo" width="90" height="65" loading="lazy" decoding="async" onerror="this.src=\'' + base + 'logo-cardoria.jpg\'">' +
      "<p>Plateforme premium française : estimation IA, marketplace, rachat et expertise cartes TCG.</p>" +
      '<p class="footer-email"><a href="mailto:Cardoria59330@gmail.com">Cardoria59330@gmail.com</a></p>' +
      "</div>" +
      '<div class="footer-col"><h4>Navigation</h4><ul>' +
      '<li><a href="' + base + 'index.html">Accueil</a></li>' +
      '<li><a href="' + base + 'pages/boutique/">Boutique</a></li>' +
      '<li><a href="' + base + 'marketplace.html">Marketplace</a></li>' +
      '<li><a href="' + base + 'pages/estimation/">Estimation</a></li>' +
      '<li><a href="' + base + 'tendances.html">Tendances</a></li>' +
      "</ul></div>" +
      '<div class="footer-col"><h4>Informations</h4><ul>' +
      '<li><a href="' + base + 'pages/a-propos/">À propos</a></li>' +
      '<li><a href="' + base + 'pages/faq/">FAQ</a></li>' +
      '<li><a href="' + base + 'pages/blog/">Blog TCG</a></li>' +
      '<li><a href="' + base + 'referencement.html">Référencement</a></li>' +
      '<li><a href="' + base + 'pages/contact/">Contact</a></li>' +
      "</ul></div>" +
      '<div class="footer-col"><h4>Légal</h4><ul>' +
      '<li><a href="' + base + 'pages/mentions-legales/">Mentions légales</a></li>' +
      '<li><a href="' + base + 'pages/confidentialite/">Confidentialité</a></li>' +
      '<li><a href="' + base + 'pages/cgv/">CGV</a></li>' +
      "</ul></div>" +
      '<div class="footer-col"><h4>Licences TCG</h4><ul>' + licLinks + "</ul></div>" +
      "</div>" +
      '<div class="footer-bottom"><div class="container footer-cta">' +
      '<div class="footer-cta-text"><h3>Estimez vos cartes avec l\'IA Cardoria</h3><p>Photos + analyse multi-sources — sans engagement.</p></div>' +
      '<a class="btn btn-primary" href="' + base + 'pages/estimation/">Faire estimer une carte</a></div>' +
      '<div class="container footer-bottom-inner">' +
      '<p class="small">© ' + new Date().getFullYear() + " Cardoria — Trading cards • Collectibles • Premium</p>" +
      '<p class="small"><a href="' + base + 'sitemap.xml">Sitemap</a> • Paiement SumUp sécurisé</p></div></div></footer>';
  }

  document.addEventListener("DOMContentLoaded", function () {
    renderHeader();
    renderFooter();
    if (location.pathname.indexOf("admin") === -1) {
      var base = rootPath();
      var attr = document.createElement("script");
      attr.src = base + "js/attribution.js";
      attr.defer = true;
      document.head.appendChild(attr);
    }
    if (window.CardoriaAnalytics) CardoriaAnalytics.init();
  });
})();
