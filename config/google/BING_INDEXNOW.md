# Microsoft Bing Webmaster Tools

1. [Bing Webmaster](https://www.bing.com/webmasters) → Ajouter le site
2. Validation : fichier XML ou meta tag
3. Placer `BingSiteAuth.xml` à la racine (template ci-dessous)
4. Soumettre `sitemap-index.xml`

## Fichier BingSiteAuth.xml (template)

Remplacer `YOUR_CODE` par le code Bing :

```xml
<?xml version="1.0"?>
<users>
  <user>YOUR_CODE</user>
</users>
```

## IndexNow

1. Générer une clé : `openssl rand -hex 32`
2. Placer la clé dans `indexnow-key.txt` à la racine
3. Endpoint : `https://api.indexnow.org/indexnow`
4. Soumettre les URLs modifiées après chaque déploiement

```bash
curl "https://api.indexnow.org/indexnow?url=https://cardoria.fr/&key=VOTRE_CLE&keyLocation=https://cardoria.fr/indexnow-key.txt"
```
