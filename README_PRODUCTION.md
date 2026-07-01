# Cardoria V1.0 — Guide de mise en production

Guide opérationnel pour déployer Cardoria en production publique.

---

## Architecture

```
[Vercel] Frontend statique (HTML/JS/CSS)
    ↓ HTTPS API
[Render] Backend Node.js Express
    ↓
[Disk Render] backend/data/ — SQLite + JSON + backups
```

**Paiements :** SumUp uniquement (boutique + marketplace)  
**IA :** OpenAI API  
**Email :** SMTP (notifications, alertes)

---

## 1. Prérequis

- Compte [Render](https://render.com) (backend)
- Compte [Vercel](https://vercel.com) (frontend)
- Compte SumUp (API Key + Merchant Code)
- Compte OpenAI (API Key)
- SMTP (Gmail, SendGrid, OVH…)
- Domaine `cardoria.fr` (optionnel staging Vercel)

---

## 2. Déploiement Render (backend)

| Paramètre | Valeur |
|-----------|--------|
| Root Directory | `backend` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Disk | 1 Go → `/opt/render/project/src/backend/data` |

Variables : voir `backend/.env.example` et section ci-dessous.

Webhook SumUp : `https://VOTRE-BACKEND.onrender.com/api/marketplace/webhooks/sumup`

Health : `GET /api/health/`

---

## 3. Déploiement Vercel (frontend)

1. Importer le repo — Framework **Other**
2. Configurer `CARDORIA_SEO.backendUrl` dans `js/seo-config.js`
3. Vérifier `vercel.json` (headers cache + sécurité)

---

## 4. Variables essentielles

```env
NODE_ENV=production
APP_VERSION=1.0.0
ADMIN_CODE=<secret>
OPENAI_API_KEY=sk-...
SUMUP_API_KEY=...
SUMUP_MERCHANT_CODE=...
SMTP_HOST=...
SITE_URL=https://cardoria.fr
BACKUP_INTERVAL_HOURS=24
BACKUP_MAX_KEEP=14
ALERT_EMAIL=true
GA4_MEASUREMENT_ID=G-...
```

---

## 5. Scripts pré-production

```bash
node scripts/audit-launch.mjs
node scripts/generate-launch-sitemap.mjs
node scripts/build-production.mjs
```

---

## 6. Admin production

| Page | Rôle |
|------|------|
| `admin-system.html` | Santé, backups, logs, maintenance |
| `admin-sante.html` | Monitoring détaillé |
| `admin-marketplace.html` | Marketplace ops |

---

## 7. Checklist go-live

- [ ] Env Render complet
- [ ] SumUp webhook testé
- [ ] SMTP testé
- [ ] Backup + rotation OK
- [ ] Audit ≥ 70
- [ ] Search Console sitemaps
- [ ] GA4 Realtime

Documentation : `docs/LAUNCH_VALIDATION_REPORT.md`
