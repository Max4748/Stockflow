# StockFlow

Gestion de stock, de ventes et de créances pour une activité à plusieurs
vendeurs : chacun détient une part du stock, encaisse ses clients, garde sa
commission et reverse le solde. Next.js 16 (App Router), React 19, TypeScript,
Tailwind 4, shadcn/ui, PostgreSQL via Supabase. Projet personnel.

## Parti pris techniques

| Décision | Conséquence concrète | Détail |
| --- | --- | --- |
| Logique métier en SQL | 13 tables, 57 fonctions, 20 politiques RLS. Aucun total, coût, marge ni dette n'est calculé en TypeScript | [donnees.md](docs/donnees.md) |
| Autorisation en base, sur quatre couches | RLS, GRANT/REVOKE, garde en tête de fonction, garde applicative. Le front-end peut disparaître sans ouvrir de faille | [securite.md](docs/securite.md) |
| Stock dérivé, jamais stocké | Somme d'un registre de mouvements signés : une incohérence devient visible au lieu d'être écrasée | [donnees.md](docs/donnees.md) |
| Aucune clé Supabase côté navigateur | Variables sans préfixe `NEXT_PUBLIC_`, lues à l'exécution, image Docker sans build-arg | [architecture.md](docs/architecture.md) |

Le dépôt documente aussi une escalade de privilèges trouvée et fermée en cours
de route, avec le `PATCH` qui la reproduisait et le correctif appliqué :
[securite.md](docs/securite.md).

## Démarrer

Prérequis : Node 20+, et une base Supabase (auto-hébergée ou Cloud) dont vous
avez l'URL, la clé anon et la clé service_role.

**1. Variables d'environnement**

```bash
cp .env.example .env.local
```

Les trois valeurs sont lues à l'exécution : en changer ne demande aucun rebuild.

**2. Schéma de la base**

Les 22 fichiers de `supabase/migrations/` sont du SQL ordinaire, écrits pour
être rejoués intégralement, à appliquer dans l'ordre :

```bash
for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

`supabase/appliquer-migrations.sh` fait la même chose pour une instance
auto-hébergée lancée par Docker Compose, et affiche l'inventaire final.

**3. Premier compte**

Aucun compte n'est livré avec le dépôt et aucun mot de passe n'y figure. Le seul
point d'entrée est l'invitation `dev` posée par `0010_seed.sql`, à partir de
laquelle se créent le gérant puis les vendeurs, depuis l'application.
Procédure : [docs/exploitation.md](docs/exploitation.md#comptes-de-test).

**4. Lancer**

```bash
npm install
npm run dev
```

Déploiement en conteneur : `docker compose up -d --build`. Détails,
diagnostic et sauvegardes : [docs/exploitation.md](docs/exploitation.md).

## Documentation

| Document | Répond à |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Comment l'application est structurée, et pourquoi |
| [docs/donnees.md](docs/donnees.md) | Le schéma, le registre de stock, les règles comptables |
| [docs/securite.md](docs/securite.md) | Le modèle de menace, les quatre couches de défense |
| [docs/interface.md](docs/interface.md) | Les composants partagés, la mise en page adaptative |
| [docs/theme.md](docs/theme.md) | Le mode sombre et ses deux corrections de contraste |
| [docs/exploitation.md](docs/exploitation.md) | Démarrer, créer les comptes, tester, diagnostiquer, sauvegarder |
| [supabase/tests/](supabase/tests/README.md) | Ce que les tests SQL couvrent, et comment en écrire un |

## Vérifier

```bash
npx tsc --noEmit && npx eslint src
./supabase/tests/lancer.sh
```

Les tests sont en **pgTAP**, pas en TypeScript : c'est en SQL que vit la logique
métier, donc c'est là que porte la couverture. 50 assertions, portant sur les règles
qu'on ne peut ni annuler ni deviner en lisant l'interface : la
hiérarchie des rôles, le calcul de la dette, la borne anti-surversement, les
deux régimes du SAV et la révocation d'un échange.
Chaque fichier tourne dans une transaction annulée : rien n'est écrit, aucune
base de test à maintenir. Détail : [supabase/tests/](supabase/tests/README.md).

Deux contrôles complètent le typage :
`verifier_coherence_stock()` vérifie les trois invariants qu'aucune contrainte
SQL ne peut porter (écran Gestion → Intégrité), et **rejouer le script de
migration deux fois de suite** attrape les changements de signature qu'un seul
passage laisse filer.

## Construit dans cet ordre

| Étape | Contenu |
|---|---|
| Socle | Authentification, espace **vendeur** |
| Gestion | Espace **gestion** (9 écrans), niveaux de permission, correction des ventes, réassort depuis l'écran Stock |
| Confort | Thème clair / sombre. Bascule d'espace et transfert direct de stock, pour un gérant qui vend aussi |
| SAV | D'abord rattaché à la vente côté gestion, puis déclaré par le vendeur : échange immédiat ou remboursement arbitré, avec son propre écran et une pastille de nouveauté |
| Déploiement | Image standalone, limite mémoire, redémarrage automatique |

## Licence

MIT, voir [LICENSE](LICENSE).
