# Google Search Console — Cardoria V1.0

## Étapes

1. [Search Console](https://search.google.com/search-console) → Ajouter une propriété
2. Choisir **Préfixe d'URL** : `https://cardoria.fr` (ou domaine Vercel staging)
3. Méthode de validation recommandée : **Fichier HTML**
   - Télécharger le fichier Google → placer à la racine : `googleXXXXXXXX.html`
   - Ou utiliser `google-search-console.txt` existant à la racine
4. Soumettre les sitemaps :
   - `https://cardoria.fr/sitemap-index.xml`
   - `https://cardoria-backend.onrender.com/api/seo/sitemap.xml`
   - `https://cardoria-backend.onrender.com/api/marketplace/v1/sitemap.xml`

## Variable backend

```env
GSC_VERIFIED=true
```

## Indexation

- Demander indexation des pages clés : accueil, estimation, marketplace, licences
- Surveiller Core Web Vitals dans GSC
