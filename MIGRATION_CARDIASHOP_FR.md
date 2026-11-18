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

## Diagnostic du 19 novembre 2026

Contrôles effectués depuis le réseau, sans connexion SSH et sans `curl -k`.

- DNS : `cardoriashop.fr` pointe vers `51.89.174.191` (A). `www.cardoriashop.fr` est un CNAME vers cet apex. `cardiashop.fr` et `www.cardiashop.fr` pointent vers `213.186.33.5`, page OVH « Site en construction » en HTTP, port 443 refusé. Le nouveau domaine n'atteint pas le VPS.
- HTTP sur `51.89.174.191` répond Nginx et redirige en 301 vers `https://` du même hôte, y compris pour des noms qui ne sont pas le site. Ce comportement ne prouve pas que le vhost Cardiashop est configuré.
- TLS avec SNI pour `cardoriashop.fr` et `www.cardoriashop.fr` présente un certificat Let's Encrypt `CN=nexinfra.de`, SAN `DNS:*.nexinfra.de, DNS:nexinfra.de`, valide du 10 novembre 2026 au 8 février 2027. Le nom Cardiashop / CardoriaShop n'est pas couvert. C'est la cause de l'erreur curl 60.
- SSH port 22 est ouvert. L'empreinte ED25519 actuellement annoncée par `51.89.174.191` est `SHA256:uy7CZSoVxsarpHF8rcSoa8PzX4rKbKkUODwPxhHLG1o`. L'empreinte précédemment enregistrée dans le known_hosts de la machine de travail, daté du 3 septembre 2026, est `SHA256:6s4J7Tr95vrzAKf8bZRVcmMSePaOENEuGl7VPdTvhg8`. OpenSSH refuse la connexion avec StrictHostKeyChecking. **Ne pas mettre à jour `OVH_VPS_HOST_FINGERPRINT` et ne pas se connecter tant que la console OVH authentifiée n'a pas confirmé que la nouvelle empreinte appartient bien à ce VPS.**
- Les logos servis restent `assets/logo/cardoria-premium.png` et `logo-cardoria.jpg`. Aucun nouveau logo n'a été inventé.
- Tant que la console OVH n'a pas authentifié l'hôte, aucun certificat, aucune sauvegarde et aucun déploiement ne peuvent être réalisés par le pipeline GitHub.

## Diagnostic du 18 novembre 2026

- L'action owner-only OVH Status Issue, déclenchée par l'issue #509, a échoué sur `Host fingerprint mismatch`. **Ne pas désactiver StrictHostKeyChecking et ne pas remplacer le secret par la clé annoncée par un réseau non vérifié.** Comparer l'empreinte ED25519 actuelle depuis une console serveur OVH authentifiée à la valeur du secret GitHub `OVH_VPS_HOST_FINGERPRINT` par un canal sûr. Vérifier aussi `OVH_VPS_HOST` et l'éventuelle réinstallation du VPS.
- Des tests HTTPS sur le domaine historique échouent avec `SSL: no alternative certificate subject name matches target hostname 'www.cardoriashop.fr'` (erreur curl 60). Vérifier en priorité la configuration Nginx effective et le certificat servi avec SNI ; ne pas masquer l'erreur avec `curl -k`.
- Le site nouveau domaine n'est pas encore vérifié ; les pages publiques doivent rester servies depuis l'ancien domaine jusqu'à certificat valide sur les quatre noms.
- Le fichier `oracle/nginx-cardiashop-ssl.conf.example` est un **modèle non activé** pour la migration. Il nécessite **avant utilisation** un certificat unique couvrant les quatre domaines, un test `nginx -t`, une sauvegarde de la configuration effective et un rollback possible.
- Procédure TLS suggérée, après vérification DNS + console SSH authentifiée : faire servir les challenges ACME sur les 4 noms ; étendre avec Certbot le certificat nommé `cardoriashop.fr` pour `cardoriashop.fr`, `www.cardoriashop.fr`, `cardiashop.fr`, `www.cardiashop.fr` ; contrôler les SAN avec `openssl x509 -in /etc/letsencrypt/live/cardoriashop.fr/fullchain.pem -noout -ext subjectAltName` ; seulement ensuite installer le modèle et tester les 4 domaines et l'API.
- N'effectuer aucune fusion ou redirection permanente tant que les tests CI spécialisés, les contrôles DNS/TLS, les paiements et l'authentification ne sont pas validés.
