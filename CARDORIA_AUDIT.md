# Cardoria — Tableau d’audit global

Dernière mise à jour : 15/09/2026

Règles de statut :
- 🟢 TERMINÉ = validé avec preuve.
- 🟡 À VALIDER = présent mais pas encore prouvé en conditions réelles.
- 🟠 PROBLÈME = défaut ou validation importante encore manquante.
- 🔴 BLOQUANT = point critique empêchant de considérer la zone comme sécurisée/terminée.

| Module | État | Détail |
|---|---|---|
| GitHub / `main` | 🟠 PROBLÈME | branche active mais protection/ruleset GitHub non configuré |
| Déploiement OVH | 🟢 TERMINÉ | dernier déploiement OVH contrôlé avec succès |
| CI générale | 🟢 TERMINÉ | contrôles principaux validés |
| Protection `main` | 🔴 BLOQUANT | aucun ruleset GitHub actif ; réglage d’administration requis |
| Accueil / navigation | 🟡 À VALIDER | recette navigateur production complète à faire |
| Boutique | 🟡 À VALIDER | parcours achat réel à tester |
| Connexion client | 🟠 PROBLÈME | connexion/réinitialisation réelle non encore prouvée |
| Compte client | 🟡 À VALIDER | espace présent, recette réelle à terminer |
| Commandes | 🟡 À VALIDER | parcours complet à tester |
| Marketplace | 🟡 À VALIDER | parcours réel complet à revalider |
| Vendeur | 🟡 À VALIDER | authentification et espace vendeur à tester |
| Live public | 🟠 PROBLÈME | recette spectateur complète non prouvée |
| Live Admin | 🟠 PROBLÈME | tests manuels réels encore manquants |
| Live vendeur | 🟠 PROBLÈME | test complet réel manquant |
| Caméra 1 | 🟠 PROBLÈME | test physique final à faire |
| Caméra 2 PC | 🟠 PROBLÈME | correctifs intégrés, test réel final manquant |
| Caméra téléphone | 🟠 PROBLÈME | appairage réel à tester |
| WebRTC | 🟡 À VALIDER | structure présente, recette complète à confirmer |
| SumUp Boutique | 🟠 PROBLÈME | transaction réelle non prouvée |
| SumUp Live Admin | 🟠 PROBLÈME | transaction réelle non prouvée |
| PayPal Marketplace | 🟡 À VALIDER | sandbox validé, production réelle à confirmer |
| PayPal Live vendeur | 🟡 À VALIDER | sandbox validé, production réelle à confirmer |
| Routage paiements | 🟢 TERMINÉ | Boutique/Live Admin = SumUp ; vendeur/Marketplace = PayPal |
| Revolut | 🟢 TERMINÉ | retiré du routage actif |
| Admin | 🟡 À VALIDER | architecture présente, fonctions métier à tester |
| Utilisateurs Admin | 🟡 À VALIDER | sécurité structurelle présente |
| Achats | 🟡 À VALIDER | module présent |
| Comptabilité | 🟡 À VALIDER | fonctions métier à valider |
| Catalogue Admin | 🟡 À VALIDER | module présent |
| Stock | 🟡 À VALIDER | validation stock réel nécessaire |
| Sécurité | 🟠 PROBLÈME | protection `main` absente |
| Sauvegardes | 🟡 À VALIDER | restauration réelle non testée |
| Responsive/mobile | 🟠 PROBLÈME | tests téléphone/tablette réels manquants |
| SEO | 🟠 PROBLÈME | PR #132 encore ouverte |
| Dépôt / propreté Git | 🟡 À VALIDER | PR obsolètes #40/#41/#42/#43 fermées ; #132 et #141 restent ouvertes volontairement |

## Règles GitHub Cardoria

- La production est `main` sur OVH.
- Toute évolution doit passer par une branche dédiée et une PR.
- Ne jamais annoncer un module « TERMINÉ » sans preuve réelle.
- Les CI doivent être vertes avant merge.
- Un merge GitHub ne vaut pas preuve de déploiement OVH.
- Les anciennes cibles Render, Vercel et Oracle ne doivent pas être réintroduites comme production.

## Réglages GitHub encore requis

1. Activer un ruleset/protection sur `main` avec PR obligatoire et checks obligatoires.
2. Remplacer le champ Homepage du dépôt encore configuré sur l’ancien Vercel par `https://www.cardoriashop.fr`.

Ces deux éléments sont des réglages d’administration du dépôt et ne peuvent pas être modifiés par la connexion GitHub actuelle.
