# Cardoria V5 — Étape 15 : IA Enterprise auto-apprenante

## Vue d'ensemble

Chaque estimation, scan ou vente réelle alimente l'historique `ai_enterprise_history`. Un worker en arrière-plan recalcule fiabilité, prédictions, tendances et dashboard admin (cache 1 h).

Architecture **SQLite aujourd'hui**, schéma compatible **PostgreSQL** (`ON CONFLICT`, types génériques, pas de SQL propriétaire bloquant).

---

## Fichiers créés

### Backend — module `backend/lib/ai-enterprise/`

| Fichier | Rôle |
|---------|------|
| `index.js` | Point d'entrée, `initAiEnterprise()`, exports |
| `migrate.js` | Schéma SQL + `makeEnterpriseHistoryId()` |
| `record.js` | Historique complet par estimation / vente |
| `reliability.js` | Score fiabilité 0–100 (5 composantes) |
| `autoadjust.js` | Ajustement auto mini/moyen/premium/marge/indice |
| `predict.js` | Prédictions 7/30/90/180/365 j + confiance |
| `trends.js` | Cardoria Trend + signaux (explosion, chute, etc.) |
| `dashboard.js` | Tableau admin Premium (tops + évolutions, cache) |
| `client.js` | Vue client sanitizée (aucune donnée interne) |
| `worker.js` | Worker planifié (boot + intervalle configurable) |

### Backend — routes

| Fichier | Rôle |
|---------|------|
| `backend/routes/ai-enterprise.js` | API publique client |
| `backend/routes/ai-enterprise-admin.js` | API admin protégée |

### Frontend

| Fichier | Rôle |
|---------|------|
| `admin-ai-enterprise.html` | Page admin Premium |
| `js/admin/admin-ai-enterprise.js` | Dashboard tops / évolutions / worker |

---

## Fichiers modifiés (câblage minimal)

| Fichier | Modification |
|---------|--------------|
| `backend/server.js` | `initAiEnterprise()`, routes `/api/ai-enterprise` et `/api/admin/ai-enterprise` |
| `backend/lib/ai/analyze.js` | `recordEnterpriseEstimation` + `buildEnterpriseClientView` dans la réponse |
| `backend/lib/scanner/analyze.js` | Idem pour le scanner |
| `backend/lib/market/record.js` | `recordActualSaleOutcomeSync` sur ventes réelles |
| `backend/lib/market/ingest.js` | Feedback admin → vente réelle → auto-apprentissage |
| `backend/lib/ai/learning.js` | (existant) `ingestAdminFeedbackOutcome` déclenche la chaîne |
| `js/ai-client.js` | Panneau client : indice marché, évolution, graphique, prévisions |
| `js/admin/admin-core.js` | Entrée nav « IA Enterprise » |
| `script.js` | Protection page admin |

**Non modifiés** (conformément au cahier des charges) : Hero, SEO, Marketplace, SumUp, sécurité.

---

## Tables SQL créées

```sql
ai_enterprise_history          -- Historique complet (licence, extension, n°, langue, état, prix, engagement…)
ai_enterprise_reliability      -- Scores fiabilité par carte / licence
ai_enterprise_adjustments      -- Journal des ajustements automatiques post-vente
ai_enterprise_predictions      -- Prédictions 7/30/90/180/365 j par carte
ai_enterprise_trend_signals    -- Signaux Cardoria Trend
ai_enterprise_dashboard_cache  -- Cache dashboard admin
```

Colonnes ajoutées à `ai_learning_records` (via migration market existante) : `language`, `market_price`, `views_count`, `favorites_count`, `offers_count`, `purchases_count`.

---

## API

### Client (public)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/ai-enterprise/client/:cardId` | Vue client (estimation, indice, évolution, prévisions) |
| POST | `/api/ai-enterprise/preview` | Preview à partir d'un payload intelligence/pricing |

### Admin (session requise)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/admin/ai-enterprise/dashboard` | Dashboard Premium (`?refresh=1` force recalcul) |
| GET | `/api/admin/ai-enterprise/history` | Historique (`cardId`, `license`, `limit`) |
| GET | `/api/admin/ai-enterprise/reliability/:entityKey` | Score fiabilité carte ou licence |
| GET | `/api/admin/ai-enterprise/predictions/:cardId` | Prédictions détaillées |
| GET | `/api/admin/ai-enterprise/trends` | Cardoria Trend + signaux (`type`, `limit`) |
| POST | `/api/admin/ai-enterprise/worker/run` | Lancer le worker manuellement |
| POST | `/api/admin/ai-enterprise/refresh/reliability` | Recalcul fiabilité |
| POST | `/api/admin/ai-enterprise/refresh/predictions` | Recalcul prédictions |
| POST | `/api/admin/ai-enterprise/refresh/trends` | Recalcul tendances |

---

## Flux fonctionnels

1. **Estimation / scan** → `recordEnterpriseEstimation` → worker planifié
2. **Vente marketplace / admin / feedback** → `recordActualSaleOutcomeSync` → `applyAutoAdjustmentFromSale` (prix mini/moyen/premium, marge, indice marché)
3. **Worker** (défaut 15 min) → fiabilité, prédictions, tendances, dashboard cache

Variable optionnelle : `AI_ENTERPRISE_WORKER_MS=900000` (intervalle worker, ms).

---

## Déploiement Render + Vercel

### Render (backend)

1. Pousser le repo ; Root Directory : `backend`
2. Build : `npm install` — Start : `npm start`
3. Disk persistant sur `data/` (SQLite, scans, backups)
4. Variables : voir `backend/.env.example` + `AI_ENTERPRISE_WORKER_MS` si besoin
5. Redéployer — au boot : `initAiEnterprise()` migre les tables et démarre le worker

### Vercel (frontend)

1. Déploiement statique racine repo (aucun build)
2. `vercel.json` / `CARDORIA_SEO.backendUrl` → URL Render
3. Pages concernées : estimations IA, scanner (`js/ai-client.js`), admin `admin-ai-enterprise.html`
4. Aucune variable secrète côté Vercel pour l'Enterprise (API publique limitée au client view)

### PostgreSQL (future)

1. Définir `DATABASE_URL` + adapter `lib/engine/database.js`
2. Exécuter les mêmes `CREATE TABLE` (syntaxe déjà compatible)
3. Worker et cache inchangés

---

## Accès admin

Menu **IA Enterprise** → `admin-ai-enterprise.html`  
KPIs, tops (licences, extensions, cartes, ventes, recherches, tendances), évolutions (marges, prix, scans, visiteurs, ventes), boutons worker / refresh.
