/**
 * Configuration SEO Cardoria — préparation domaine officiel.
 */
(function () {
  var OFFICIAL_SITE = "https://cardoria.fr";
  window.CARDORIA_SEO = {
    siteUrl: OFFICIAL_SITE,
    backendUrl: "https://cardoria-site-2.onrender.com",
    siteName: "Cardoria",
    locale: "fr_FR",
    lang: "fr",
    email: "Cardoria59330@gmail.com",
    phone: "",
    defaultImage: "/assets/logo/cardoria-premium.png",
    twitterHandle: "@CardoriaTCG",
    ga4Id: "",
    clarityId: "",
    organization: {
      name: "Cardoria",
      legalName: "Cardoria",
      url: OFFICIAL_SITE,
      logo: OFFICIAL_SITE + "/assets/logo/cardoria-premium.png",
      email: "Cardoria59330@gmail.com",
      address: { street: "", city: "France", country: "FR" },
      sameAs: []
    },
    // Aucun aggregateRating / avis factice : ne publier que des avis réellement vérifiés.
    licenses: {
      pokemon: { name: "Pokémon", icon: "⚡", path: "/pages/licences/pokemon/", catalog: "/licence.html?slug=pokemon" },
      yugioh: { name: "Yu-Gi-Oh!", icon: "🔷", path: "/pages/licences/yugioh/", catalog: "/licence.html?slug=yugioh" },
      onepiece: { name: "One Piece", icon: "🏴‍☠️", path: "/pages/licences/onepiece/", catalog: "/licence.html?slug=onepiece" },
      lorcana: { name: "Lorcana", icon: "✨", path: "/pages/licences/lorcana/", catalog: "/licence.html?slug=lorcana" },
      magic: { name: "Magic", icon: "🔮", path: "/pages/licences/magic/", catalog: "/licence.html?slug=magic" },
      dragonball: { name: "Dragon Ball", icon: "🐉", path: "/pages/licences/dragonball/", catalog: "/licence.html?slug=dragonball" },
      sports: { name: "Sports", icon: "⚽", path: "/pages/licences/sports/", catalog: "/licence.html?slug=sports" }
    },
    pages: {
      "index.html": { title: "Cardoria — Estimation & rachat de cartes TCG premium", description: "Cardoria, plateforme française dédiée aux cartes à collectionner : estimation, expertise, rachat et marketplace.", path: "/", type: "home" },
      "boutique.html": { title: "Boutique Cardoria — Cartes TCG & collectibles", description: "Découvrez les cartes et collectibles disponibles chez Cardoria.", path: "/boutique.html" },
      "estimation.html": { title: "Estimation carte TCG — Cardoria", description: "Analyse Cardoria : reconnaissance, état de la carte et estimation multi-sources, sans engagement.", path: "/estimation.html", type: "service" },
      "rachat-cartes.html": { title: "Rachat de cartes TCG — Cardoria", description: "Faites estimer vos cartes avant toute proposition de rachat Cardoria.", path: "/rachat-cartes.html" },
      "referencement.html": { title: "Référencement cartes TCG — Cardoria", description: "Référencement et visibilité pour vendeurs de cartes à collectionner.", path: "/referencement.html" },
      "contact.html": { title: "Contact Cardoria", description: "Contactez Cardoria pour une estimation, un rachat ou une question sur vos cartes TCG.", path: "/contact.html", type: "contact" },
      "accessoires.html": { title: "Accessoires cartes TCG — Cardoria", description: "Accessoires de protection pour cartes à collectionner.", path: "/accessoires.html" },
      "carte.html": { title: "Fiche carte TCG — Cardoria", description: "Prix, rareté, extension et données marché disponibles pour une carte référencée.", path: "/carte.html", type: "product" },
      "licence.html": { title: "Catalogue cartes TCG — Cardoria", description: "Parcourez le catalogue Cardoria par licence.", path: "/licence.html", type: "collection" },
      "scanner.html": { title: "Scanner Cardoria — Cartes TCG", description: "Scannez une carte et recherchez sa référence dans Cardoria.", path: "/scanner.html" },
      "marketplace.html": { title: "Marketplace TCG — Acheter & vendre | Cardoria", description: "Marketplace Cardoria : achetez et vendez des cartes TCG. Paiement Marketplace via PayPal.", path: "/marketplace.html" },
      "vendre.html": { title: "Vendre une carte TCG — Cardoria Marketplace", description: "Créez une annonce Cardoria avec photos, état et prix.", path: "/vendre.html" },
      "comparateur.html": { title: "Comparateur de prix cartes TCG — Cardoria", description: "Comparez les références marché disponibles dans Cardoria.", path: "/comparateur.html" },
      "annonce.html": { title: "Annonce carte TCG — Cardoria Marketplace", description: "Détail d'une annonce Marketplace Cardoria et informations vendeur.", path: "/annonce.html", type: "product" },
      "tendances.html": { title: "Tendances marché TCG — Cardoria", description: "Suivez les tendances issues des données marché disponibles dans Cardoria.", path: "/tendances.html" },
      "faq.html": { title: "FAQ Cardoria", description: "Questions fréquentes sur Cardoria.", path: "/pages/faq/", type: "faq" },
      "a-propos.html": { title: "À propos de Cardoria", description: "Présentation de Cardoria et de ses services autour des cartes à collectionner.", path: "/pages/a-propos/", type: "about" },
      "mentions-legales.html": { title: "Mentions légales — Cardoria", description: "Mentions légales du site Cardoria.", path: "/pages/mentions-legales/", type: "legal" },
      "confidentialite.html": { title: "Politique de confidentialité — Cardoria", description: "Politique de confidentialité et protection des données personnelles Cardoria.", path: "/pages/confidentialite/", type: "legal" },
      "cgv.html": { title: "Conditions générales — Cardoria", description: "Conditions générales applicables aux services Cardoria.", path: "/pages/cgv/", type: "legal" },
      "blog.html": { title: "Blog TCG Cardoria", description: "Guides et informations sur les cartes à collectionner.", path: "/pages/blog/", type: "blog" },
      "blog-article.html": { title: "Article — Blog Cardoria", description: "Article du blog Cardoria.", path: "/pages/blog/article.html", type: "article" },
      "licences.html": { title: "Toutes les licences TCG — Cardoria", description: "Découvrez les licences référencées par Cardoria.", path: "/pages/licences/", type: "collection" },
      "extension.html": { title: "Extension TCG — Cardoria", description: "Cartes référencées par extension.", path: "/pages/extension/", type: "collection" }
    },
    faq: [],
    breadcrumbs: {}
  };
  window.CARDORIA_BACKEND = window.CARDORIA_SEO.backendUrl;
})();
