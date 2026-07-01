# Cardoria Big Data Engine

## Objectif

Devenir la **base de données de référence mondiale** des cartes à collectionner. Chaque estimation alimente automatiquement le Data Engine via **sync lecture seule** des tables existantes (`ai_analyses`, `ai_enterprise_history`, `scanner_scans`) — **aucun module validé modifié**.

---

## Module `backend/lib/bigdata/`

| Fichier | Rôle |
|---------|------|
| `index.js` | `initBigData()`, exports |
| `migrate.js` | Schéma SQL + index scale |
| `ingest.js` | Data Engine — sync estimations |
| `regions.js` | Pays → HeatMap (FR, BE, CH, CA, US, JP, EU, Monde) |
| `indices.js` | Popularité, vitesse vente, rareté réelle, 6 indices |
| `evolution.js` | Évolution mondiale des prix |
| `trends.js` | Moteur tendances (explosion, chute, licences…) |
| `heatmap.js` | HeatMap mondiale |
| `aiStats.js` | Stats IA (erreur, contrefaçon, PSA, tops) |
| `cache.js` | Cache ultra-rapide TTL |
| `analytics.js` | Payloads admin / SEO / IA / Marketplace |
| `worker.js` | Worker arrière-plan (sync + agrégats) |

---

## Données enregistrées (`bigdata_records`)

licence, extension, numéro, langue, état, authenticité, prix estimé, prix marché, prix achat/revente conseillés, date, pays, rareté, score IA, score contrefaçon, gradée/PSA.

---

## Indices calculés (`bigdata_card_metrics`)

| Indice | Description |
|--------|-------------|
| Popularité | Volume estimations + vues |
| Vitesse de vente | Délai moyen (jours) |
| Rareté réelle | Fréquence licence + rareté catalogue |
| Demande | Tendance + volume |
| Vendeur | Favorable vendeur |
| Acheteur | Favorable acheteur |
| Spéculation | Volatilité / hype |
| Collection | Rareté + popularité long terme |
| Investissement | Composite investissement |

---

## Tables SQL

```
bigdata_records
bigdata_card_metrics
bigdata_price_evolution
bigdata_trends
bigdata_heatmap
bigdata_ai_stats
bigdata_cache
bigdata_sync_state
```

---

## API Analytics `/api/bigdata`

| Route | Usage |
|-------|--------|
| `GET /overview` | Vue globale (cache) |
| `GET /indices` | Indices mondiaux |
| `GET /evolution?region=france` | Courbe prix par région |
| `GET /heatmap` | HeatMap 8 zones |
| `GET /trends` | Signaux tendances |
| `GET /ai-stats` | Statistiques IA |
| `GET /card/:cardId` | Analytics carte |
| `GET /card/:cardId/metrics` | Indices carte |
| `GET /feeds/seo` | Feed SEO |
| `GET /feeds/marketplace` | Feed Marketplace |
| `GET /feeds/ia` | Feed moteur IA |
| `POST /ingest` | Ingestion manuelle / partenaire |

### Admin `/api/admin/bigdata`

| Route | Description |
|-------|-------------|
| `GET /dashboard?refresh=1` | Dashboard complet |
| `GET /heatmap` | HeatMap |
| `GET /trends` | Tendances |
| `GET /ai-stats` | Stats IA live |
| `POST /sync` | Sync sources |
| `POST /worker/run` | Worker manuel |
| `POST /recompute/all` | Recalcul total |

---

## Cache

Table `bigdata_cache` — TTL configurable (défaut 1 h). Clés `analytics:*` invalidées après chaque worker.

Variable : `BIGDATA_WORKER_MS=1500000` (25 min).

---

## Architecture scale & PostgreSQL

- Index SQL sur `card_id`, `license`, `region`, `recorded_at`
- Pagination API (limit max 50–500 selon route)
- Worker par lots — pas de scan full table en requête user
- Schéma `ON CONFLICT` compatible PostgreSQL
- Migration : exporter tables `bigdata_*` + brancher `DATABASE_URL`

---

## Fichiers créés

**Backend :** `backend/lib/bigdata/*` (12 fichiers) · `backend/routes/bigdata-analytics.js` · `backend/routes/bigdata-admin.js`

**Frontend :** `admin-bigdata.html` · `js/admin/admin-bigdata.js`

**Docs :** `docs/BIGDATA.md`

---

## Fichiers modifiés (câblage uniquement)

`backend/server.js` · `js/admin/admin-core.js` · `script.js` · `backend/.env.example` · `docs/DEPLOYMENT.md`

---

## Déploiement Render

1. **Pousser** le repo — Root Directory : `backend`
2. **Build** : `npm install` — **Start** : `npm start`
3. **Disk persistant** : `backend/data/` (SQLite + cache Big Data)
4. **Variables** :
   ```env
   BIGDATA_WORKER_MS=1500000
   ```
5. **Boot** : `initBigData()` migre les tables et lance le worker (sync auto toutes les 25 min)
6. **Premier run** : Admin → Big Data Engine → « Sync + refresh » ou `POST /api/admin/bigdata/worker/run`
7. **Vercel** : admin `admin-bigdata.html` — consomme `/api/admin/bigdata/*` via `CARDORIA_SEO.backendUrl`
8. **PostgreSQL (future)** : même DDL, pas de refonte modules

---

## Exploitation cross-modules (sans les modifier)

| Consommateur | Endpoint |
|--------------|----------|
| Admin | `/api/admin/bigdata/dashboard` |
| Graphiques | `/api/bigdata/evolution`, `/heatmap` |
| SEO | `/api/bigdata/feeds/seo` |
| IA | `/api/bigdata/feeds/ia` |
| Marketplace | `/api/bigdata/feeds/marketplace` |
