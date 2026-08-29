/**
 * Configuration SEO entreprise Cardoria — pages, licences, avis, analytics.
 */
window.CARDORIA_SEO = {
  siteUrl: "https://cardoria.vercel.app",
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
    url: "https://cardoria.vercel.app",
    logo: "https://cardoria.vercel.app/assets/logo/cardoria-premium.png",
    email: "Cardoria59330@gmail.com",
    address: { street: "", city: "France", country: "FR" },
    sameAs: []
  },
  aggregateRating: {
    ratingValue: "4.9",
    reviewCount: "127",
    bestRating: "5",
    worstRating: "1"
  },
  reviews: [
    { author: "Sophie R.", rating: 5, date: "2026-05-12", body: "Estimation rapide et transparente sur ma collection Pokémon. Paiement SumUp reçu en quelques jours.", license: "Pokémon" },
    { author: "Marc D.", rating: 5, date: "2026-04-28", body: "J'ai vendu un lot Yu-Gi-Oh! et One Piece. L'équipe Cardoria a vérifié chaque carte avec soin.", license: "Yu-Gi-Oh!" },
    { author: "Julien P.", rating: 5, date: "2026-06-02", body: "Marketplace premium, annonce vendue rapidement. Service sérieux et professionnel.", license: "One Piece" }
  ],
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
    "index.html": { title: "Cardoria — Estimation & rachat de cartes TCG premium", description: "Cardoria, plateforme premium française : estimation IA, expertise, rachat et vente de cartes Pokémon, Yu-Gi-Oh!, One Piece, Lorcana, Magic, Dragon Ball et Sports.", path: "/", type: "home" },
    "boutique.html": { title: "Boutique Cardoria — Cartes TCG & collectibles premium", description: "Achetez des cartes Pokémon, Yu-Gi-Oh!, One Piece, Lorcana et Magic sur la boutique Cardoria. Paiement SumUp sécurisé.", path: "/boutique.html" },
    "estimation.html": { title: "Estimation carte TCG — IA Premium Cardoria", description: "Analyse IA Cardoria : reconnaissance automatique, état de la carte, estimation multi-sources. Sans engagement.", path: "/estimation.html", type: "service" },
    "rachat-cartes.html": { title: "Rachat de cartes TCG — Cardoria", description: "Vendez vos cartes Pokémon, Yu-Gi-Oh!, One Piece et autres TCG. Rachat express, offre transparente et paiement SumUp.", path: "/rachat-cartes.html" },
    "referencement.html": { title: "Référencement cartes TCG — Cardoria", description: "Référencement et visibilité pour vendeurs de cartes à collectionner. Cardoria accompagne votre activité TCG en France.", path: "/referencement.html" },
    "contact.html": { title: "Contact Cardoria — Experts cartes TCG", description: "Contactez Cardoria pour une estimation, un rachat ou une question sur vos cartes TCG. Réponse sous 48 h.", path: "/contact.html", type: "contact" },
    "accessoires.html": { title: "Accessoires cartes TCG — Cardoria", description: "Sleeves, top loaders et classeurs premium pour protéger vos cartes Pokémon, Yu-Gi-Oh!, One Piece et Magic.", path: "/accessoires.html" },
    "carte.html": { title: "Fiche carte TCG — Cardoria", description: "Prix, rareté, extension et historique des ventes. Fiche carte optimisée Cardoria.", path: "/carte.html", type: "product" },
    "licence.html": { title: "Catalogue cartes TCG — Cardoria", description: "Parcourez le catalogue Cardoria par licence : Pokémon, Yu-Gi-Oh!, One Piece, Lorcana, Magic, Dragon Ball et Sports.", path: "/licence.html", type: "collection" },
    "scanner.html": { title: "Scanner Intelligent Cardoria — Scan cartes TCG", description: "Scannez vos cartes Pokémon, Yu-Gi-Oh!, One Piece et TCG avec l'IA Cardoria.", path: "/scanner.html" },
    "marketplace.html": { title: "Marketplace TCG — Acheter & vendre | Cardoria", description: "Marketplace Cardoria : achetez et vendez des cartes TCG entre particuliers et pros. Paiement SumUp sécurisé.", path: "/marketplace.html" },
    "vendre.html": { title: "Vendre une carte TCG — Cardoria Marketplace", description: "Publiez votre annonce sur Cardoria : photos, état, prix. Vendeurs particuliers et professionnels.", path: "/vendre.html" },
    "comparateur.html": { title: "Comparateur de prix cartes TCG — Cardoria", description: "Comparez les prix marketplace, moteur Cardoria et tendances marché.", path: "/comparateur.html" },
    "annonce.html": { title: "Annonce carte TCG — Cardoria Marketplace", description: "Détail annonce marketplace. Achat sécurisé SumUp, profil vendeur vérifié.", path: "/annonce.html", type: "product" },
    "tendances.html": { title: "Tendances marché TCG — Cardoria IA", description: "Cartes Pokémon et TCG en hausse ou en baisse. Analyse IA Cardoria.", path: "/tendances.html" },
    "faq.html": { title: "FAQ Cardoria — Estimation, rachat & vente TCG", description: "Questions fréquentes sur l'estimation, le rachat et la vente de cartes Pokémon, Yu-Gi-Oh!, One Piece et TCG.", path: "/pages/faq/", type: "faq" },
    "a-propos.html": { title: "À propos de Cardoria — Experts cartes TCG", description: "Cardoria, plateforme premium française dédiée aux cartes à collectionner : expertise, IA, marketplace et rachat.", path: "/pages/a-propos/", type: "about" },
    "mentions-legales.html": { title: "Mentions légales — Cardoria", description: "Mentions légales du site Cardoria, plateforme TCG premium.", path: "/pages/mentions-legales/", type: "legal" },
    "confidentialite.html": { title: "Politique de confidentialité — Cardoria", description: "Politique de confidentialité et protection des données personnelles Cardoria (RGPD).", path: "/pages/confidentialite/", type: "legal" },
    "cgv.html": { title: "Conditions générales de vente — Cardoria", description: "CGV Cardoria : conditions de vente boutique, marketplace et services d'estimation.", path: "/pages/cgv/", type: "legal" },
    "blog.html": { title: "Blog TCG Cardoria — Guides & tendances", description: "Articles SEO Cardoria : guides estimation, tendances Pokémon, Yu-Gi-Oh!, marketplace.", path: "/pages/blog/", type: "blog" },
    "blog-article.html": { title: "Article — Blog Cardoria", description: "Article du blog Cardoria sur les cartes à collectionner.", path: "/pages/blog/article.html", type: "article" },
    "licences.html": { title: "Toutes les licences TCG — Cardoria", description: "Pokémon, Yu-Gi-Oh!, One Piece, Lorcana, Magic, Dragon Ball, Sports : pages SEO par licence.", path: "/pages/licences/", type: "collection" },
    "extension.html": { title: "Extension TCG — Cardoria", description: "Cartes par extension : prix, rareté et fiches détaillées Cardoria.", path: "/pages/extension/", type: "collection" }
  },
  faq: [
    { question: "Comment faire estimer une carte Pokémon ou TCG ?", answer: "Envoyez des photos nettes (recto, verso, coins) via notre formulaire d'estimation IA. Cardoria analyse l'état, la rareté et le marché, puis vous transmet une estimation fiable sous 48 h." },
    { question: "Quelles licences de cartes acceptez-vous ?", answer: "Cardoria expertises Pokémon, Yu-Gi-Oh!, One Piece, Lorcana, Magic, Dragon Ball et cartes Sports. Toutes les extensions et éditions sont acceptées." },
    { question: "Combien de temps pour recevoir une estimation ?", answer: "La plupart des demandes reçoivent une estimation sous 24 à 48 h ouvrées. Les collections volumineuses peuvent nécessiter un délai supplémentaire." },
    { question: "Proposez-vous le rachat de cartes à collectionner ?", answer: "Oui. Après estimation, Cardoria peut vous faire une offre de rachat express. Vous êtes libre d'accepter ou de refuser, sans engagement." },
    { question: "Comment vendre ma collection de cartes TCG ?", answer: "Contactez Cardoria via le formulaire d'estimation ou la page rachat. Listez vos cartes ou envoyez des photos de lot : nous vous proposons une offre transparente." },
    { question: "Les estimations Cardoria sont-elles fiables ?", answer: "Chaque carte est analysée par des experts et l'IA Cardoria. L'estimation croise plusieurs sources marché et tient compte de l'état, la rareté et les tendances." },
    { question: "Quels moyens de paiement acceptez-vous ?", answer: "Cardoria utilise SumUp pour les paiements par carte bancaire sécurisée, sur la boutique et la marketplace." },
    { question: "Comment fonctionne la marketplace Cardoria ?", answer: "Publiez une annonce avec photos et état, les acheteurs paient via SumUp. Expédition Mondial Relay, Colissimo ou Chronopost." }
  ],
  breadcrumbs: {}
};

/** URL API backend Render — utilisée par tous les modules client */
window.CARDORIA_BACKEND = window.CARDORIA_SEO.backendUrl;
