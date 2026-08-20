# Interface

## Aucun plafond de largeur : la règle qui structure tous les écrans

**Aucune page n'a de `max-w-*`.** L'interface occupe l'écran quelle qu'en soit
la taille. Ce qui empêche un contenu de s'étirer à l'absurde n'est pas une
largeur maximale mais **le nombre de colonnes**, qui augmente avec la place
disponible.

| Zone                      | Mobile          | `sm`    | `lg`    | `xl`    | `2xl`   |
| ------------------------- | --------------- | ------- | ------- | ------- | ------- |
| Bandeau de chiffres clés  | empilé          | 2 col.  | 4 col.  | 4 col.  | 6 col.  |
| Alertes / journal         | empilé          | empilé  | 1⁄3–2⁄3 | 1⁄3–2⁄3 | 1⁄4–3⁄4 |
| Tuiles de stock           | 1 col.          | 2 col.  | 3 col.  | 4 col.  | 6 col.  |
| Lignes de saisie de vente | 1 ligne empilée | 1 ligne | 1 ligne | 1 ligne | 1 ligne |
| Lignes de réassort        | 1 col.          | 2 col.  | 3 col.  | 3 col.  | 4 col.  |

Deux conséquences à respecter en ajoutant un écran :

- **ne pas remettre de `max-w-*` sur un conteneur de page.** Si un contenu
  paraît trop étiré, la réponse est un palier de colonnes supplémentaire, pas
  une page bridée ;
- **une liste en pleine largeur est à convertir en tuiles.** Un `<ul>` avec
  `justify-between` mettrait le libellé à un bout de l'écran et sa valeur à
  l'autre. Les listes de stock, de réassort et l'historique sont des `<ul>` en
  `display: grid`. La sémantique de liste est conservée, la mise en page ne
  l'est pas.

Deux blocs restent volontairement bornés parce qu'ils sont du **texte à lire**,
pas des données à parcourir : la zone « Précision » du réassort et la carte
« Demande en cours » (`max-w-2xl`).

## Navigation : deux formes, une seule liste

**Espace vendeur** (`navigation-vendeur.tsx`) : 5 entrées, barre d'onglets fixée
en bas sur mobile (zone du pouce, cibles de 56 px), en ligne dans l'en-tête à
partir de `md`. Cinq onglets tiennent : ~75 px chacun sur un écran de 375 px.

L'onglet **SAV** porte une pastille, allumée uniquement s'il s'est passé
quelque chose que le vendeur n'a **pas fait lui-même** depuis sa dernière
visite. Elle s'éteint à l'ouverture de l'écran, via un composant client
`MarquerSavVu` monté sur la page.

**Pourquoi côté client et pas pendant le rendu** : la route est `force-dynamic`
et le projet n'a aucun `loading.tsx`, donc un préchargement de lien peut faire
rendre la page côté serveur sans que le vendeur l'ait vue. La pastille
s'éteindrait sur une information jamais reçue. L'effet est conditionné à
`actif={nonVus > 0}` : rien à éteindre, aucun appel, donc aucune boucle avec le
`revalidatePath` que l'action déclenche pour rafraîchir le compteur du layout.

**Espace gestion** (`navigation-admin.tsx`) : 9 sections groupées (Pilotage /
Stock / Comptabilité / Technique), barre latérale à partir de `lg`, tiroir en
dessous. Le groupe **Technique** (Intégrité, Comptes gérants) n'est rendu que si
`niveau >= 3` ; ce filtrage **n'est pas une mesure de sécurité**, chaque page
qu'il masque appelle `exigerDev()` et chaque fonction SQL vérifie le rôle en
base ; il évite seulement de montrer à un gérant des écrans qui le
laisseraient perplexe.

Les compteurs de pastille sont passés en **dictionnaire chemin → nombre**
(`Compteurs`), pas une prop par file d'attente : chaque nouvelle file en
ajouterait sinon une à traverser trois composants. Le même type sert aux deux
espaces. Côté gestion, deux files à ce jour : les demandes de réassort et les
remboursements SAV à arbitrer, qui bloquent l'une un vendeur sur le terrain,
l'autre sa dette. Le bouton du tiroir porte leur **total** : sous `lg` la barre
latérale est masquée, et rien ne signalerait sinon qu'une décision attend.

### Bascule entre les deux espaces

Un gérant pilote **et** vend. `bascule-espace.tsx` pose dans les deux en-têtes un
bouton vers l'autre espace ; il n'apparaît côté vendeur que pour l'encadrement.

C'est un **Server Component** : un `<form>` sur une Server Action, comme le
bouton Déconnexion. Poser un cookie et rediriger ne demande aucun JavaScript
client. Le libellé se réduit à « Gestion » / « Vendeur » sous `sm`, l'en-tête
vendeur portant déjà le thème, la déconnexion et, dès `md`, la navigation.

L'espace choisi est mémorisé et `/` y renvoie à la connexion suivante. Ce cookie
est du confort de navigation et rien d'autre, voir
[securite.md](securite.md#le-cookie-de-bascule-despace-ne-porte-aucune-autorisation).

Le tableau de bord vendeur s'adapte : un gérant n'a pas de créance ni de
commission, la grande carte affiche donc son **encaissé** et la carte de
commission disparaît.

## Composants partagés

### `tableau.tsx` : un tableau, deux rendus

```tsx
<Tableau
  colonnes={COLONNES}
  lignes={ventes}
  cle={(v) => v.id}
  action={(v) => <Bouton />}
/>
```

`<table>` à partir de `md`, cartes libellé/valeur en dessous, depuis **une
seule** définition de colonnes. Sans lui, chaque écran rendrait ses données
deux fois et les deux versions divergeraient à la première modification.

```ts
type Colonne<T> = {
  cle: string;
  entete: string;
  valeur: (ligne: T) => ReactNode;
  alignement?: "gauche" | "droite"; // droite + tabular-nums pour les nombres
  principale?: boolean; // devient le titre de la carte mobile
  masquerEnCarte?: boolean;
};
```

**À ne pas gonfler** (tri, filtres, sélection) tant qu'un écran n'en a pas
réellement besoin. Un écran aux exigences très différentes écrit son propre
tableau plutôt que d'ajouter des options ici.

### L'écran État du stock porte les trois gestes du stock

Ils sont rangés là parce que c'est l'écran où l'on constate un problème de
stock, pas dans trois écrans différents :

| Bouton                  | Effet                                                    | Variante  |
| ----------------------- | -------------------------------------------------------- | --------- |
| **Nouveau Restock**     | achat fournisseur, unités en entrepôt **avec leur coût** | `default` |
| **Distribuer le stock** | entrepôt → un compte, sans demande préalable             | `outline` |
| **Ajuster le stock**    | écart de comptage, casse, perte — motif obligatoire      | `outline` |

« Nouveau Restock » est **le même composant** que sur l'écran Restock : deux
copies divergeraient, et c'est ce formulaire qui fixe le coût de revient de
toute la marchandise à venir.

Le SAV, lui, **n'a pas sa place ici** : il part d'une vente, pas d'un état de
stock, et l'écran Service après-vente porte son propre bouton avec le suivi des
dossiers qui va avec. L'y dupliquer chargeait un en-tête déjà dense sans rien
apporter.

Le formulaire de SAV présente les deux dénouements avec leur conséquence écrite
avant validation : offrir une unité et rendre de l'argent ne coûtent pas la même
chose à la maison, et le choix se fait là.

### Un formulaire de SAV, deux espaces

`components/formulaire-sav.tsx` est monté côté gestion (écrans Stock et SAV) et
côté vendeur (`/vendeur/vente`, là où il a ses ventes sous les yeux quand le
client rappelle). Une prop `contexte` choisit la Server Action et les libellés.

**Ce que le contexte change ne décide de rien** : c'est `declarer_sav()` qui
déduit le régime de qui appelle. La prop ne fait qu'éviter d'afficher ce qui n'a
pas de sens. Un vendeur n'a pas accès à l'entrepôt, et il _demande_ un
remboursement au lieu de l'accorder (« Envoyer au gérant »).

L'écran **Gestion → SAV** porte l'arbitrage et l'historique : dossiers en
attente en haut avec Valider / Refuser, puis le tableau complet avec les quatre
statuts en pastille. Le refus ouvre son propre dialogue, parce qu'il demande un
motif que la validation n'a pas.

### `dialogue-action.tsx` : sortir les actions ponctuelles de la page

> **La règle : une page montre, un bouton agit.** Tout formulaire de **saisie**
> s'ouvre depuis un bouton.

Deux exceptions, et elles se reconnaissent seules :

- **le formulaire EST la page** : connexion, changement de mot de passe,
  correction d'une vente. On y arrive déjà par un geste délibéré ; un bouton
  « ouvrir le formulaire » sur une page qui ne contient que lui ajouterait un
  clic pour rien ;
- **les cartes de décision** : demandes de réassort, remboursements SAV en
  attente. Les champs y servent à _trancher_, pas à saisir : les avoir sous les
  yeux évite d'ouvrir un dialogue par dossier.

Un **filtre** n'est pas une action et reste dans la page (période, compte).

**Corollaire : un dialogue s'ouvre là où le besoin naît, pas au bout d'un
trajet.** L'accueil vendeur portait un gros bouton « Enregistrer une vente » qui
menait à un écran où un second bouton du même libellé ouvrait le formulaire,
deux clics sur le même mot. Le dialogue y est maintenant monté directement, et
la demande de réassort part de la carte « Stock à surveiller » qui la motive.
Une page reste utile pour _consulter_ (les ventes récentes, l'état d'une
demande) ; elle n'est plus un passage obligé pour _agir_.

Motivation d'origine : la fiche vendeur empilait cinq gros blocs, dont trois
n'étaient que des actions ponctuelles (encaisser un versement, reprendre du
stock, régler le compte). Le même travers touchait l'espace vendeur, où la
saisie d'une vente occupait 700 px en haut de page **en permanence**, reléguant
les ventes récentes tout en bas, alors qu'on vient le plus souvent les relire.

```tsx
<DialogueAction
  libelle="Encaisser un versement"
  variante="default"
  titre="…"
  jeton={etat.jeton}
>
  <form action={action}>…</form>
</DialogueAction>
```

Règle de variante, à respecter en ajoutant un bouton : **`default` (plein) pour
l'action principale d'une vue** (un bouton seul dans un en-tête de page),
**`outline` seulement quand plusieurs actions cohabitent** et qu'il faut les
départager, comme sur la fiche vendeur où « Encaisser » domine les trois autres.

`tailleBouton` règle la cible tactile du déclencheur : `sm` dans une ligne de
tableau, **`lg` pour l'action principale d'un espace** : l'enregistrement d'une
vente garde ainsi ses 56 px, saisie debout sur un téléphone. La hauteur passe
par `className` et non par `size` : les tailles du registre shadcn sont petites
(`lg` y vaut 36 px), et tout le projet règle déjà ses hauteurs ainsi.

**Fermeture après succès sans `setState` dans un effet**. Le réflexe habituel
casse les règles ESLint du projet (renders en cascade). À la place :

```tsx
<Dialog key={jeton ?? "initial"}>
```

Le `jeton` change à chaque succès de l'action ; React **remonte** le dialogue,
qui repart fermé et avec des champs vierges. Une seule ligne, cohérente avec le
motif déjà utilisé pour réinitialiser les formulaires de saisie.

> ⚠️ **Ne PAS passer `jeton` quand le succès produit quelque chose à lire.** Les
> deux créations de compte affichent un mot de passe provisoire, **une seule
> fois** et jamais stocké : refermer le dialogue l'emporterait avec lui. Là, le
> `key` reste sur le `<form>` intérieur (il suffit à vider les champs) et
> c'est l'utilisateur qui ferme, une fois le secret copié.

**Jamais de dialogue imbriqué** : un dialogue dans un dialogue provoque des
pièges de focus et un empilement de calques. C'est pourquoi la désactivation
d'un compte a son propre bouton plutôt que de vivre dans « Paramètres ».

### `filtre-periode.tsx` + `lib/periode.ts` : piloté par l'URL

```tsx
<FiltrePeriode actif={periode.cle} />
```

La période vit dans les `searchParams`, pas dans un état client : la page reste
un Server Component (la RPC est appelée côté serveur avec les bonnes bornes), le
filtre est **partageable par lien** et survit au rechargement.

### `kpi.tsx`, `bouton-theme.tsx`

`Kpi` donne la même forme à tous les chiffres clés de l'application. Le bouton
de thème est détaillé dans [theme.md](theme.md).

## Motif de formulaire : jeton + remontage par `key`

Réutilisé partout où une saisie doit se réinitialiser après un succès :
formulaire de vente, de réassort, d'achat, tous les dialogues :

```tsx
const [etat, action, enCours] = useActionState<EtatAction, FormData>(monAction, {});

useEffect(() => {
  if (etat.succes) toast.success(etat.succes);   // effet légitime : système externe (sonner)
}, [etat.succes, etat.jeton]);

return (
  <form action={action}>
    <Champs key={etat.jeton ?? "initial"} … />   {/* remonté, donc réinitialisé */}
  </form>
);
```

```ts
export type EtatAction = { erreur?: string; succes?: string; jeton?: string };
export type EtatActionSecret = EtatAction & {
  motDePasse?: string;
  email?: string;
};
```

`EtatActionSecret` porte en plus un mot de passe provisoire à afficher une
fois, jamais persisté dans l'état au-delà du rendu qui le montre.

## Mobile d'abord, vraiment

L'espace vendeur est pensé pour une saisie **debout, sur un téléphone** :

- cibles tactiles ≥ 44 px (56 px sur la barre d'onglets) ;
- deux formes de sélection, selon ce qu'il y a à choisir :
  - **`ChampSelect`** (`components/champ-select.tsx`) quand une **ligne de texte
    suffit** à décrire chaque option. **Ce n'est plus un `<select>` natif**, et
    ce revirement est assumé : la liste ouverte d'un `<select>` appartient au
    système, on ne peut ni l'arrondir, ni l'ombrer, ni la mettre au thème. Pire,
    le seul levier disponible (le fond du champ) rendait les options
    illisibles dès qu'il était translucide. Deux défauts sans correctif CSS.

    Ce que ça coûte : plus de sélecteur système sur mobile (une liste ordinaire,
    cibles de 44 px), et du JavaScript là où le reste des formulaires s'en
    passe. Ce qui est préservé : **la soumission native**. `Select.Root` rend
    un champ caché portant le `name`, donc `FormData` le récupère comme avant et
    aucune Server Action n'a bougé.

    Les options se passent en **données** (`options={[{ valeur, libelle }]}`) et
    non en enfants JSX : le composant reste appelable depuis un Server
    Component, comme sur l'écran Comptabilité ;

  - **cartes à bouton radio** dès qu'il faut deux lignes pour distinguer les
    options. Deux cas d'école : le sélecteur de vente du SAV (sept ventes du
    même jour, au même client, du même produit donnaient sept lignes
    identiques ; l'horodatage à la seconde les sépare, d'où
    `dateHeurePrecise()`), et le
    **destinataire d'une distribution**, où la carte porte ce que chacun détient
    déjà. C'est la question qu'on se pose en distribuant, et un `<select>` ne
    sait pas y répondre ;
- une liste de choix qui grandit avec les données est **bornée en hauteur** et
  défile dans son propre conteneur (`max-h-64 overflow-y-auto`), sinon le
  dialogue dépasse l'écran ;
- **un formulaire à lignes répétées se compte en hauteur × nombre de lignes.**
  La saisie d'une vente donnait une _carte_ par produit : 180 px pièce, soit
  plus de 1 000 px à faire défiler pour six produits sur un téléphone. Elle
  donne maintenant une _ligne_ : ~90 px sur mobile, ~44 px dès `sm`, avec un
  en-tête de colonnes affiché une seule fois et des `aria-label` à la place des
  libellés répétés. Rien d'informatif n'a été retiré. « N disponible(s) » est
  déjà dans l'option choisie, et le prix conseillé est la valeur pré-remplie.
  `sm:contents` fait disparaître le conteneur mobile pour que ses champs
  deviennent des cellules de la grille parente ;
- barre de total **collante**, qui remonte au-dessus de la barre d'onglets sur
  mobile et se détache en bas de fenêtre sur bureau ;
- `viewport` du layout racine fixé à `width: device-width, initialScale: 1`.

## Composants shadcn/ui

Le projet utilise le registre **base-ui**, pas Radix (CLI 4.16). Différences
pratiques :

- `Button` n'expose plus `asChild` → utiliser `buttonVariants({ variant })`
  directement sur un `Link` ;
- les déclencheurs (`DialogTrigger`, `SheetTrigger`, `DropdownMenuTrigger`)
  prennent un prop `render`, pas un enfant enveloppé.

Trois fichiers sont **modifiés** par rapport au registre, voir
[securite.md](securite.md#composants-shadcn-modifiés) pour le détail et le
risque de régression en cas de mise à jour.
