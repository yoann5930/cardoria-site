# Migration du domaine vers cardiashop.fr

Date de préparation : 18 novembre 2026.
Domaine historique : https://www.cardoriashop.fr
Domaine cible : https://www.cardiashop.fr
Hébergement : VPS OVH. Branche de production : main.

## Barrière avant bascule

Ne pas remplacer globalement cardoriashop.fr par cardiashop.fr dans la production avant :
- confirmation dans le compte OVH de l'achat et de l'activation de cardiashop.fr ;
- vérification de la zone DNS et de l'adresse IPv4 réelle du VPS (ne pas inventer d'IP) ;
- configuration des entrées A/AAAA et www, sans toucher aux MX/TXT existants ;
- prise en charge des deux domaines dans la configuration Nginx du VPS ;
- émission et vérification d'un certificat HTTPS valide couvrant cardiashop.fr et www.cardiashop.fr ;
- essai des pages, de /api/health/ et des appels API sous le nouveau nom ;
- mise à jour coordonnée des URL de retour et webhook SumUp/PayPal et des paramètres de sécurité CORS/CSRF ;
- tests de connexion, de réinitialisation de mot de passe, de commande et paiement (sans débiter un client réel non autorisé), de livraison, marketplace et live ;
- sauvegarde vérifiée et procédure de retour arrière testée.

## Préparer la bascule du code

Remplacer les URL publiques et canoniques dans :
- backend/.env.example et variables OVH : SITE_URL, FRONTEND_URL, PUBLIC_SITE_URL, MARKETPLACE_SUCCESS_URL, MARKETPLACE_CANCEL_URL, MARKETPLACE_FRONTEND_URL, BOUTIQUE_SUCCESS_URL et CORS_ORIGINS ;
- backend/server.js : absoluteSiteUrl(), SERVED_SITE_HOSTS et constructions de liens ;
- js/seo-config.js, backend/lib/seo/*, scripts/generate*sitemap*, sitemap*.xml et robots.txt ;
- les fichiers HTML publics, leurs métadonnées Open Graph, JSON-LD et canonicals ;
- modèles de courriels, liens de réinitialisation, lien expéditeur et pages contractuelles ;
- réglages des fournisseurs de paiement et des retours de transporteurs lorsque requis ;
- configuration du serveur web, certificat, vérification Search Console, sitemaps ;
- règles CI qui testent explicitement le domaine ancien.

Conserver les chemins de code, identifiants de stockage, variables historiques et noms de fichiers internes cardoria pour éviter les régressions non nécessaires.

## Ordre d'activation

1. Configurer le DNS OVH et les deux domaines sur Nginx ; obtenir HTTPS.
2. Vérifier la nouvelle adresse sans désactiver l'ancienne.
3. Fusionner et déployer les changements de code vérifiés via pipeline OVH avec sauvegarde préalable.
4. Vérifier connexions, API, paiements, emails, expéditions, marketplace et live sur la nouvelle adresse.
5. Après succès, activer les redirections permanentes 301 de chaque ancien chemin vers le même chemin et la même query sur www.cardiashop.fr.
6. Conserver cardoriashop.fr et son certificat pendant la période de transition ; contrôler Search Console, indexation et logs.
7. En cas de problème, remettre temporairement l'ancienne URL canonique et désactiver les redirections, sans changer les données de paiement.

## État

Préparation uniquement. Aucun changement DNS, paiement, HTTPS ou déploiement OVH réalisé par ce document.
