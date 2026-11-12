# Tests

Quatre familles, qui ne vérifient pas la même chose. La CI les joue toutes
(`.github/workflows/ci.yml`).

| Commande | Ce qu'elle vérifie | Ce qu'il lui faut |
|---|---|---|
| `npm run test:unit` | La logique écrite en TypeScript : tri, recherche, CSV, périodes, séries des graphiques, anti-bourrage | rien |
| `npm run test:db` | Le schéma s'installe depuis une base vide et se rejoue sans erreur | rien (PGlite) |
| `npm run test:sql` | **Les règles métier** : dette, stock, SAV, droits de chaque rôle | un Postgres (`compose.test.yaml`) |
| `npm run test:e2e` | **L'interface**, dans un vrai navigateur | l'application construite |

## Où est testée une règle métier

En SQL, par pgTAP (`supabase/tests/`), sur l'image Postgres de production.
C'est là que vit la logique (voir `architecture.md`), c'est donc là qu'elle se
prouve : qu'un vendeur ne lit pas la marge, qu'un remboursement est déduit à sa
date, que la somme des produits retombe sur le bilan.

## Ce que les tests de bout en bout prouvent, et ne prouvent pas

`e2e/` lance l'application construite (`next start`) contre un **faux
Supabase** (`e2e/faux-supabase.mjs`) qui sert un jeu de données fixe
(`e2e/donnees.mjs`), puis pilote Chromium avec Playwright.

Ils prouvent que :

- chaque écran testé s'affiche sans erreur, en bureau comme à la largeur d'un
  téléphone ;
- les gardes d'accès redirigent (sans session → connexion, vendeur → hors de
  la gestion, export refusé) ;
- le tri, la recherche et la pagination passent bien par l'URL et changent ce
  qui est affiché ;
- les gestes d'interface fonctionnent : Ctrl+K, reprise de la dernière vente,
  confirmation de déconnexion, reçu, restock pré-rempli.

Ils **ne prouvent pas** qu'un chiffre est juste : le faux serveur répond ce
qu'on lui a écrit de répondre. Il ne connaît ni la RLS ni les fonctions SQL ;
une fonction qu'il ne connaît pas est acceptée sans effet. Un test vert ici
signifie « l'écran sait afficher une réponse de la forme attendue », jamais
« le calcul est bon ».

Pourquoi un faux plutôt qu'une vraie pile : monter Postgres, PostgREST et
GoTrue à chaque poussée coûterait des minutes de CI pour revérifier ce que
pgTAP vérifie déjà, sur le vrai moteur.

### Lancer en local

```bash
npm run build
npm run test:e2e
```

- Première fois : `npx playwright install chromium`. Si un Chromium est déjà
  installé ailleurs, `CHROMIUM=/chemin/vers/chromium npm run test:e2e`.
- Déboguer un échec : `npx playwright test -g "nom du test" --trace on`, et
  `JOURNAL_SERVEUR=1` pour voir la sortie des deux serveurs.
- Voir un écran avec ces données : `node e2e/faux-supabase.mjs`, puis
  `next dev` avec `SUPABASE_URL=http://127.0.0.1:8001`.

### Ajouter un écran aux données

Une table lue par l'écran va dans `tables`, une fonction de lecture dans
`fonctions` (`e2e/donnees.mjs`). Les dates se calculent avec `ilYA(n)` : des
dates fixes sortiraient des filtres de période avec le temps.
