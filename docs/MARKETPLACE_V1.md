# Cardoria Marketplace v1.0 — Déploiement

## Module extension `backend/lib/marketplace/v1/`

Finalisation marketplace : panier, annonces étendues, commandes, expédition, factures TVA, vendeurs, litiges, notifications email, SEO annonce, admin complet.

**SumUp uniquement** — aucun Stripe ajouté.

---

## Fichiers créés

### Backend
- `backend/lib/marketplace/v1/migrate.js`
- `backend/lib/marketplace/v1/listings.js`
- `backend/lib/marketplace/v1/cart.js`
- `backend/lib/marketplace/v1/security.js`
- `backend/lib/marketplace/v1/notifications.js`
- `backend/lib/marketplace/v1/invoices.js`
- `backend/lib/marketplace/v1/disputes.js`
- `backend/lib/marketplace/v1/slug.js`
- `backend/lib/marketplace/v1/index.js`
- `backend/routes/marketplace-v1.js`

### Frontend
- `panier-marketplace.html` + `js/marketplace-cart-page.js`
- `marketplace-paiement-succes.html` / `marketplace-paiement-echec.html`
- `mes-annonces.html` + `js/marketplace-my-listings.js`
- `espace-vendeur.html` + `js/marketplace-seller-dashboard.js`

### Docs
- `docs/MARKETPLACE_V1.md` (ce fichier)

---

## Fichiers modifiés (marketplace + câblage)

- `backend/lib/marketplace/index.js` — init v1 + hooks notifications
- `backend/lib/marketplace/orders.js` — hook notifications statuts
- `backend/routes/marketplace-admin.js` — admin étendu (litiges, remboursements, exports)
- `backend/server.js` — routes v1 montées sur `/api/marketplace`
- `backend/.env.example` — URLs paiement, TVA, frontend
- `js/marketplace-listing.js` — slug SEO, panier, Schema.org Product/Offer
- `js/marketplace-sell.js` — API v1, champs étendus, photos multiples
- `js/marketplace-orders.js` — commandes sécurisées v1 + factures
- `js/admin/admin-marketplace.js` — dashboard admin complet
- `docs/DEPLOYMENT.md` — section Marketplace v1
- `robots.txt` — sitemap annonces marketplace

**Non modifiés (contrainte projet) :** Header, Hero, SEO global (`backend/lib/seo/`), module SumUp core, modules IA validés.

---

## Tables SQL ajoutées / colonnes

**Nouvelles tables :**
- `mk_cart_items` — panier persistant (userId, listingId, qty)
- `mk_invoices` — factures (numéro, TVA, snapshot HTML)
- `mk_disputes` — litiges client

**Colonnes ajoutées :**
- `mk_listings` : `extension`, `card_number`, `language`, `slug`, `seo_title`, `seo_description`
- `mk_orders` : `items_json`, `invoice_number`, `vat_rate`, `vat_amount`, `dispute_status`

Architecture SQLite compatible PostgreSQL (requêtes paramétrées, pas de SQL dialect-specific).

---

## API v1 (`/api/marketplace/v1/...`)

| Route | Description |
|-------|-------------|
| POST `/listings` | Création annonce (licence, extension, numéro, état, langue, prix, stock, photos, statut) |
| PUT/DELETE `/listings/:id` | Modification / suppression (vendeur authentifié) |
| GET `/listings/slug/:slug` | Annonce par slug SEO |
| GET `/listings/:id` | Annonce par ID |
| GET `/sellers/:id/listings` | Annonces vendeur (session vendeur) |
| GET `/sellers/:id/orders` | Commandes vendeur |
| PUT `/sellers/:id/orders/:oid/tracking` | Suivi expédition vendeur |
| GET/POST `/cart/*` | Panier (add, qty, remove, clear) |
| POST `/cart/checkout` | Validation commande + redirect SumUp |
| GET `/orders` | Historique client (email + userId) |
| GET `/orders/secure/:id` | Détail commande sécurisé |
| GET `/orders/:id/invoice` | Facture HTML (export PDF via impression navigateur) |
| GET `/sitemap/listings` | Entrées JSON pour sitemap |
| GET `/sitemap.xml` | Sitemap XML annonces actives |
| POST `/disputes` | Litige client |

**Admin :** `/api/admin/marketplace/` — config, stats, annonces, vendeurs, commandes, tracking, remboursement, facture, litiges, export CSV comptable.

**Webhook SumUp :** `POST /api/marketplace/webhooks/sumup`

---

## Statuts

**Annonces :** `draft` (brouillon), `active` (en ligne), `sold` (vendue), `suspended` (suspendue)

**Commandes :** `pending` (en attente paiement), `paid`, `preparing`, `shipped`, `delivered`, `cancelled`, `refunded`

---

## Variables d'environnement

```env
SUMUP_API_KEY=
SUMUP_MERCHANT_CODE=
SUMUP_WEBHOOK_SECRET=
MARKETPLACE_SUCCESS_URL=https://votre-domaine/marketplace-paiement-succes.html
MARKETPLACE_CANCEL_URL=https://votre-domaine/marketplace-paiement-echec.html
MARKETPLACE_VAT_RATE=20
MARKETPLACE_FRONTEND_URL=https://votre-domaine
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
ADMIN_EMAIL=
```

---

## Déploiement Render + Vercel

### Render (backend)
1. Root `backend`, `npm install`, `npm start`
2. Disk persistant `backend/data/`
3. Configurer SumUp + SMTP + URLs succès/échec
4. Webhook SumUp : `https://votre-backend.onrender.com/api/marketplace/webhooks/sumup`

### Vercel (frontend)
1. Déployer pages : `panier-marketplace.html`, `marketplace-paiement-*.html`, `mes-annonces.html`, `espace-vendeur.html`, `annonce.html`
2. `CARDORIA_SEO.backendUrl` ou `CARDORIA_BACKEND` → URL Render

---

## Tests avant production

1. **Vendeur** : créer annonce brouillon puis publier (`vendre.html`, `mes-annonces.html`)
2. **Modification** : éditer prix/stock via PUT v1, vérifier slug SEO inchangé ou régénéré
3. **Panier** : ajouter 2 annonces, modifier quantités, retirer article
4. **Checkout** : validation commande + redirect SumUp sandbox
5. **Webhook / confirm** : paiement test → statut `paid`, stock décrémenté, emails client + admin
6. **Expédition** : saisir suivi admin ou espace vendeur → email expédition
7. **Facture** : ouvrir facture v1, vérifier TVA `MARKETPLACE_VAT_RATE`
8. **Export CSV** : `/api/admin/marketplace/export/accounting.csv`
9. **Sécurité** : PUT listing avec mauvais sellerId → 403 ; commande autre client → 403
10. **SEO** : `annonce.html?slug=...` — title unique, meta description, JSON-LD Product/Offer, og:image
11. **Sitemap** : `GET /api/marketplace/v1/sitemap.xml` contient les annonces actives
12. **Litige** : POST `/api/marketplace/v1/disputes`, visible dans `admin-marketplace.html`
