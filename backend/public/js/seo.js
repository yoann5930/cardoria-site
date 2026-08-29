(function () {
  "use strict";

  var cfg = window.CARDORIA_SEO;
  if (!cfg) return;

  function pageKey() {
    var path = location.pathname.replace(/\/$/, "") || "/";
    if (path.endsWith("/pages/estimation") || path.endsWith("/pages/estimation/index.html")) return "estimation.html";
    if (path.endsWith("/pages/boutique") || path.endsWith("/pages/boutique/index.html")) return "boutique.html";
    if (path.indexOf("/pages/faq") !== -1) return "faq.html";
    if (path.indexOf("/pages/a-propos") !== -1) return "a-propos.html";
    if (path.indexOf("/pages/mentions-legales") !== -1) return "mentions-legales.html";
    if (path.indexOf("/pages/confidentialite") !== -1) return "confidentialite.html";
    if (path.indexOf("/pages/cgv") !== -1) return "cgv.html";
    if (path.indexOf("/pages/blog/article") !== -1) return "blog-article.html";
    if (path.indexOf("/pages/blog") !== -1) return "blog.html";
    if (path.indexOf("/pages/licences/") !== -1 && !path.endsWith("/pages/licences")) return "licences.html";
    if (path.indexOf("/pages/licences") !== -1) return "licences.html";
    if (path.indexOf("/pages/extension") !== -1) return "extension.html";
    if (path.indexOf("/pages/contact") !== -1) return "contact.html";
    var file = path.split("/").pop() || "index.html";
    return file.indexOf(".html") === -1 ? "index.html" : file;
  }

  function upsertMeta(name, content, attr) {
    if (!content) return;
    attr = attr || "name";
    var el = document.querySelector('meta[' + attr + '="' + name + '"]');
    if (!el) { el = document.createElement("meta"); el.setAttribute(attr, name); document.head.appendChild(el); }
    el.setAttribute("content", content);
  }

  function upsertLink(rel, href, extra) {
    var sel = 'link[rel="' + rel + '"]';
    if (extra) sel += extra;
    var el = document.querySelector(sel);
    if (!el) { el = document.createElement("link"); el.setAttribute("rel", rel); document.head.appendChild(el); }
    el.setAttribute("href", href);
  }

  function injectJsonLd(data) {
    var s = document.createElement("script");
    s.type = "application/ld+json";
    s.textContent = JSON.stringify(data);
    document.head.appendChild(s);
  }

  function abs(path) {
    if (!path) return cfg.siteUrl;
    if (path.startsWith("http")) return path;
    return cfg.siteUrl + (path.startsWith("/") ? path : "/" + path);
  }

  var key = pageKey();
  var page = cfg.pages[key] || cfg.pages["index.html"];
  var custom = window.CARDORIA_SEO_PAGE || {};

  if (location.pathname.indexOf("/pages/licences/") !== -1 && !location.pathname.match(/\/pages\/licences\/?$/)) {
    var slugMatch = location.pathname.match(/\/pages\/licences\/([^/]+)/);
    if (slugMatch && cfg.licenses && cfg.licenses[slugMatch[1]]) {
      var licMeta = document.querySelector('meta[name="description"]');
      page = {
        title: document.title,
        description: licMeta ? licMeta.getAttribute("content") : page.description,
        path: "/pages/licences/" + slugMatch[1] + "/",
        type: "collection"
      };
      custom.breadcrumbs = custom.breadcrumbs || [
        { name: "Accueil", url: "/index.html" },
        { name: "Licences", url: "/pages/licences/" },
        { name: cfg.licenses[slugMatch[1]].name, url: "/pages/licences/" + slugMatch[1] + "/" }
      ];
    }
  }

  var title = custom.title || page.title;
  var description = custom.description || page.description;
  var url = abs(custom.path || page.path || location.pathname);
  var image = abs(custom.image || cfg.defaultImage);
  var type = custom.type || page.type || "website";

  document.documentElement.lang = cfg.lang || "fr";
  document.title = title;
  upsertMeta("description", description);
  upsertMeta("robots", custom.robots || "index,follow");
  upsertMeta("author", cfg.siteName);
  upsertMeta("theme-color", "#080a0f");
  upsertLink("canonical", url);

  upsertMeta("og:title", title, "property");
  upsertMeta("og:description", description, "property");
  upsertMeta("og:url", url, "property");
  upsertMeta("og:type", type === "product" ? "product" : type === "article" ? "article" : "website", "property");
  upsertMeta("og:locale", cfg.locale, "property");
  upsertMeta("og:site_name", cfg.siteName, "property");
  upsertMeta("og:image", image, "property");
  upsertMeta("og:image:width", "1200", "property");
  upsertMeta("og:image:height", "630", "property");
  upsertMeta("og:image:alt", title, "property");

  upsertMeta("twitter:card", "summary_large_image");
  upsertMeta("twitter:title", title);
  upsertMeta("twitter:description", description);
  upsertMeta("twitter:image", image);
  if (cfg.twitterHandle) upsertMeta("twitter:site", cfg.twitterHandle);

  var org = cfg.organization || {};
  injectJsonLd({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: org.name || cfg.siteName,
    legalName: org.legalName || cfg.siteName,
    url: cfg.siteUrl,
    logo: abs(org.logo || cfg.defaultImage),
    email: org.email || cfg.email,
    address: org.address ? { "@type": "PostalAddress", addressCountry: org.address.country || "FR" } : undefined,
    sameAs: org.sameAs || [],
    aggregateRating: cfg.aggregateRating ? {
      "@type": "AggregateRating",
      ratingValue: cfg.aggregateRating.ratingValue,
      reviewCount: cfg.aggregateRating.reviewCount,
      bestRating: cfg.aggregateRating.bestRating || "5"
    } : undefined
  });

  injectJsonLd({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: cfg.siteName,
    url: cfg.siteUrl,
    inLanguage: "fr-FR",
    publisher: { "@type": "Organization", name: cfg.siteName },
    potentialAction: {
      "@type": "SearchAction",
      target: cfg.siteUrl + "/licence.html?q={search_term_string}",
      "query-input": "required name=search_term_string"
    }
  });

  if (cfg.reviews && cfg.reviews.length) {
    cfg.reviews.forEach(function (r) {
      injectJsonLd({
        "@context": "https://schema.org",
        "@type": "Review",
        itemReviewed: { "@type": "Organization", name: cfg.siteName },
        author: { "@type": "Person", name: r.author },
        reviewRating: { "@type": "Rating", ratingValue: String(r.rating), bestRating: "5" },
        datePublished: r.date,
        reviewBody: r.body
      });
    });
  }

  var crumbs = custom.breadcrumbs || cfg.breadcrumbs[key];
  if (crumbs && crumbs.length) {
    injectJsonLd({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map(function (c, i) {
        return { "@type": "ListItem", position: i + 1, name: c.name, item: abs(c.url) };
      })
    });
  }

  if (type === "faq" || (type === "home" && cfg.faq && cfg.faq.length && !custom.skipFaq)) {
    var faqItems = custom.faq || cfg.faq;
    if (faqItems && faqItems.length) {
      injectJsonLd({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqItems.map(function (item) {
          return { "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } };
        })
      });
    }
  }

  if (type === "collection") {
    injectJsonLd({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: title,
      description: description,
      url: url,
      isPartOf: { "@type": "WebSite", name: cfg.siteName, url: cfg.siteUrl }
    });
  }

  if (type === "product" && custom.product) {
    var p = custom.product;
    injectJsonLd({
      "@context": "https://schema.org",
      "@type": "Product",
      name: p.name,
      description: p.description || description,
      image: p.image ? abs(p.image) : image,
      sku: p.sku || p.id,
      brand: { "@type": "Brand", name: p.brand || cfg.siteName },
      offers: p.offers || {
        "@type": "Offer",
        price: p.price || "0",
        priceCurrency: "EUR",
        availability: "https://schema.org/InStock",
        url: url
      }
    });
  }

  window.CardoriaSeoApplied = { key: key, title: title, url: url };
})();
