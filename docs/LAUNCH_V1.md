# Cardoria — Étape 19 Launch V1.0

Module **launch** ajouté sans modification des modules métier existants.

## Nouveau

- `backend/lib/launch/` — journaux, maintenance, alertes, rotation backups
- `backend/routes/system.js` — API `/api/system/*`
- `admin-system.html` — tableau de bord production
- Scripts : `audit-launch.mjs`, `build-production.mjs`, `generate-launch-sitemap.mjs`
- Docs : `CHANGELOG.md`, `VERSION.md`, `ROADMAP.md`, `README_PRODUCTION.md`
- Rapport complet : [LAUNCH_VALIDATION_REPORT.md](./LAUNCH_VALIDATION_REPORT.md)

## Usage rapide

```bash
node scripts/audit-launch.mjs
node scripts/generate-launch-sitemap.mjs
```

Admin : `admin-system.html` → menu **Système V1.0**
