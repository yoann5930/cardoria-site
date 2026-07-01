(function () {
  "use strict";
  var A = window.CardoriaAdmin;
  if (!A.protectAdmin()) return;

  function loadStats() {
    A.adminFetch("/api/admin/seo/stats").then(function (d) {
      if (!d.ok) return;
      var s = d.stats;
      A.qs("#seoStats").textContent =
        "Pages statiques : " + s.staticPages + " • Licences : " + s.licenses +
        " • Extensions : " + s.extensions + " • Articles blog : " + s.blogPosts +
        " • Cartes indexées : " + s.cards;
    });
  }

  function loadBlog() {
    A.adminFetch("/api/admin/seo/blog").then(function (d) {
      A.qs("#blogAdminList").innerHTML = (d.posts || []).map(function (p) {
        return "<tr><td>" + p.title + "</td><td>" + p.slug + "</td><td>" + (p.published ? "Publié" : "Brouillon") + "</td><td>" +
          '<button type="button" class="btn btn-secondary" data-del="' + p.id + '">Supprimer</button></td></tr>";
      }).join("") || "<tr><td colspan='4'>Aucun article</td></tr>";
      A.qs("#blogAdminList").closest("table").querySelectorAll("[data-del]").forEach(function (btn) {
        btn.onclick = function () {
          if (confirm("Supprimer cet article ?")) {
            A.adminFetch("/api/admin/seo/blog/" + btn.dataset.del, { method: "DELETE" }).then(loadBlog);
          }
        };
      });
    });
  }

  A.renderShell("seo", "SEO Enterprise", "Sitemap, blog, analytics GA4 & Microsoft Clarity",
    '<div class="admin-panel"><p id="seoStats">Chargement…</p>' +
    '<div class="admin-filters"><button class="btn btn-primary" type="button" id="seoRegen">Régénérer pages SEO</button>' +
    '<a class="btn btn-secondary" href="sitemap.xml" target="_blank">Sitemap statique</a>' +
    '<a class="btn btn-secondary" href="https://cardoria-backend.onrender.com/api/seo/sitemap.xml" target="_blank">Sitemap dynamique API</a></div></div>' +
    '<div class="admin-panel"><h2>Google Analytics 4 & Clarity</h2>' +
    '<div class="admin-filters" style="flex-direction:column;align-items:stretch;gap:10px">' +
    '<input id="ga4Id" placeholder="G-XXXXXXXXXX">' +
    '<input id="clarityId" placeholder="Clarity Project ID">' +
    '<button class="btn btn-primary" type="button" id="saveTracking">Enregistrer</button></div>' +
    '<p id="trackingStatus" style="font-size:13px;color:#baaf97;margin-top:10px"></p>' +
    '<p>Search Console : fichier <code>google-search-console.txt</code> à la racine du site.</p></div>' +
    '<div class="admin-panel"><h2>Nouvel article blog SEO</h2>' +
    '<input id="blogTitle" placeholder="Titre">' +
    '<input id="blogSlug" placeholder="slug-url (optionnel)">' +
    '<textarea id="blogDesc" rows="2" placeholder="Meta description"></textarea>' +
    '<textarea id="blogContent" rows="8" placeholder="Contenu HTML (h2, p, ul…)"></textarea>' +
    '<button class="btn btn-primary" type="button" id="blogSave">Publier</button></div>' +
    '<div class="admin-panel"><h2>Articles publiés</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Titre</th><th>Slug</th><th>Statut</th><th></th></tr></thead><tbody id="blogAdminList"></tbody></table></div></div>');

  A.adminFetch("/api/admin/seo/settings").then(function (d) {
    if (d.ok && d.settings) {
      A.qs("#ga4Id").value = d.settings.ga4Id || "";
      A.qs("#clarityId").value = d.settings.clarityId || "";
    }
  });

  A.qs("#saveTracking").onclick = function () {
    A.adminFetch("/api/admin/seo/settings", {
      method: "PUT",
      body: JSON.stringify({ ga4Id: A.qs("#ga4Id").value, clarityId: A.qs("#clarityId").value, gscVerified: true })
    }).then(function () { A.qs("#trackingStatus").textContent = "Analytics enregistrés — actifs après consentement cookies client."; });
  };

  A.qs("#seoRegen").onclick = function () {
    A.adminFetch("/api/admin/seo/regenerate", { method: "POST" }).then(function (d) {
      alert("Pages régénérées : " + d.licenses + " licences, " + d.extensions + " extensions");
      loadStats();
    });
  };

  A.qs("#blogSave").onclick = function () {
    A.adminFetch("/api/admin/seo/blog", {
      method: "POST",
      body: JSON.stringify({
        title: A.qs("#blogTitle").value,
        slug: A.qs("#blogSlug").value,
        metaDescription: A.qs("#blogDesc").value,
        contentHtml: A.qs("#blogContent").value,
        excerpt: A.qs("#blogDesc").value.slice(0, 160)
      })
    }).then(function () {
      A.qs("#blogTitle").value = ""; A.qs("#blogSlug").value = ""; A.qs("#blogDesc").value = ""; A.qs("#blogContent").value = "";
      loadBlog(); loadStats();
    });
  };

  loadStats();
  loadBlog();
})();
