# Cardoria MCP Gateway — Déploiement et connexion ChatGPT

## État

Cette branche ajoute une passerelle MCP **READ ONLY** au backend Cardoria existant.

- Endpoint MCP : `https://cardoria-site-2.onrender.com/mcp`
- Health : `https://cardoria-site-2.onrender.com/api/mcp/health`
- Base : données Cardoria existantes (SQLite + fichiers JSON)
- Aucun accès SQL direct n'est exposé au client MCP.
- Aucun secret n'est retourné par les outils.

## Variables Render

Définir côté Render uniquement :

```env
CARDORIA_MCP_ENABLED=true
CARDORIA_MCP_READ_ONLY=true
CARDORIA_MCP_BASE_URL=https://cardoria-site-2.onrender.com/mcp
CARDORIA_MCP_ISSUER=https://cardoria-site-2.onrender.com
CARDORIA_MCP_TOKEN_SECRET=<secret-long-aleatoire>
```

Le secret ne doit jamais être ajouté dans GitHub.

## Outils READ publiés

- `cardoria_health`
- `cardoria_dashboard`
- `cardoria_inventory_search`
- `cardoria_inventory_item`
- `cardoria_list_sales`
- `cardoria_list_purchases`
- `cardoria_accounting_month`
- `cardoria_whatnot_summary`

Tous sont annotés `readOnlyHint=true`.

## Test HTTP

Après déploiement :

```bash
curl -s https://cardoria-site-2.onrender.com/api/mcp/health
```

Puis lister les outils :

```bash
curl -s -X POST https://cardoria-site-2.onrender.com/mcp \
  -H "Authorization: Bearer $CARDORIA_MCP_TOKEN_SECRET" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Connexion ChatGPT

Dans ChatGPT, créer une app MCP personnalisée uniquement lorsque le endpoint de production répond et que le mécanisme d'authentification compatible avec le compte ChatGPT utilisé a été validé.

Cette branche utilise actuellement un Bearer secret côté serveur pour éviter tout endpoint Cardoria sensible public. Si l'interface ChatGPT du compte utilisé exige OAuth plutôt qu'un header d'authentification statique, ne pas désactiver l'authentification : ajouter l'OAuth 2.1/PKCE avant la connexion.

## Sécurité

- `CARDORIA_MCP_ENABLED=false` coupe la passerelle.
- `CARDORIA_MCP_TOKEN_SECRET` est obligatoire pour `/mcp`.
- Le health public ne révèle ni secret, ni URI de base de données, ni clé API.
- Les outils d'écriture ne sont pas publiés dans cette branche.
- Les résultats comptables portant `estimated=true` sont des indicateurs de gestion et ne constituent pas une déclaration fiscale/sociale définitive.

## Whatnot

Il n'existe pas de connecteur Whatnot officiel dans le dépôt Cardoria actuellement publié. `cardoria_whatnot_summary` lit uniquement les ventes déjà enregistrées avec `channel=WHATNOT` et ne scrape pas Whatnot.
