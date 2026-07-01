# Cardoria V5 — Étape 16 : Ultimate Enterprise

## Vue d'ensemble

Module autonome `backend/lib/ultimate/` — comparateur multi-sources, conseiller investissement, détection cartes exceptionnelles, historique étendu, recherche NL, dashboard admin premium. **Aucun module validé modifié** (SEO, Marketplace, Scanner core, sécurité, SumUp) — uniquement câblage `server.js`, nav admin, pages nouvelles.

---

## Fichiers créés

### Backend `backend/lib/ultimate/`

| Fichier | Rôle |
|---------|------|
| `index.js` | `initUltimate()`, exports |
| `migrate.js` | Schéma SQL + métadonnées scale |
| `comparator.js` | Cardmarket, Ebay, PriceCharting, TCGPlayer, PSA, moyenne mondiale, **Global Index** |
| `advisor.js` | Conseiller investissement + confiance 0–100 |
| `exceptional.js` | Détection variantes / erreurs / raretés + alertes |
| `history.js` | Courbes 7j → max (cache) |
| `search.js` | Recherche langage naturel |
| `dashboard.js` | Dashboard admin premium (cache) |
| `client.js` | Payload client sanitizé |
| `worker.js` | Recalcul arrière-plan |

### Routes

| Fichier | Préfixe |
|---------|---------|
| `backend/routes/ultimate.js` | `/api/ultimate` |
| `backend/routes/ultimate-admin.js` | `/api/admin/ultimate` |

### Frontend

| Fichier | Rôle |
|---------|------|
| `admin-ultimate.html` | Dashboard admin |
| `js/admin/admin-ultimate.js` | KPIs + graphiques |
| `recherche-ia.html` | Recherche NL publique |
| `js/recherche-ia.js` | Client recherche |
| `fiche-ultimate.html` | Fiche carte Ultimate |
| `js/fiche-ultimate.js` | Comparateur + conseil + historique |
| `css/ultimate.css` | Styles Ultimate |

---

## Fichiers modifiés (câblage minimal)

| Fichier | Modification |
|---------|--------------|
| `backend/server.js` | `initUltimate()`, routes |
| `js/admin/admin-core.js` | Entrée nav |
| `script.js` | Protection `admin-ultimate.html` |
| `backend/.env.example` | `ULTIMATE_WORKER_MS` |
| `docs/DEPLOYMENT.md` | Lien doc Ultimate |

---

## Tables SQL

```sql
ultimate_price_cache           -- Comparateur + Global Index
ultimate_investment_advice     -- Conseils investissement
ultimate_exceptional_alerts    -- Alertes cartes exceptionnelles
ultimate_history_cache         -- Courbes par période
ultimate_search_log            -- Logs recherche NL
ultimate_dashboard_cache       -- Cache dashboard admin
ultimate_scale_meta            -- Cibles scale (1M cartes, etc.)
```

Index additionnels pour pagination et requêtes à volume.

---

## API

### Public `/api/ultimate`

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/card/:cardId` | Vue Ultimate complète (client) |
| GET | `/card/:cardId/prices` | Comparateur + Global Index |
| GET | `/card/:cardId/advice` | Conseiller investissement |
| GET | `/card/:cardId/history?period=30` | Courbe (`all=1` pour toutes périodes) |
| GET | `/search?q=` | Recherche langage naturel |
| POST | `/detect-exceptional` | Détection variantes (preview) |
| POST | `/preview` | Preview payload client |

Périodes historique : `7`, `30`, `90`, `180`, `365`, `1095`, `1825`, `max`.

### Admin `/api/admin/ultimate`

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/dashboard?refresh=1` | KPIs + graphiques |
| GET | `/searches/top` | Top recherches NL |
| GET | `/exceptional` | Alertes récentes |
| POST | `/exceptional/scan` | Scan manuel |
| POST | `/worker/run` | Worker manuel |

---

## Architecture scale (1M cartes / 100K users / 1M estimations)

- **SQLite** : FTS5 `cards_fts`, index sur tables Ultimate, pagination stricte (max 50/résultat)
- **Cache** : tables `*_cache` + TTL worker
- **Worker** : traitement par lots (top 150 cartes vues / cycle)
- **PostgreSQL** : schéma compatible `ON CONFLICT`, migration via `DATABASE_URL` sans refonte modules
- **Métadonnées** : `ultimate_scale_meta` documente les cibles

Variable : `ULTIMATE_WORKER_MS=1200000` (20 min défaut).

---

## Plan de migration

1. Déployer backend — `initUltimate()` crée les tables au boot
2. Lancer worker admin ou attendre le cycle auto
3. Les prix externes utilisent `price_sources` si présents ; sinon estimation Cardoria (brancher flux API Cardmarket/eBay plus tard sans changer le module)
4. Migration PG : exporter SQLite → importer avec mêmes DDL Ultimate

---

## Déploiement Render + Vercel

### Render

- Root `backend`, `npm install`, `npm start`
- Disk persistant `data/`
- Env : `ULTIMATE_WORKER_MS` (optionnel)

### Vercel

- Pages statiques : `recherche-ia.html`, `fiche-ultimate.html?id=`
- Admin : `admin-ultimate.html`
- `CARDORIA_SEO.backendUrl` → backend Render

---

## Pages client

| URL | Contenu |
|-----|---------|
| `/recherche-ia.html` | Recherche NL |
| `/fiche-ultimate.html?id={cardId}` | Comparateur, conseil, alertes, historique, prévisions |
| `/admin-ultimate.html` | Dashboard premium admin |
