(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  A.renderShell("integrations", "Google & SEO", "Analytics 4, Search Console, Clarity et sitemap automatique",
    '<div class="admin-panel"><p>La configuration SEO complète est disponible dans <a href="admin-seo.html" style="color:#ffe18a">SEO Enterprise</a>.</p></div>' +
    '<div class="admin-panel"><h2>Google Analytics 4</h2>' +
    '<div class="admin-filters"><input id="ga4Id" placeholder="G-XXXXXXXXXX"><button class="btn btn-primary" type="button" id="saveGa4">Enregistrer GA4</button></div>' +
    '<p id="ga4Status" style="font-size:14px;color:#baaf97">ID de mesure GA4 — chargé après consentement cookies (RGPD).</p></div>' +
    '<div class="admin-panel"><h2>Microsoft Clarity</h2>' +
    '<input id="clarityId" placeholder="Clarity Project ID"><button class="btn btn-primary" type="button" id="saveClarity">Enregistrer Clarity</button></div>' +
    '<div class="admin-panel"><h2>Google Search Console</h2>' +
    '<p>Fichier de vérification : <a href="google-search-console.txt" target="_blank">google-search-console.txt</a></p>' +
    '<p id="gscStatus" style="font-size:14px">Remplacez le contenu par votre code de vérification Google.</p></div>' +
    '<div class="admin-panel"><h2>Sitemap & Robots</h2>' +
    '<ul><li><a href="sitemap.xml" target="_blank">sitemap.xml</a> — statique (script generate-sitemap)</li>' +
    '<li><a href="https://cardoria-site-2.onrender.com/api/seo/sitemap.xml" target="_blank">Sitemap dynamique API</a></li>' +
    '<li><a href="robots.txt" target="_blank">robots.txt</a></li></ul></div>');

  A.adminFetch("/api/admin/integrations").then(function (d) {
    if (!d.ok) return;
    A.qs("#ga4Id").value = d.settings.ga4Id || "";
    A.qs("#clarityId").value = d.settings.clarityId || "";
    A.qs("#gscStatus").textContent = "Statut GSC : " + (d.settings.gscVerified ? "Marqué vérifié" : "Configurer google-search-console.txt");
  });

  function save(extra) {
    A.adminFetch("/api/admin/integrations", {
      method: "PUT",
      body: JSON.stringify(Object.assign({ ga4Id: A.qs("#ga4Id").value, clarityId: A.qs("#clarityId").value }, extra || {}))
    }).then(function () { A.qs("#ga4Status").textContent = "Paramètres enregistrés."; });
  }

  A.qs("#saveGa4").onclick = function () { save(); };
  A.qs("#saveClarity").onclick = function () { save(); };
})();
