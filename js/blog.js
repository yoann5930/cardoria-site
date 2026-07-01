(function () {
  "use strict";
  var BACKEND = (window.CARDORIA_SEO && CARDORIA_SEO.backendUrl) || "https://cardoria-backend.onrender.com";
  var base = location.pathname.indexOf("/pages/") !== -1 ? "../../" : "";
  var isArticle = location.pathname.indexOf("article.html") !== -1;

  if (isArticle) {
    var slug = new URLSearchParams(location.search).get("slug");
    var root = document.getElementById("articleRoot");
    if (!slug || !root) return;
    fetch(BACKEND + "/api/seo/blog/" + encodeURIComponent(slug))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok || !d.post) { root.innerHTML = "<h1>Article introuvable</h1>"; return; }
        var p = d.post;
        window.CARDORIA_SEO_PAGE = {
          title: p.metaTitle || p.title,
          description: p.metaDescription || p.excerpt,
          path: "/pages/blog/article.html?slug=" + p.slug,
          type: "article",
          breadcrumbs: [
            { name: "Accueil", url: "/index.html" },
            { name: "Blog", url: "/pages/blog/" },
            { name: p.title, url: "/pages/blog/article.html?slug=" + p.slug }
          ]
        };
        document.title = p.metaTitle || p.title;
        root.innerHTML =
          '<nav class="engine-breadcrumb"><a href="' + base + 'index.html">Accueil</a> › <a href="' + base + 'pages/blog/">Blog</a> › ' + p.title + "</nav>" +
          "<h1>" + p.title + "</h1>" +
          '<p class="small" style="color:#baaf97">' + (p.updatedAt || p.createdAt || "").slice(0, 10) + " — " + (p.author || "Cardoria") + "</p>" +
          '<div class="seo-section">' + p.contentHtml + "</div>" +
          '<p><a class="btn btn-primary" href="' + base + 'pages/estimation/">Estimer une carte</a></p>';
      });
    return;
  }

  var list = document.getElementById("blogList");
  if (!list) return;
  fetch(BACKEND + "/api/seo/blog?limit=24")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      list.innerHTML = (d.posts || []).map(function (p) {
        return '<article class="blog-item"><h2><a href="article.html?slug=' + encodeURIComponent(p.slug) + '">' + p.title + "</a></h2><p>" + (p.excerpt || p.metaDescription || "") + "</p></article>";
      }).join("") || "<p>Aucun article pour le moment.</p>";
    });
})();
