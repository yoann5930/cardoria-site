# Google Tag Manager — Cardoria V1.0

## Installation

1. Créer un conteneur GTM sur [tagmanager.google.com](https://tagmanager.google.com/)
2. Copier l'ID conteneur (`GTM-XXXXXXX`)
3. Ajouter dans le `<head>` des pages publiques (via snippet déploiement Vercel ou inclusion manuelle) :

```html
<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-XXXXXXX');</script>
<!-- End Google Tag Manager -->
```

4. Balise noscript après `<body>` :

```html
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
```

## Tags recommandés

- GA4 Configuration
- Conversion SumUp (événement personnalisé)
- Microsoft Clarity (alternative à tag direct)

## Fichier conteneur export

Exporter le conteneur JSON depuis GTM → sauvegarder dans `config/google/gtm-container-export.json`
