# Cardoria — Oracle Cloud Always Free

Objectif: heberger Cardoria sur une VM Oracle Always Free sans modifier le design ni les regles metier.

Architecture cible:
- Ubuntu 24.04 ARM64
- Node.js 22
- systemd pour Cardoria
- Nginx reverse proxy
- Certbot / Let's Encrypt
- PostgreSQL local prive
- GitHub auto-deploy par SSH
- sauvegardes quotidiennes locales + rotation

Regles de securite:
- aucun secret dans Git
- aucun changement DNS avant validation
- Render/Vercel conserves tant que la VM Oracle n'est pas validee
- PostgreSQL ecoute uniquement en local
- ports publics: 22, 80, 443 uniquement

Ordre:
1. Creer une VM Oracle Always Free Ubuntu 24.04 ARM64, 2 OCPU, 12 Go RAM si disponible.
2. Autoriser 22, 80, 443 dans OCI et le firewall local.
3. Copier ce depot dans /opt/cardoria/current.
4. Executer oracle/install-server.sh en root.
5. Copier oracle/cardoria.env.example vers /etc/cardoria/cardoria.env puis renseigner les secrets localement.
6. Executer oracle/deploy.sh.
7. Tester http://IP/api/health/ et /api/health/startup.
8. Configurer le DNS seulement apres validation complete.
9. Executer oracle/enable-https.sh une fois le domaine pointe vers la VM.

Rollback:
- chaque deploiement conserve un commit precedent dans /opt/cardoria/previous-commit
- oracle/rollback.sh restaure le commit precedent et redemarre le service

Important: Oracle peut recuperer une instance Always Free consideree inactive. Maintenir une utilisation normale du service et des sauvegardes externes reste recommande.