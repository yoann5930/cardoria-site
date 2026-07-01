# Google Analytics 4 — Cardoria V1.0

## Configuration

1. Créer une propriété GA4 sur [Google Analytics](https://analytics.google.com/)
2. Copier le **Measurement ID** (format `G-XXXXXXXXXX`)
3. Définir dans Render :
   ```env
   GA4_MEASUREMENT_ID=G-XXXXXXXXXX
   ```
4. Le snippet est injecté par `js/seo.js` après consentement cookies (module existant — ne pas modifier)

## Fichier de référence

- Variable frontend : `CARDORIA_SEO.ga4Id` dans `js/seo-config.js` (à renseigner en déploiement)

## Événements recommandés

| Événement | Déclencheur |
|-----------|-------------|
| `estimation_submit` | Formulaire estimation |
| `marketplace_checkout` | Checkout SumUp |
| `purchase` | Paiement confirmé webhook |

## Vérification

- GA4 DebugView en staging
- Realtime après déploiement production
