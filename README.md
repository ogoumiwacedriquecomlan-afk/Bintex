# Bintex Platform

Platforme d'investissement et de trading.

## Déploiement

### Déployer sur Vercel

1.  Installer Vercel CLI: `npm i -g vercel`
2.  Lancer: `vercel`

### Déployer sur GitHub

1.  Créer un nouveau repository sur GitHub.
2.  Lancer les commandes suivantes:

```bash
git remote add origin https://github.com/VOTRE_NOM_UTILISATEUR/NOM_DU_REPO.git
git branch -M main
git push -u origin main
```

## Structure

-   `index.html`: Page d'accueil.
-   `dashboard.html`: Espace utilisateur (protégé).
-   `auth.js`: Gestion de l'authentification (Supabase).
-   `img/`: Actifs graphiques.
