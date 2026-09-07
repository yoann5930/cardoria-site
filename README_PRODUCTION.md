# Cardoria — Production

Ce document décrit uniquement l’architecture de production actuelle.

## Source de vérité

- Dépôt : `yoann5930/cardoria-site`
- Branche de production : `main`
- URL publique canonique : `https://www.cardoriashop.fr`
- Hébergement de production : VPS OVH

Les anciennes infrastructures Render, Vercel et Oracle ne font plus partie de la production Cardoria.

## Frontend et backend

Le frontend public se trouve à la racine du dépôt. Le backend Node.js sert le runtime de production depuis `backend/public`.

Le workflow `.github/workflows/frontend-runtime-sync.yml` maintient le miroir du frontend vers `backend/public` lorsque `main` évolue. Ce miroir fait partie du fonctionnement actuel et ne doit pas être supprimé.

Le workflow vérifie également qu’aucune ancienne URL de production Vercel n’est réintroduite dans le frontend runtime.

## Opérations OVH

Les opérations serveur sont séparées du code applicatif et passent par les workflows OVH dédiés :

- `.github/workflows/ovh-ops.yml`
- `.github/workflows/ovh-ops-issue.yml`
- `.github/workflows/ovh-ops-run.yml`

Les opérations exécutables sont strictement limitées par une liste blanche. Les déploiements utilisent uniquement la branche `main`.

Aucun secret, mot de passe, clé SSH ou valeur sensible ne doit être ajouté à ce dépôt ou à cette documentation.

## Déploiement

1. Les modifications sont préparées et testées sur une branche dédiée.
2. Les contrôles CI doivent être verts avant fusion.
3. La branche validée est fusionnée dans `main`.
4. Une opération OVH explicite et autorisée est ensuite nécessaire pour modifier le VPS de production.
5. La production n’est considérée validée qu’après contrôles réels sur `https://www.cardoriashop.fr`.

Une simple modification GitHub ou une fusion de branche ne doit pas être présentée comme un déploiement OVH réussi.

## Contrôles utiles

- Santé API : `GET /api/health/`
- Pages publiques et administration : contrôles définis dans les workflows CI du dépôt.
- Synchronisation frontend runtime : `.github/workflows/frontend-runtime-sync.yml`
- Opérations et diagnostics VPS : workflows `ovh-ops*`

## Infrastructures retirées

Les configurations de déploiement Render, Vercel et Oracle sont considérées comme héritées et ne doivent pas être réintroduites comme cibles de production.

Les références à ces plateformes peuvent uniquement subsister lorsqu’elles servent de garde-fou explicite empêchant le retour d’une ancienne URL ou configuration en production.
