/**
 * Configuration SEO publique Cardoria.
 * Les données structurées doivent rester factuelles et vérifiables.
 */
window.CARDORIA_SEO = {
  siteUrl: "https://www.cardoriashop.fr",
  backendUrl: "https://www.cardoriashop.fr",
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
    url: "https://www.cardoriashop.fr",
    logo: "https://www.cardoriashop.fr/assets/logo/cardoria-premium.png",
    email: "Cardoria59330@gmail.com",
    address: { country: "FR" },
    sameAs: []
  },
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
    "index.html": { title: "Cartes Pokémon : prix, cote, estimation, achat & vente | Cardoria", description: "Cardoria référence les cartes Pokémon et TCG : prix, cote, estimation, catalogue par extension, achat, vente et marketplace entre collectionneurs en France.", path: "/", type: "home" },
    "boutique.html": { title: "Boutique cartes Pokémon & TCG | Cardoria", description: "Découvrez la boutique Cardoria : cartes Pokémon et autres TCG, collectibles et produits pour collectionneurs.", path: "/boutique.html" },
    "estimation.html": { title: "Estimation carte Pokémon & TCG — Prix et valeur | Cardoria", description: "Estimez une carte Pokémon ou TCG sur Cardoria : identification, état, rareté et données de marché pour mieux comprendre sa valeur.", path: "/estimation.html", type: "service" },
    "rachat-cartes.html": { title: "Vendre et faire racheter ses cartes Pokémon & TCG | Cardoria", description: "Faites estimer puis proposez vos cartes Pokémon, Yu-Gi-Oh!, One Piece et autres TCG au service de rachat Cardoria.", path: "/rachat-cartes.html" },
    "referencement.html": { title: "Référencement cartes TCG — Cardoria", description: "Référencement et visibilité pour vendeurs de cartes à collectionner sur Cardoria.", path: "/referencement.html" },
    "contact.html": { title: "Contact Cardoria — Cartes Pokémon & TCG", description: "Contactez Cardoria pour une question sur le catalogue, une estimation, un achat ou une vente de cartes à collectionner.", path: "/pages/contact/", type: "contact" },
    "accessoires.html": { title: "Accessoires cartes Pokémon & TCG | Cardoria", description: "Accessoires pour protéger et ranger vos cartes Pokémon et TCG : sleeves, top loaders, classeurs et protections.", path: "/accessoires.html" },
    "carte.html": { title: "Prix et fiche carte TCG | Cardoria", description: "Consultez la fiche d'une carte : prix, cote, rareté, extension, numéro et informations disponibles sur Cardoria.", path: "/carte.html", type: "product" },
    "licence.html": { title: "Catalogue cartes Pokémon & TCG par licence | Cardoria", description: "Parcourez le catalogue Cardoria par licence, extension, nom ou numéro de carte.", path: "/licence.html", type: "collection" },
    "scanner.html": { title: "Scanner de cartes Pokémon & TCG | Cardoria", description: "Scannez et identifiez vos cartes Pokémon et TCG avec les outils Cardoria.", path: "/scanner.html" },
    "marketplace.html": { title: "Marketplace cartes Pokémon & TCG — Acheter & vendre | Cardoria", description: "Marketplace Cardoria : découvrez des cartes Pokémon et TCG proposées à la vente et publiez vos annonces.", path: "/marketplace.html" },
    "vendre.html": { title: "Vendre une carte Pokémon ou TCG | Cardoria", description: "Publiez une annonce Cardoria avec photos, état et prix pour vendre une carte à collectionner.", path: "/vendre.html" },
    "comparateur.html": { title: "Comparateur de prix cartes Pokémon & TCG | Cardoria", description: "Comparez les données de prix disponibles pour vos cartes Pokémon et TCG sur Cardoria.", path: "/comparateur.html" },
    "annonce.html": { title: "Annonce carte TCG — Cardoria Marketplace", description: "Consultez le détail d'une annonce de carte à collectionner sur Cardoria.", path: "/annonce.html", type: "product" },
    "tendances.html": { title: "Prix et tendances du marché des cartes TCG | Cardoria", description: "Suivez les tendances et évolutions de prix des cartes Pokémon et autres TCG référencées sur Cardoria.", path: "/tendances.html" },
    "faq.html": { title: "FAQ Cardoria — Estimation, achat & vente de cartes TCG", description: "Réponses aux questions fréquentes sur Cardoria, le catalogue, l'estimation et la vente de cartes Pokémon et TCG.", path: "/pages/faq/", type: "faq" },
    "a-propos.html": { title: "À propos de Cardoria — Plateforme cartes Pokémon & TCG", description: "Découvrez Cardoria, plateforme française consacrée au catalogue, aux prix, à l'estimation et à la marketplace de cartes à collectionner.", path: "/pages/a-propos/", type: "about" },
    "mentions-legales.html": { title: "Mentions légales — Cardoria", description: "Mentions légales du site Cardoria.", path: "/pages/mentions-legales/", type: "legal" },
    "confidentialite.html": { title: "Politique de confidentialité — Cardoria", description: "Politique de confidentialité et protection des données personnelles Cardoria.", path: "/pages/confidentialite/", type: "legal" },
    "cgv.html": { title: "Conditions générales de vente — Cardoria", description: "Conditions générales applicables aux services et ventes Cardoria.", path: "/pages/cgv/", type: "legal" },
    "blog.html": { title: "Blog cartes Pokémon & TCG — Guides, prix et collection | Cardoria", description: "Guides Cardoria sur les cartes Pokémon et TCG : collection, identification, prix, estimation et tendances.", path: "/pages/blog/", type: "blog" },
    "blog-article.html": { title: "Guide cartes Pokémon & TCG | Cardoria", description: "Guide Cardoria consacré aux cartes à collectionner.", path: "/pages/blog/article.html", type: "article" },
    "licences.html": { title: "Catalogues Pokémon, Yu-Gi-Oh!, One Piece, Lorcana & Magic | Cardoria", description: "Explorez les catalogues Cardoria par licence et accédez aux extensions et fiches cartes.", path: "/pages/licences/", type: "collection" },
    "extension.html": { title: "Extension TCG — Liste des cartes, prix et raretés | Cardoria", description: "Consultez les cartes d'une extension TCG avec leurs numéros, raretés et données de prix disponibles.", path: "/pages/extension/", type: "collection" }
  },
  faq: [
    { question: "Comment faire estimer une carte Pokémon ou TCG ?", answer: "Utilisez la page d'estimation Cardoria avec des photos nettes et les informations disponibles sur la carte. L'analyse prend notamment en compte son identification, son état, sa rareté et les données de marché accessibles." },
    { question: "Quelles licences sont référencées sur Cardoria ?", answer: "Cardoria référence notamment Pokémon, Yu-Gi-Oh!, One Piece, Lorcana, Magic, Dragon Ball et des cartes sportives selon les données disponibles au catalogue." },
    { question: "Puis-je rechercher une carte par extension ?", answer: "Oui. Les catalogues Cardoria sont organisés par licence puis par extension, avec des fiches individuelles accessibles par carte." },
    { question: "Cardoria permet-il d'acheter et de vendre des cartes ?", answer: "Oui. Cardoria propose une boutique, une marketplace et des parcours dédiés à la vente et au rachat selon les services disponibles." }
  ],
  breadcrumbs: {}
};

window.CARDORIA_BACKEND = window.CARDORIA_SEO.backendUrl;
