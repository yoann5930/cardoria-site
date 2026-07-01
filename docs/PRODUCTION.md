# Checklist mise en production Cardoria V5

## Sécurité

- [ ] Définir `ADMIN_INITIAL_PASSWORD` fort et `ADMIN_CODE` unique (ou `LEGACY_ADMIN_CODE=false`)
- [ ] Configurer `CORS_ORIGINS` avec les domaines réels (`cardoria.fr`)
- [ ] Activer `SUMUP_WEBHOOK_SECRET` sur Render
- [ ] Vérifier `NODE_ENV=production`
- [ ] Limiter `BODY_LIMIT` (15 Mo par défaut)
- [ ] Activer `ALERT_EMAIL=true` + SMTP configuré
- [ ] Optionnel : activer `CSRF_ENABLED=true` + token côté admin
- [ ] Révoquer l'accès public aux routes marketplace sensibles (phase 2)

## Authentification

- [ ] Créer compte super_admin via `ADMIN_EMAIL` + `ADMIN_INITIAL_PASSWORD`
- [ ] Tester login `/api/auth/login` (email + mot de passe)
- [ ] Configurer 2FA optionnelle : `POST /api/auth/2fa/setup` puis `/2fa/enable`
- [ ] Tester reset password : `/api/auth/password/request`
- [ ] Vérifier rôles : super_admin, admin, employee, client

## Sauvegardes

- [ ] Monter un disque persistant Render sur `backend/data`
- [ ] Vérifier sauvegarde auto (`BACKUP_INTERVAL_HOURS=24`)
- [ ] Tester sauvegarde manuelle : Admin → Santé → Sauvegarde complète
- [ ] Planifier export off-site des dossiers `data/backups/`

## Surveillance

- [ ] Vérifier `GET /api/health` (public, statut healthy)
- [ ] Consulter Admin → Santé & fiabilité
- [ ] Surveiller `data/error-log.json` ou logs Render
- [ ] Configurer alertes e-mail critiques (`ALERT_EMAIL`)

## Performances

- [ ] Cache actif sur licences catalogue (120 s)
- [ ] Images : lazy-loading déjà sur pages SEO (`loading="lazy"`)
- [ ] Tester temps réponse `/api/health` et `/api/engine/cards/search`

## RGPD

- [ ] Bannière cookies fonctionnelle (`js/cookie-consent.js`)
- [ ] Consentements enregistrés via `POST /api/gdpr/consent`
- [ ] Export données : `POST /api/gdpr/export`
- [ ] Suppression : `POST /api/gdpr/delete` (confirm: `SUPPRIMER`)
- [ ] Politique à jour : `/pages/confidentialite/`

## Déploiement

- [ ] Frontend Vercel → `cardoria.fr`
- [ ] Backend Render → URL API dans `js/seo-config.js` / `CARDORIA_BACKEND`
- [ ] Variables Render selon `docs/DEPLOYMENT.md`
- [ ] SSL actif (HSTS automatique si `NODE_ENV=production`)
- [ ] Test bout en bout : estimation, paiement SumUp, admin

## Éléments à configurer manuellement

1. **Domaine DNS** cardoria.fr → Vercel
2. **Render disk** pour persistance SQLite
3. **PostgreSQL** (Supabase/Neon) quand migration planifiée
4. **SMTP** (Gmail app password ou SendGrid)
5. **SumUp** clés production + webhook URL
6. **OpenAI** clé + budget
7. **Google Analytics / Clarity** IDs dans Render env
8. **Sauvegardes off-site** (S3, Drive) — non automatisées dans le code
9. **WAF / Cloudflare** optionnel devant Vercel
10. **Désactivation legacy ADMIN_CODE** après migration auth sessions
