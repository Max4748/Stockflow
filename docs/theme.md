# Thème clair / sombre

## Ce qui existait déjà avant qu'on l'active

L'initialisation shadcn avait laissé la moitié du travail en place, sans que ce
soit délibéré :

| Élément                                 | État avant activation                              |
| --------------------------------------- | -------------------------------------------------- |
| `next-themes`                           | déjà dans les dépendances                          |
| Bloc `.dark` dans `globals.css`         | complet                                            |
| Déclencheur                             | `@custom-variant dark (&:is(.dark *))`, par classe |
| `suppressHydrationWarning` sur `<html>` | déjà posé                                          |
| `sonner` (notifications)                | appelait déjà `useTheme()`                         |

Il ne manquait que le fournisseur et un bouton. Mais deux défauts auraient
rendu le résultat bancal (voir plus bas).

## Comportement

**Clair / Sombre / Système**, avec Système par défaut : l'application suit le
réglage du téléphone, donc elle passe en sombre le soir sans geste du vendeur.
Un choix manuel est mémorisé **par appareil** (`localStorage`) et prend le
dessus.

```tsx
// src/components/theme-provider.tsx
<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
```

`disableTransitionOnChange` : sans lui, toute transition CSS de la page s'anime
au moment de la bascule : un fondu général peu net plutôt qu'un changement net.

## Pourquoi il n'y a pas de flash de thème clair

`next-themes` injecte un script **bloquant** qui pose la classe `.dark` sur
`<html>` avant le tout premier rendu. Cela ne fonctionne que grâce au
`suppressHydrationWarning` posé sur `<html>` dans le layout racine. C'est **le
seul endroit du projet où cet attribut est légitime**, puisque c'est
précisément ce script qui modifie le DOM avant React. Le retirer casserait le
mécanisme.

## Le bouton ne porte aucun état React

Le réflexe habituel pour éviter la divergence d'hydratation (un
`useState(false)` remis à `true` dans un `useEffect`) casse les règles ESLint
du projet et ferait clignoter le bouton au chargement.

```tsx
// src/components/bouton-theme.tsx
<SunIcon className="scale-100 dark:scale-0" />
<MoonIcon className="absolute scale-0 dark:scale-100" />
```

Les **deux icônes sont rendues en permanence**, superposées ; c'est le CSS qui
décide laquelle se voit, via la classe `.dark`. Le balisage est identique
serveur/client (aucune divergence possible) et l'icône est correcte dès le
premier pixel affiché, avant même l'hydratation. `useTheme()` n'est lu que dans
le contenu du menu déroulant, qui ne se rend qu'à l'ouverture.

Placé dans les deux en-têtes (`vendeur/layout.tsx`, `gestion/layout.tsx`) et en
variante flottante (`BoutonThemeFlottant`) sur les trois pages qui vivent hors
layout (connexion, mot de passe provisoire, compte en attente), parce qu'un
vendeur qui arrive pour la première fois y passe avant d'atteindre son espace.

## Deux défauts corrigés avant l'activation

### La bordure des boutons était invisible

`--border` (utilisé par la variante `outline`) vaut `oklch(0.922)` sur fond
blanc, soit **1,26:1 de contraste**, très en dessous du seuil de 3:1 que demande
WCAG 1.4.11 pour délimiter un composant d'interface. C'est ce défaut qui a été
signalé (« le bouton blanc manque de visibilité »), avant même que le mode
sombre existe.

`--border` reste **inchangé** : il sert aussi à 39 traits volontairement
discrets (cartes, séparateurs, lignes de tableau), où l'invisibilité relative
est voulue. Une couleur dédiée aux contours **cliquables** a été créée à côté :

```css
/* mode clair */
--bordure-interactive: oklch(0.66 0 0); /* 3,11:1 sur blanc */
/* mode sombre */
--bordure-interactive: oklch(0.54 0 0); /* voir ci-dessous */
```

Un seul point de modification dans `button.tsx` (variante `outline`) répercute
la correction sur les 41 boutons de l'application.

### La valeur sombre n'avait jamais été mesurée

Une première valeur (`oklch(0.52)`) avait été posée par estimation. Calculée
après coup contre les trois surfaces réelles (fond, carte, dialogue ; la
dernière étant la plus claire donc la plus exigeante) :

| Surface  | `oklch(0.52)`           | `oklch(0.54)` retenu |
| -------- | ----------------------- | -------------------- |
| Fond     | 3,38:1                  | 3,68:1               |
| Carte    | 3,03:1                  | 3,29:1               |
| Dialogue | **2,90:1**, insuffisant | 3,16:1               |

La leçon : quand un seuil normatif est invoqué dans un commentaire, il doit être
recalculé, pas estimé. L'écart de 0,02 sur `L` faisait passer une des trois
surfaces sous 3:1.

**Valeur pleine, pas un blanc transparent.** Une transparence donne un
contraste différent selon la surface sous-jacente, donc impossible à garantir
sur les trois à la fois.

### Les voiles de dialogue étaient invisibles en sombre

`dialog.tsx` et `sheet.tsx` posaient un voile à `bg-black/10`. Sur fond clair il
assombrit discrètement la page ; sur fond sombre, du noir à 10 % sur un fond
déjà quasi noir ne se voit pas : un dialogue aurait flotté sans séparation
visuelle du contenu. Corrigé en `bg-black/10 dark:bg-black/60`.

## Palette claire : un blanc cassé, pas un blanc pur

Le fond valait `oklch(1)`, comme les cartes et les popovers. Les trois
surfaces confondues, une carte ne se détachait de la page que par sa bordure,
et l'ensemble était dur à l'œil sur un écran lumineux.

Le fond descend à `oklch(0.98)`, soit `#f8f8f8`. Cartes et popovers **restent
blancs** : c'est ce qui les fait ressortir, exactement comme le thème sombre
les pose plus clairs que son fond.

| Surface | Sombre | Clair |
| --- | --- | --- |
| Fond | `0.185` | `0.98` |
| Carte | `0.235` | `1` |
| Popover | `0.25` | `1` |
| `--muted` | `0.3` | `0.97` |

Les deux thèmes étagent désormais leurs surfaces dans le même sens, en
s'éloignant du fond.

### Deux valeurs recalculées, dont une qui était déjà fausse

Assombrir le fond réduit le contraste de tout ce qui s'y pose. Les deux seuils
que ce document invoque ont donc été recalculés sur les **trois** surfaces, et
non sur le fond seul.

| Variable | Avant | Après | Fond | Carte | `--muted` | Seuil |
| --- | --- | --- | --- | --- | --- | --- |
| `--bordure-interactive` | `0.66` | **`0.645`** | 3,11 | 3,30 | 3,02 | 3:1 |
| `--muted-foreground` | `0.556` | **`0.545`** | 4,68 | 4,96 | 4,54 | 4,5:1 |

**La contrainte vient de `--muted`, pas de la carte ni du fond.** Un texte
sombre atteint son plus faible contraste sur la surface la plus SOMBRE des
trois, c'est-à-dire `--muted` à `0.97`. Raisonner sur la carte, la plus claire,
donne des chiffres flatteurs et faux.

Conséquence utile : **ces deux valeurs ne dépendent pas du fond.** `--muted`
ne bouge pas avec lui, donc ajuster la clarté de la page ne redemande aucun
calcul tant qu'on reste au-dessus de `0.97`. C'est aussi ce qui fixe le
plancher : sous `0.97`, les zones muettes se confondraient avec la page.

C'est ce calcul qui a révélé que `--muted-foreground` tombait déjà à **4,34:1
sur `--muted`**, sous le seuil, et **avant** ce changement de fond. Le fond
plus sombre n'a pas créé ce défaut, il a obligé à le regarder.

## Palette sombre : adoucie, pas le défaut shadcn

Le fond par défaut de shadcn (`oklch(0.145)`) est quasi noir, agressif sur écran
lumineux, et surtout **trop proche des cartes et des dialogues** : les blocs
ne se détachaient pas les uns des autres.

| Variable                               | Défaut shadcn | Retenu         | Raison                                              |
| -------------------------------------- | ------------- | -------------- | --------------------------------------------------- |
| `--background`                         | 0.145         | **0.185**      | moins agressif                                      |
| `--card`                               | 0.205         | **0.235**      | écart net au-dessus du fond                         |
| `--popover` (dialogues)                | 0.205         | **0.25**       | doit se lire _au-dessus_ d'une carte                |
| `--secondary` / `--muted` / `--accent` | 0.269         | **0.30**       | survols et remplissages plus francs                 |
| `--muted-foreground`                   | 0.708         | **0.72**       | texte secondaire, 6,4–7,5:1 mesuré selon la surface |
| `--border`                             | 10 % blanc    | **12 % blanc** | séparation de cartes un peu plus nette              |

Les couleurs de graphiques (`--chart-*`) sont identiques en clair et en sombre
dans le fichier ; l'application n'affiche aucun graphique, donc sans impact.

## Contrôle qui ne peut pas être automatisé

Le thème est posé par une classe **côté navigateur**. Tout ce qui précède se
vérifie par script (contraste, présence des règles CSS, absence d'erreur
d'hydratation) ; le seul jugement qui reste humain est de basculer les trois
états dans l'interface et de regarder si un dialogue ouvert, une carte, un
badge de statut restent lisibles et bien séparés.
