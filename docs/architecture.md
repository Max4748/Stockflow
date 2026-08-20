# Architecture

## En une phrase

Une application Next.js qui ne parle à sa base **que depuis le serveur**, adossée
à une instance Supabase, où **toute la logique métier vit en SQL**.

## Vue d'ensemble

```
Navigateur ──HTTP──▶ Next.js (Server Components + Server Actions)
                          │
                          │ clé anon + session de l'utilisateur
                          ▼
                     Kong 127.0.0.1:8001
                          │
                   ┌──────┴──────┐
                   ▼             ▼
              PostgREST       GoTrue        Postgres
              (données)       (auth)        RLS + 57 fonctions
```

Le navigateur ne connaît que du HTML et les Server Actions. Il n'a **aucune clé
Supabase**, aucune URL de base de données, et ne peut donc rien interroger
directement.

## Les trois principes structurants

### 1. L'autorisation est dans la base, pas dans l'interface

Chaque table a ses politiques RLS, chaque fonction d'écriture commence par une
garde, et les écritures directes sont révoquées. L'interface ne fait que
présenter, voir [securite.md](securite.md).

Corollaire : **on peut supprimer entièrement le front-end sans ouvrir une seule
faille.** C'est le test mental à appliquer avant d'ajouter un contrôle
uniquement côté TypeScript.

### 2. Aucun calcul métier en TypeScript

Totaux, coûts, marges, dettes, contrôles de stock : tout est calculé en SQL. Les
montants affichés dans les formulaires pendant la saisie sont **indicatifs** ;
le montant qui fait foi est celui que recalcule la fonction appelée.

Sans cette règle, un vendeur pourrait fabriquer un total qui l'arrange en
modifiant la requête, et deux implémentations du même calcul finiraient par
diverger.

### 3. Aucun accès Supabase depuis le navigateur

Les variables s'appellent `SUPABASE_URL`, `SUPABASE_ANON_KEY` et
`SUPABASE_SERVICE_ROLE_KEY`, **sans** préfixe `NEXT_PUBLIC_`. Elles sont donc
lues à l'exécution, jamais inlinées dans le bundle.

| Conséquence                       | Détail                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------- |
| Aucune clé exposée                | `grep -rl "$FRAGMENT" .next/static/` ne renvoie rien                         |
| Aucun secret dans l'image Docker  | vérifié : `grep -rl` sur `/app` de l'image, et `Config.Env` sans `SUPABASE_*` |
| Pas de rebuild pour changer d'URL | dev → conteneur → domaine public = une variable                              |
| Pas de temps réel par websocket   | assumé : le service `realtime` n'est pas démarré                             |

La containerisation est venue encaisser ce choix. Le [Dockerfile](../Dockerfile)
n'a **aucun build-arg** : les trois variables sont fournies par Compose à
l'exécution, et le passage du poste de développement
(`http://127.0.0.1:8001`) au conteneur (`http://stockflow-kong:8000`) s'est fait
en changeant une ligne de `.env`, sans reconstruire quoi que ce soit.

> Une seule conséquence visible : `@supabase/ssr` dérive le **nom du cookie de
> session** de l'URL Supabase. Changer celle-ci déconnecte tout le monde une
> fois, voir [exploitation.md](exploitation.md).

C'est l'inverse du montage courant, qui inline
`NEXT_PUBLIC_SUPABASE_URL=http://kong:8000` : une valeur qu'un navigateur ne
peut pas résoudre, qui oblige à passer les variables en build-args, et qui
impose un rebuild d'image à chaque changement d'URL.

Le seul endroit où des valeurs Supabase apparaissent au build est l'étape
`builder` du Dockerfile, en **valeurs factices** : `src/lib/env.ts` valide au
chargement du module, et `next build` évalue ces modules pendant sa phase
« collect page data ». Elles ne franchissent pas la frontière d'étape.

## Pile technique

| Couche        | Choix                                   | Version                      |
| ------------- | --------------------------------------- | ---------------------------- |
| Framework     | Next.js App Router                      | 16.3                         |
| Interface     | React, TypeScript, Tailwind             | 19 / 5 / 4.3                 |
| Composants    | shadcn/ui sur **base-ui** (pas Radix)   | CLI 4.16                     |
| Données       | PostgreSQL via Supabase self-host       | 17.6                         |
| Accès données | `@supabase/ssr` côté serveur uniquement | 0.12                         |

`base-ui` au lieu de Radix change deux choses au quotidien : `Button` n'expose
plus `asChild` (utiliser `buttonVariants()` sur un `Link`), et les déclencheurs
prennent un prop `render` au lieu d'envelopper un enfant.

## Organisation du code

```
src/
├── proxy.ts                convention Next 16 (ex-middleware.ts) : rafraîchit
│                           la session, cloisonne public / authentifié
├── lib/
│   ├── env.ts              valide les 3 variables au chargement
│   ├── supabase/server.ts  client de session, soumis à la RLS
│   ├── supabase/admin.ts   ⚠️ clé service_role, voir securite.md
│   ├── auth.ts             exigerProfil / exigerAdmin / exigerDev
│   ├── types.ts            types de la base, écrits à la main
│   ├── format.ts           euros, dates, seuils (fr-FR)
│   └── periode.ts          bornes de période depuis les searchParams
├── components/             tableau, kpi, dialogue-action, filtre-periode,
│                           navigations, thème
└── app/
    ├── login/ changer-mot-de-passe/ en-attente/
    ├── vendeur/            4 écrans + correction de vente
    └── gestion/            9 écrans
```

## Le proxy ne fait qu'une chose

`src/proxy.ts` rafraîchit la session et distingue **public / authentifié**. Il ne
contrôle **aucun rôle** : ce serait une barrière illusoire, puisqu'une Server
Action est une URL qu'un appelant peut viser sans passer par une page.

Le contrôle de rôle appartient aux layouts (`exigerAdmin`, `exigerDev`) **et**
est rappelé dans chaque Server Action.

Deux détails qui comptent :

- `getUser()` et **jamais** `getSession()` pour une décision d'autorisation :
  `getUser` revalide le jeton auprès de Supabase, `getSession` se contente de
  lire un cookie manipulable ;
- les en-têtes de `setAll` sont recopiés sur la réponse, pour qu'aucun cache ne
  conserve une réponse porteuse de cookies d'authentification.

## Motif des Server Actions

Toutes suivent la même forme :

```ts
export async function monAction(_etat: EtatAction, formData: FormData) {
  await exigerAdmin();                    // garde RAPPELÉE, pas seulement au layout
  // …validation superficielle…
  const { error } = await supabase.rpc("…", { … });
  if (error) return { erreur: error.message };   // message SQL affiché tel quel
  revalidatePath("/gestion", "layout");
  return { succes: "…", jeton: crypto.randomUUID() };
}
```

Le `jeton` est un identifiant unique par succès. Il sert de `key` React pour
remonter un formulaire ou fermer un dialogue, **sans `setState` dans un
`useEffect`**, que la configuration ESLint refuse (renders en cascade). Voir
[interface.md](interface.md).

Les messages d'erreur SQL sont rédigés pour un humain
(« Stock insuffisant pour Produit A : 999 demandée(s), 25 disponible(s). ») et
affichés tels quels plutôt que retraduits.
