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

## Navigation : deux formes, et pourquoi elles ne fusionneront pas

La question revient : pourquoi l'espace vendeur bascule ses onglets du haut
vers le bas, quand la gestion passe d'une barre latérale à un tiroir ? Ce
n'est pas un accident de style, et uniformiser dégraderait l'un des deux.

| | Vendeur | Gestion |
| --- | --- | --- |
| Entrées | 5, à plat | 10, en 5 groupes |
| Posture | debout, une main, face au client | assis, souris, à lire des tableaux |
| Étroit | barre d'onglets fixée en bas | tiroir derrière une icône |
| Large | en ligne dans l'en-tête | barre latérale collante |

**Une barre du bas pour la gestion est arithmétiquement impossible.** Dix
entrées sur un écran de 375 px font 37 px chacune, sous le minimum tactile de
44 px, et il faudrait y écrire « Comptabilité » et « Comptes gérants ». Le
vendeur en a cinq, à ~75 px : c'est ce qui rend sa barre lisible. Et les cinq
groupes de la gestion ne sont pas décoratifs, ce sont eux qui rendent dix
entrées navigables.

**Un tiroir pour le vendeur coûterait un geste de plus à chaque navigation**,
exactement là où le temps compte : debout, en train d'enregistrer une vente.

Ce qui est unifié, en revanche, et doit le rester :

- **la navigation est atteignable en permanence dans les quatre rendus.** Les
  deux en-têtes sont `sticky`, la barre latérale l'est aussi, la barre
  d'onglets est `fixed`. Avant, chaque espace n'était joignable en permanence
  que dans un de ses deux formats, et c'étaient les formats opposés : au
  bureau le gérant naviguait depuis n'importe où et le vendeur devait remonter
  en haut de page, sur téléphone c'était l'inverse. Invisible tant qu'aucune
  page n'est longue ;
- **les hauteurs d'entrée sont dictées par le doigt ou la souris**, pas par
  l'espace : 56 px dans la barre du bas, 44 px dans le tiroir, 36 px dans les
  deux rendus à la souris. Deux valeurs pour la souris seraient gratuites ;
- **le type `Compteurs` vit dans `lib/types.ts`**, pas dans l'un des deux
  composants de navigation. Il y était propriété de l'un et dépendance de
  l'autre.

- **chaque entrée porte une icône** (lucide), dans les quatre rendus. L'icône
  se reconnaît du coin de l'œil, le libellé lève le doute : aucune entrée n'est
  réduite à son icône ;
- **l'état actif est à la couleur primaire** : aplat `primary/10` et texte
  `primary` dans la barre latérale, le tiroir et la navigation vendeur au
  bureau.

**Une seule chose diverge volontairement : l'état actif de la barre du bas**,
qui emploie une bordure haute (primaire) et non un aplat. Un aplat dans une
barre de 56 px est lourd, et l'indicateur en bordure est la convention des
barres d'onglets sur téléphone. La bordure est toujours présente, transparente
au repos, pour que l'onglet actif ne se décale pas de 2 px. C'est écrit ici
pour que ça ne se fasse pas « corriger » au hasard.

La **marque** (`logo.tsx`) est toujours dans le coin haut gauche : en tête de
barre latérale à partir de `lg` en gestion, dans l'en-tête sinon.

## Les deux formes en détail

**Espace vendeur** (`navigation-vendeur.tsx`) : 5 entrées, barre d'onglets fixée
en bas sur mobile (zone du pouce, cibles de 56 px, icône au-dessus du libellé),
en ligne dans l'en-tête à partir de `md`, à gauche, à la suite de la marque. Cinq onglets tiennent : ~75 px chacun sur un écran de 375 px.

L'onglet **SAV** porte une pastille, allumée uniquement s'il s'est passé
quelque chose que le vendeur n'a **pas fait lui-même** depuis sa dernière
visite. Elle s'éteint à l'ouverture de l'écran, via un composant client
`MarquerSavVu` monté sur la page.

**Pourquoi côté client et pas pendant le rendu** : la route est `force-dynamic`,
donc un préchargement de lien peut faire rendre la page côté serveur sans que
le vendeur l'ait vue. Les `loading.tsx` ajoutés depuis n'y changent rien : ils
montrent une silhouette pendant le rendu, ils ne l'empêchent pas. La pastille
s'éteindrait sur une information jamais reçue. L'effet est conditionné à
`actif={nonVus > 0}` : rien à éteindre, aucun appel, donc aucune boucle avec le
`revalidatePath` que l'action déclenche pour rafraîchir le compteur du layout.

**Espace gestion** (`navigation-admin.tsx`) : 10 sections groupées (Pilotage /
Stock / Comptabilité / Technique / Compte), barre latérale à partir de `lg`,
tiroir en dessous, ouvert par une icône seule. Pas le mot « Menu » : l'en-tête
porte déjà la marque, la bascule d'espace et le menu du compte.
Le bouton fait 40 px et non les 32 px de la variante `icon` par défaut, parce
qu'il est le SEUL point de navigation sous `lg`, et son `aria-label` annonce le
nombre de décisions en attente. Le groupe **Technique** (Intégrité, Comptes gérants) n'est rendu que si
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

C'est un **Server Component** : un `<form>` sur une Server Action. Poser un
cookie et rediriger ne demande aucun JavaScript client. Le bouton n'est montré
qu'à partir de `sm` ; en dessous, la même bascule est une entrée du menu du
compte, l'en-tête d'un téléphone n'ayant pas la place d'un bouton à libellé.

### Menu du compte

`menu-compte.tsx` : une pastille aux initiales, en haut à droite des deux
espaces, qui ouvre un menu portant **tout ce qui concerne le compte** : nom et
rôle, bascule d'espace et sécurité (encadrement seulement), changement de mot
de passe, thème (Clair / Sombre / Système), déconnexion.

**La déconnexion se confirme.** Elle est à un doigt du choix du thème : la
toucher par erreur renvoyait à l'écran de connexion au milieu d'une vente. Le
dialogue de confirmation est rendu à côté du menu, qui se referme en
l'ouvrant : jamais deux calques empilés.

Les deux en-têtes alignaient auparavant trois contrôles séparés (bascule,
thème, « Déconnexion » en toutes lettres) qui se serraient sur téléphone, et
le changement volontaire de mot de passe n'avait aucun chemin. `BoutonTheme`
ne sert plus qu'aux écrans hors espace, en variante flottante.

L'espace choisi est mémorisé et `/` y renvoie à la connexion suivante. Ce cookie
est du confort de navigation et rien d'autre, voir
[securite.md](securite.md#le-cookie-de-bascule-despace-ne-porte-aucune-autorisation).

Le tableau de bord vendeur s'adapte : un gérant n'a pas de créance ni de
commission, la grande carte affiche donc son **encaissé** et la carte de
commission disparaît.

## Composants partagés

### `entete-page.tsx` : un seul en-tête de page

```tsx
<EntetePage
  titre="État du stock"
  description="…"                              // facultatif
  retour={{ href: "/gestion/vendeurs", libelle: "Vendeurs" }}  // page de détail
  badge={<Badge variant="alerte">…</Badge>}    // état accolé au titre
  filtres={<FiltrePeriode actif={periode.cle} />}
>
  <ActionSecondaire />
  <ActionPrincipale />
</EntetePage>
```

Chaque écran écrivait le sien et il en existait quatre variantes. La
disposition est maintenant fixe et **ne se règle pas par props** :

- titre à gauche, lien de retour au-dessus, description en dessous ;
- **actions à droite dès `sm`, l'action principale (`default`) EN DERNIER**,
  donc à l'extrême droite ; les secondaires (`outline`) la précèdent ;
- sur téléphone, les actions passent sous le titre, en pleine largeur, et
  s'empilent à l'envers : la principale est la première sous le pouce ;
- un **filtre n'est pas une action** : il a sa rangée, sous le titre.

Les boutons d'en-tête font tous 44 px au doigt et 40 px à la souris
(`DialogueAction` s'en charge).

### `pied-formulaire.tsx` : une seule rangée de boutons

```tsx
<PiedFormulaire>
  <DialogClose render={<Button variant="outline">Annuler</Button>} />
  <Button type="submit">Enregistrer</Button>
</PiedFormulaire>
```

**Annuler (ou le refus) à gauche, l'action principale à droite**, le tout
groupé à droite ; sur téléphone, pleine largeur, 44 px, l'action principale
au-dessus. On écrit donc toujours : secondaire, puis principal. Cinq variantes
de ce bloc cohabitaient, et `DialogFooter` (bandeau grisé) n'était employé que
par certains dialogues : il ne l'est plus.

> ⚠️ **Une exception d'écriture, pas de rendu** : la carte de décision d'une
> demande de réassort porte deux boutons `submit` dans le même formulaire.
> Entrée dans un champ soumet avec le PREMIER dans le code, qui doit rester
> « Accorder ». La disposition commune y est obtenue par `flex-row-reverse`.

### `etat-vide.tsx`

Icône, message, et geste facultatif, là où il n'y avait qu'une ligne de texte
gris qui se lisait comme un chargement raté. `Tableau` l'emploie pour sa prop
`vide`.

### `lib/statuts.ts` : une couleur par sens

`VARIANTE_STATUT` donne la variante de pastille d'un statut de demande ou de
SAV : `alerte` (en attente), `succes` (accordé), `info` (partiel),
`destructive` (refusé), `outline` (annulé). Quatre écrans tenaient chacun leur
table. La couleur ne porte jamais l'information seule : le libellé est toujours
écrit dans la pastille.

### `cadre-auth.tsx`

Cadre commun aux écrans hors espace (connexion, mot de passe oublié,
changement de mot de passe, vérification, compte en attente) : marque, titre,
phrase, contenu, sortie.

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

**Le tri** est arrivé quand les listes sont devenues longues. Une colonne est
triable dès qu'elle déclare `tri` (la valeur BRUTE à comparer, un nombre ou un
texte, pas le rendu), et le tableau dès qu'il reçoit `tri` :

```tsx
{ cle: "du", entete: "Reste à verser", tri: (l) => Number(l.reste_a_verser), … }

<Tableau … tri={{ params, chemin: "/gestion/vendeurs" }} />
```

Il est **piloté par l'URL** (`?tri=du&ordre=desc`) et appliqué côté serveur,
pour une raison de structure et pas seulement de goût : les colonnes portent
des fonctions, qui ne traversent pas la frontière serveur → client. Un tableau
trié dans le navigateur obligerait chaque écran à devenir un composant client.
Deux tableaux triables sur un même écran se distinguent par `prefixe`. Sur
téléphone, où les cartes n'ont pas d'en-têtes, le tri passe par une rangée de
pastilles. La logique est dans `lib/tri.ts`, testée à part.

**À ne pas gonfler davantage** : ni sélection ni pagination ici. Un écran aux
exigences très différentes écrit son propre tableau.

### `champ-recherche.tsx` : la recherche, elle aussi dans l'URL

Un formulaire GET (`?q=`), qui reconduit les autres paramètres et repart de la
première page. La recherche part à la validation, pas à chaque frappe : chaque
frappe serait un aller-retour serveur.

- Sur une liste **entière en mémoire** (créances, stock, catalogue, ventes d'un
  vendeur), la page filtre avec `filtrer()` de `lib/tri.ts`, qui ignore la casse
  et les accents et exige tous les mots saisis.
- Sur le **journal comptable**, qui est paginé, la recherche est faite **en
  base** (`journal_transactions(p_recherche)`). Filtrer la page reçue ne
  chercherait que dans ses cinquante lignes en laissant croire qu'on a cherché
  partout.

> La recherche ne filtre que ce qu'on REGARDE. Sur l'État du stock, les alertes
> de seuil et les dialogues continuent de recevoir la liste complète : chercher
> « vanille » ne doit ni cacher une rupture, ni retirer des produits du
> formulaire de distribution.

### Exports CSV

`bouton-export.tsx` + un Route Handler par export
(`gestion/comptabilite/export`, `gestion/vendeurs/export`). Trois points qui ne
se devinent pas en lisant le fichier produit :

- **la garde est rappelée dans la route** (`exigerAdmin()`), comme dans toute
  Server Action : le layout ne protège que le rendu des pages ;
- **le journal est lu par pages jusqu'à épuisement** : la fonction plafonne à
  1 000 lignes par appel et PostgREST tronque au même seuil en silence. Un
  seul appel donnerait un export incomplet sans la moindre erreur ;
- **les cellules qui commencent comme une formule sont neutralisées**
  (`lib/csv.ts`). Un nom de client ou un motif de SAV est une saisie libre,
  ouverte ensuite dans un tableur : `=…`, `+…`, `-…`, `@…` y seraient exécutés.

Le format vise un Excel réglé en français : séparateur `;`, décimales à
virgule, BOM UTF-8. Le bouton est un `<a>` et non un `<Link>`, qui
préchargerait l'export au survol.

### Graphiques du Bilan

`graphiques/courbe-ca.tsx` et `graphiques/barres-vendeurs.tsx`, sans
dépendance.

- **Une seule couleur par graphique** : chacun porte une seule mesure. Colorer
  chaque vendeur ferait chercher un sens à des teintes qui n'en ont pas.
- **La courbe retombe sur l'indicateur.** `ca_par_jour()` reprend la définition
  de `bilan_global().ca` (net des remboursements SAV, comptés à leur date) ; un
  test pgTAP vérifie que la somme de l'une égale l'autre.
- **Les jours sans vente valent zéro** au lieu d'être sautés, et la période est
  regroupée par semaine au-delà de deux mois, par mois au-delà de treize
  (`lib/serie.ts`).
- **Le tracé est en SVG étiré, tout le texte est en HTML** placé en pourcentage
  sur la même zone : le graphique suit la largeur de l'écran sans mesure ni
  JavaScript, et le texte n'est pas déformé.
- La courbe se lit au survol, au doigt et **au clavier** (flèches), et un
  tableau replié donne les mêmes chiffres.

### `squelette-page.tsx` et les `loading.tsx`

Toutes les pages lisent la base à chaque visite : sans écran de chargement, un
clic dans la navigation ne produisait rien jusqu'à la réponse du serveur. Les
`loading.tsx` montrent la silhouette de l'écran attendu (indicateurs, tableau
ou tuiles, aux mêmes paliers de colonnes), ce qui évite le saut de mise en page
à l'arrivée des données. L'en-tête et la navigation ne bougent pas.

### L'écran État du stock porte les trois gestes du stock

Ils sont rangés là parce que c'est l'écran où l'on constate un problème de
stock, pas dans trois écrans différents :

Dans l'ordre d'affichage, de gauche à droite (le principal en dernier) :

| Bouton                  | Effet                                                    | Variante  |
| ----------------------- | -------------------------------------------------------- | --------- |
| **Ajuster le stock**    | écart de comptage, casse, perte — motif obligatoire      | `outline` |
| **Distribuer le stock** | entrepôt → un compte, sans demande préalable             | `outline` |
| **Nouveau Restock**     | achat fournisseur, unités en entrepôt **avec leur coût** | `default` |

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
vente garde ainsi ses 56 px sur téléphone, saisie debout (44 px à la souris).
Sans `tailleBouton`, le déclencheur fait 44 px au doigt et 40 px à la souris.
`icone` pose une icône lucide devant le libellé.

**Hauteurs : ne plus les régler écran par écran.** `Button` vaut 36 px par
défaut et 44 px en `lg`, `Input` 40 px ; `PiedFormulaire` et `DialogueAction`
portent leurs boutons à 44 px sur téléphone. Les `h-9` / `h-10` / `h-11`
posés au cas par cas donnaient deux boutons de tailles différentes dans un
même pied de dialogue.

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

`Kpi` donne la même forme à tous les chiffres clés de l'application. La
couleur y porte un sens : `accent` désigne LE chiffre de l'écran (un seul par
page, aplat primaire en clair, teinte diluée en sombre), `ton` colore la
pastille de l'icône et, pour `alerte` et `danger`, le chiffre lui-même. `href`
rend la carte entière cliquable vers l'écran qui détaille le chiffre, avec un
chevron pour le dire. Le bouton de thème est détaillé dans
[theme.md](theme.md).

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
- sur téléphone, où l'en-tête de colonnes est masqué, quantité et prix portent
  chacun un **libellé visible** au-dessus du champ : deux cases « 1 » et « 20 »
  ne disaient pas laquelle est la quantité ;
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
