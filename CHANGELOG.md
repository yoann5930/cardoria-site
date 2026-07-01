# Changelog — Cardoria

Toutes les modifications notables du projet sont documentées ici.

Format basé sur [Keep a Changelog](https://keepachangelog.com/).

---

## [1.0.0] — 2026-07-01 — Ready for Launch

### Ajouté
- **Marketplace v1.0** : annonces, panier, SumUp, commandes, expédition, factures TVA, vendeurs, litiges, admin
- **IA Enterprise** : historique, fiabilité, auto-ajustement, prédictions, dashboard
- **Ultimate Enterprise** : comparateur, advisor, détection exceptionnelle, recherche NL
- **Big Data Engine** : indices, tendances, heatmap, analytics
- **Module lancement V1** (`backend/lib/launch/`) : journaux, maintenance, rotation backups, alertes
- **Admin système** : `admin-system.html` — santé, backups, logs, maintenance, version
- **Scripts** : audit-launch, build-production, generate-launch-sitemap
- **Optimisation** : `js/launch-perf.js`, `css/launch-perf.css`, build minifié
- **SEO lancement** : `sitemap-index.xml`, templates Schema.org, guides Google/Bing
- **Documentation production** : README_PRODUCTION, VERSION, ROADMAP, rapport validation

### Sécurité
- Rate limiting API / auth / IA
- CSRF admin, validation serveur marketplace
- Journaux connexions et paiements

### Infrastructure
- Render (backend) + Vercel (frontend)
- SQLite avec backups automatiques et rotation
- Compatible PostgreSQL (architecture)

---

## [0.9.x] — Pré-release

- Moteur cartes TCG (7 licences)
- Estimation IA Premium + Scanner
- Boutique SumUp
- SEO Enterprise (sitemap dynamique, blog, pages licences)
- Admin Enterprise (24 modules)
