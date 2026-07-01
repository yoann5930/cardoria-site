# Cardoria V5 — Configuration production

## Variables d'environnement (Render backend)

```env
NODE_ENV=production
PORT=10000
APP_VERSION=5.8.0

# Sécurité
ADMIN_CODE=                    # Legacy — désactiver avec LEGACY_ADMIN_CODE=false après migration auth
LEGACY_ADMIN_CODE=true         # false en prod une fois sessions activées
ADMIN_EMAIL=Cardoria59330@gmail.com
ADMIN_INITIAL_PASSWORD=        # Crée le super_admin au 1er démarrage
SESSION_HOURS=12
CSRF_ENABLED=false             # true si frontend envoie x-csrf-token
CORS_ORIGINS=https://cardoria.fr,https://www.cardoria.fr,https://cardoria.vercel.app
BODY_LIMIT=15mb
RATE_LIMIT_API=120
RATE_LIMIT_AUTH=10
RATE_LIMIT_AI=8
BRUTE_FORCE_MAX=5
ALERT_EMAIL=true

# Base de données
DATABASE_URL=                  # PostgreSQL (migration future) — SQLite actif si vide

# OpenAI, SMTP, SumUp — voir .env.example
SUMUP_WEBHOOK_SECRET=          # OBLIGATOIRE en production

# Sauvegardes
BACKUP_INTERVAL_HOURS=24

# Site
SITE_URL=https://cardoria.fr
```

## Vercel (frontend)

- Root : racine du repo
- Build : aucun (statique)
- Domaine : `cardoria.fr` + redirect www

## Render (backend)

- Root Directory : `backend`
- Build : `npm install`
- Start : `npm start`
- Disk persistant recommandé pour `data/` (SQLite, images IA, sauvegardes)

## IA Enterprise (Étape 15)

- Module : `backend/lib/ai-enterprise/`
- Worker : `AI_ENTERPRISE_WORKER_MS=900000` (15 min par défaut)
- Admin : `admin-ai-enterprise.html`
- Documentation complète : [AI_ENTERPRISE.md](./AI_ENTERPRISE.md)

## Ultimate Enterprise (Étape 16)

- Module : `backend/lib/ultimate/`
- Worker : `ULTIMATE_WORKER_MS=1200000`
- Client : `recherche-ia.html`, `fiche-ultimate.html?id=`
- Admin : `admin-ultimate.html`
- Documentation : [ULTIMATE_ENTERPRISE.md](./ULTIMATE_ENTERPRISE.md)

## Big Data Engine

- Module : `backend/lib/bigdata/`
- Worker : `BIGDATA_WORKER_MS=1500000`
- API : `/api/bigdata/*` · Admin : `/api/admin/bigdata/*`
- Page admin : `admin-bigdata.html`
- Documentation : [BIGDATA.md](./BIGDATA.md)

## Marketplace v1.0 (Étape 18)

- Module : `backend/lib/marketplace/v1/`
- Pages : `panier-marketplace.html`, `marketplace-paiement-succes.html`, `mes-annonces.html`, `espace-vendeur.html`
- Documentation : [MARKETPLACE_V1.md](./MARKETPLACE_V1.md)

## PostgreSQL

`DATABASE_URL` préparé. Migration SQLite → PG : exporter `cardoria-engine.db` puis adapter `lib/engine/database.js` (couche déjà documentée pour PG). Tables `ai_enterprise_*` utilisent la même syntaxe compatible PG.
