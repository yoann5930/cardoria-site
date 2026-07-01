# Cardoria Backend V5 — Enterprise

API Node.js pour estimations IA, back-office administrateur, analytics et alertes sécurité.

## Démarrage local

```bash
cd backend
cp .env.example .env
# Renseigner OPENAI_API_KEY et SMTP (optionnel en dev)
npm install
npm start
```

Le serveur écoute sur le port `10000` (Render) ou `PORT` défini dans l'environnement.

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Clé API OpenAI pour l'analyse de cartes |
| `OPENAI_MODEL` | Modèle (défaut : `gpt-4.1-mini`) |
| `ADMIN_CODE` | Code d'accès admin (défaut : `CARDORIA59330`) |
| `CONFIDENCE_THRESHOLD` | Seuil alerte contrefaçon (défaut : `95`) |
| `SMTP_*` | Configuration e-mail pour alertes admin |
| `MAIL_TO` | Destinataire alertes (défaut : `Cardoria59330@gmail.com`) |

## Routes principales

### Public
- `POST /api/estimation-carte` — Estimation carte (score masqué côté client)
- `POST /api/analytics/track` — Tracking pages vues / provenance / appareil
- `GET /api/engine/licenses` — Licences TCG (Pokémon, Yu-Gi-Oh!, etc.)
- `GET /api/engine/cards?q=&license=&page=&limit=` — Catalogue paginé (FTS5)
- `GET /api/engine/cards/search?q=` — Autocomplétion
- `GET /api/engine/cards/:license/:slug` — Fiche carte complète
- `POST /api/engine/estimate-price` — Prix conseillé multi-sources
- `GET /api/engine/sitemap?page=&limit=` — URLs fiches pour sitemap dynamique

### Admin engine (`/api/admin/engine/*`)
- CRUD licences et cartes
- `PUT /api/admin/engine/cards/:id/prices` — Modifier les prix
- `POST /api/admin/engine/cards/:id/sales` — Ajouter une vente à l'historique

### Admin (header `x-cardoria-admin-code` ou query `adminCode`)
- `GET /api/admin/dashboard?period=day|week|month|year`
- `GET /api/admin/accounting/sales|purchases|stats`
- `GET /api/admin/accounting/export?format=csv|pdf&type=sales|purchases`
- `GET/POST /api/admin/users`
- `GET /api/admin/analytics/site`
- `GET /api/admin/audit`
- `POST /api/admin/backup`
- `GET/PUT /api/admin/integrations`
- `GET /api/admin/estimations`

## Sécurité IA

- Le score de confiance (`SCORE_CONFIANCE:XX`) est extrait de la réponse IA.
- Le client reçoit uniquement `clientResult` (texte nettoyé, sans score).
- Si score < 95 % : e-mail automatique à l'admin avec photos, infos client et raisons de suspicion.

## Données persistées

**Moteur cartes** — SQLite `backend/data/cardoria-engine.db` :
- Tables : `licenses`, `cards`, `price_sources`, `sales_history`, `cards_fts` (FTS5)
- Index optimisés pour millions de cartes (pagination, recherche full-text)
- Migration PostgreSQL : schéma compatible, remplacer `getDb()` par un pool PG

Fichiers JSON dans `backend/data/` :
- `estimations.json`, `users.json`, `purchases.json`
- `audit-log.json`, `site-analytics.json`, `settings.json`
- Sauvegardes dans `backend/data/backups/`

## Déploiement Render

1. Créer un Web Service Node.js pointant sur `backend/`
2. Build : `npm install`
3. Start : `npm start`
4. Ajouter les variables d'environnement
5. Mettre à jour `BACKEND_URL` dans le frontend (`script.js`, `js/admin/admin-core.js`)

## Frontend admin

Pages enterprise dans la racine du projet :
- `admin.html` — Tableau de bord
- `admin-comptabilite.html`, `admin-utilisateurs.html`, `admin-statistiques.html`
- `admin-journal.html`, `admin-integrations.html`
- `admin-commandes.html`, `admin-stock.html`, `admin-estimations.html`
- `admin-catalogue.html` — Moteur cartes (licences, fiches, prix)

## Frontend public moteur

- `licence.html?slug=pokemon` — Catalogue par licence
- `carte.html?license=pokemon&slug=...` — Fiche carte SEO (JSON-LD Product)
- `estimation.html` — Autocomplétion catalogue + estimation IA

## Marketplace (v5.3)

### Public — `/api/marketplace/*`
- `GET /listings`, `GET /listings/:id` — Annonces (FTS5, filtres, pagination)
- `GET /search?q=` — Recherche ultra-rapide (retourne `ms`)
- `POST /listings` — Publier une annonce (photos, stock, état, négociable)
- `GET /sellers/:id` — Profil vendeur (avis, badge vérifié)
- `POST /orders`, `GET /orders`, `GET /orders/:id/invoice` — Commandes & facture PDF
- `POST /checkout` — Lien de paiement SumUp (carte bancaire)
- `GET /shipping/options`, `POST /shipping/quote`
- `GET/POST/DELETE /favorites`, `/wishlist`, `/alerts`
- `GET /compare?listingId=&cardId=` — Comparateur automatique

### Paiements SumUp — `/api/payments/*`
- `POST /boutique/checkout` — Commande boutique + lien SumUp
- `GET /sumup/confirm/:checkoutId` — Synchronisation statut paiement
- Statuts : `pending` / `paid` / `failed` / `refunded`

### Webhook SumUp
- `POST /api/marketplace/webhooks/sumup` — Confirmation paiement (header `x-payload-signature`)

### Admin — `/api/admin/marketplace/*` + `/api/admin/payments/*`
- Commandes, statuts, génération étiquettes transporteurs
- Badge vendeur vérifié, alertes baisse de prix
- Historique paiements SumUp (boutique + marketplace)
- Factures liées aux références checkout SumUp

### Variables marketplace & paiement
- `SUMUP_API_KEY`, `SUMUP_MERCHANT_CODE`, `SUMUP_WEBHOOK_SECRET`
- `BOUTIQUE_SUCCESS_URL`, `MARKETPLACE_SUCCESS_URL`, `MARKETPLACE_CANCEL_URL`
- `MONDIAL_RELAY_API_KEY`, `COLISSIMO_API_KEY`, `CHRONOPOST_API_KEY`

### Pages frontend
- `marketplace.html`, `annonce.html`, `vendeur.html`, `vendre.html`
- `mes-commandes.html`, `favoris.html`, `souhaits.html`, `comparateur.html`
- `admin-marketplace.html`, `admin-paiements.html`

## IA Premium (v5.4)

### Public — `/api/ai/*`
- `POST /api/ai/analyze` — Reconnaissance photo + état + estimation multi-sources
- `GET /api/ai/history/:cardId?period=7|30|90|365` — Historique des prix
- `GET /api/ai/trends?direction=up|down` — Cartes en hausse/baisse

Legacy : `POST /api/estimation-carte` → même pipeline IA Premium.

### Admin — `/api/admin/ai/*`
- `GET /analyses`, `GET /analyses/:id` — Score authenticité visible admin uniquement
- `PUT /analyses/:id/validate` — Approuver / refuser une détection
- `PUT /analyses/:id/correct` — Corriger estimation
- `POST /retrain` — Intégrer les validations au contexte IA (few-shot)

### Sécurité
- Score d'authenticité **jamais** renvoyé au client
- Alerte e-mail automatique si score < 95 % → Cardoria59330@gmail.com

### Pages
- `estimation.html` — Analyse IA client
- `carte.html` — Graphique historique 7j/30j/90j/1an
- `admin-ia.html` — Administration IA

Authentification : `admin-login.html` → session `cardoria_admin_connected=yes`

## SEO Enterprise (v5.6)

### Public — `/api/seo/*`
- `GET /sitemap.xml` — Sitemap XML automatique (licences, extensions, cartes, blog)
- `GET /robots.txt` — Robots dynamique
- `GET /blog`, `GET /blog/:slug` — Blog SEO
- `GET /licences/:slug` — Contenu SEO licence
- `GET /extensions?license=` — Extensions indexées
- `GET /tracking` — IDs GA4 / Clarity (sans clés secrètes)

### Admin — `/api/admin/seo/*`
- Blog CRUD, régénération pages licence/extension
- Paramètres GA4, Clarity, Search Console

### Frontend
- `pages/faq/`, `pages/a-propos/`, `pages/contact/`, pages légales
- `pages/licences/{pokemon,yugioh,onepiece,lorcana,magic,dragonball,sports}/`
- `pages/extension/`, `pages/blog/`
- `js/seo.js` — Schema.org (Organization, WebSite, Product, FAQPage, BreadcrumbList, Review, AggregateRating)
- `js/cookie-consent.js` — RGPD
- `js/analytics.js` — GA4 + Microsoft Clarity (après consentement)
- `scripts/generate-sitemap.mjs` — Export sitemap.xml statique
- `admin-seo.html` — Administration SEO

### Variables
- `SITE_URL`, `GA4_MEASUREMENT_ID`, `CLARITY_PROJECT_ID`
- `google-search-console.txt` à la racine pour vérification GSC
