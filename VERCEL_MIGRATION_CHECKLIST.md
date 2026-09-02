# Cardoria — migration Vercel (branche de validation)

Cette branche ne change aucune regle metier Cardoria.

Objectif: valider Vercel avant toute bascule de production.

## Invariants obligatoires
- Boutique Cardoria -> Revolut direct
- Marketplace -> PayPal Multi
- Live vendeur -> PayPal Multi
- Live Cardoria -> Revolut direct
- Stock Boutique conserve comme source unique actuelle
- Aucun changement design/metier pendant le transfert
- Aucun secret stocke dans Git
- Aucun changement DNS avant validation complete

## Validation avant bascule
- Build et syntaxe
- Auth admin
- Dashboard admin
- Stock admin
- Boutique et panier
- Checkout Revolut
- Marketplace et PayPal Multi
- Webhooks
- Catalogue / SEO
- Persistance PostgreSQL
- Logs sans erreur bloquante
