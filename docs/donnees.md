# Modèle de données et règles comptables

20 tables, 4 vues, 83 fonctions, 28 politiques RLS. Le SQL fait référence : les
fichiers de `supabase/schema/` sont commentés, et chaque objet n'y est défini
qu'une fois.

## Les tables

| Table                                 | Rôle                                                               |
| ------------------------------------- | ------------------------------------------------------------------ |
| `roles`                               | dev (3), gerant (2), vendeur (1) : les rôles sont de la **donnée** |
| `profils`                             | un par compte, porte le rôle et la commission courante             |
| `invitations`                         | pré-autorise une adresse avant sa première connexion               |
| `produits`                            | catalogue                                                          |
| `restocks` + `restock_lignes`         | achats fournisseur                                                 |
| **`mouvements_stock`**                | **le registre**, voir ci-dessous                                   |
| `ventes` + `vente_lignes`             | ventes, avec les valeurs figées                                    |
| `demandes_restock` + `demande_lignes` | réassorts demandés par les vendeurs                                |
| `versements`                          | ce qu'un vendeur a reversé                                         |
| `sav`                                 | les défaillances, rattachées à leur vente                          |

## Modèles et parfums

Le catalogue a **deux niveaux, et un seul est une unité de stock.**

Un modèle (« JNR Falcon X 18K ») existe en plusieurs parfums, et le stock se
compte par parfum — « 3 mangue, 5 menthe », jamais « 8 Falcon X ». C'est donc le
parfum qui vit dans `produits`, et les **219 références à `produit_id`**
réparties sur dix tables et vues — mouvements, ventes, SAV, prélèvements,
réassorts — ne le savent même pas. Le CUMP et la comptabilité ignorent que les
modèles existent.

`modeles` ne porte que ce qui lui appartient vraiment :

| Colonne | Pourquoi elle est ici et pas sur le parfum |
| --- | --- |
| `prix_vente_conseille` | tous les parfums d'un modèle valent le même prix |
| `seuil_parfum` | saisi une fois, évalué parfum par parfum |
| `seuil_modele` | c'est une propriété du modèle par définition |

**Pourquoi une table et non une colonne `modele` sur `produits`.** Ces trois
attributs y auraient été recopiés sur chaque parfum : huit copies du prix pour
huit parfums, sans autorité sur celle qui fait foi, et un changement de prix qui
doit toucher huit lignes ensemble. Une colonne texte n'a par ailleurs aucune
intégrité référentielle — « Falcon X » et « falcon x » deviendraient deux
familles en silence. Tant que le regroupement était facultatif c'était
supportable ; obligatoire, non.

L'unicité change de **portée** au passage : un parfum est unique dans son
modèle, pas dans tout le catalogue. Sans ça, deux modèles ne pourraient pas
avoir une « Mangue ». Le `sku`, lui, reste unique globalement : c'est une
référence commerciale.

### Deux seuils, deux questions

`seuil_parfum` dit **quel parfum manque**, `seuil_modele` dit **si le modèle
s'éteint**. Un modèle peut aller bien avec un parfum en rupture (0 mangue,
20 menthe), et être bas sans qu'aucun parfum ne le soit (trois parfums à 2, seuil
parfum 1, seuil modèle 10). Les deux cas sont fixés par
`src/lib/format.test.ts`.

`seuil_modele = 0` **désactive** l'alerte de modèle, et c'est le défaut : un
catalogue repris ne doit pas se mettre à crier au premier déploiement. Une
rupture totale reste une rupture — ce n'est pas un seuil, c'est un fait.

Le total du modèle se calcule **côté client** (`niveauModele`, `src/lib/format.ts`)
et non en SQL : les écrans groupent déjà par modèle pour l'affichage, donc la
somme y est gratuite, et ça évite de tenir une seconde agrégation SQL en
parallèle de `niveauStock`. À quelques dizaines de produits c'est le bon
compromis ; au millier, l'agrégat devrait redescendre en base.

### Ce qu'un modèle désactivé emporte

Désactiver un modèle désactive ses parfums. Ce n'est pas une commodité : le prix
vit sur le modèle, donc un parfum dont le modèle est éteint n'a plus de prix et
ne peut pas être vendu. Les laisser actifs les ferait apparaître dans les listes
de saisie sans tarif.

### La reprise d'un catalogue plat

Chaque produit d'avant devient **un modèle à un seul parfum**, portant son propre
nom, son prix et son seuil. Le gérant regroupe ensuite à la main : deviner que
« Falcon X Mangue » et « Falcon X Menthe » sont un même modèle serait une
supposition sur ses données, pas une conversion.

## Le registre de mouvements

**Le stock n'est jamais une colonne.** Il est dérivé par somme de
`mouvements_stock`, table à quantité **signée**.

```
positif = entrée chez le détenteur     négatif = sortie
```

Six types : `entree_achat`, `transfert`, `vente`, `retour`, `ajustement`, `sav`.

### `detenteur_id NULL` = l'entrepôt

Choix délibéré, contre l'alternative « le profil du patron détient le stock
central » :

- l'entrepôt n'est pas une personne : changer de gérant ne doit pas déplacer le
  stock ;
- surtout, la politique `detenteur_id = auth.uid()` exclut **gratuitement** les
  lignes d'entrepôt de la vue d'un vendeur, puisque `NULL = uuid` n'est jamais
  vrai. L'isolation vient de la logique SQL à trois valeurs, pas d'une condition
  à maintenir.

**Piège corollaire** : toute comparaison de détenteur doit utiliser
`is not distinct from`, car `detenteur_id = NULL` vaut toujours NULL. C'est
pourquoi la fonction `stock_detenu()` existe. Ne pas comparer à la main.

### Les déplacements ont deux jambes

Un transfert ou un retour écrit **deux lignes** de somme nulle, appariées par
`groupe_id` : le stock total de la maison ne change pas, il change de mains.

Deux chemins produisent un transfert, tous deux à deux jambes :
`traiter_demande_restock()` quand le détenteur l'a demandé, et
`transferer_stock()` quand le gérant en prend l'initiative.

### N'importe quel compte actif peut détenir du stock

`detenteur_id` référence `profils`, **sans contrainte de rôle** : un gérant qui
vend sur le terrain reçoit du stock et le décrémente exactement comme un
vendeur. Aucune fonction de l'espace vendeur ne teste le rôle : elles sont
gardées par `est_actif()`, ce qui suffit.

Ce qui change pour un compte d'encadrement tient en une ligne : **il n'a jamais
de créance** (voir plus bas), parce qu'il encaisse pour la maison.

### Pourquoi dériver plutôt que stocker

1. Le cahier des charges exige un historique détaillé des transactions : il faut
   un journal de toute façon. Entretenir en plus une colonne `quantite`
   créerait deux vérités, qui divergeront le jour où une écriture échouera à
   mi-chemin.
2. Un stock dérivé ne peut pas être « réparé » à tort : une incohérence devient
   visible au lieu d'être écrasée.

Contrepartie assumée : l'agrégat coûte une somme. Deux index couvrants la
rendent quasi gratuite (parcours d'index seul). Le point de bascule est vers le
million de lignes ; la réponse sera alors un **instantané mensuel**, surtout
pas une colonne `quantite`.

## Le figeage comptable

À l'enregistrement d'une vente, trois valeurs sont **copiées** dans la ligne :

| Colonne               | Source                                      |
| --------------------- | ------------------------------------------- |
| `prix_vente_unitaire` | saisi par le vendeur                        |
| `commission_unitaire` | `profils.commission_unitaire` à cet instant |
| `cout_unitaire`       | coût moyen pondéré à cet instant            |

Une écriture comptable ne bouge plus jamais. Changer la commission d'un vendeur
ou le prix d'un fournisseur demain **ne réécrit pas les dettes d'hier**.

C'est aussi ce qui rend l'annulation d'une vente inoffensive pour les autres :
leurs coûts sont figés, ils ne dépendent pas de celle qu'on supprime.

## Le coût moyen pondéré (CUMP)

```
coût = (valeur achetée − valeur déjà sortie) / (unités achetées − unités sorties)
```

Repli sur le dernier prix d'achat connu si le stock est épuisé. Sans ce repli,
une vente juste après épuisement figerait un coût de 0 et afficherait une marge
de 100 %.

`prix_achat_unitaire = (prix_achat_base + frais_port) / quantite_totale` : le
coût de revient **inclut l'acheminement**, sinon la marge est surévaluée.
Stocké sur 4 décimales, parce qu'une division par 250 unités ne tombe pas juste
au centime et qu'arrondir là décalerait toutes les marges.

**Le CUMP est global, pas par détenteur.** Le coût d'achat est une propriété de
la marchandise, pas de qui la détient ; un transfert n'est pas une vente et ne
revalorise donc rien.

> À savoir énoncer au gérant : la marge **par vente** est lissée, un vendeur
> qui écoule du vieux stock bon marché étant valorisé au coût moyen courant. La
> marge **globale** et **par période** restent exactes au centime. C'est la
> nature du CUMP, pas un défaut d'implémentation.

## La dette d'un vendeur

Modèle **« commission à la vente »** : le vendeur encaisse le client, garde sa
commission, reverse le solde.

```
dû = Σ(ventes) − Σ(qté × commission figée) − Σ(versements)
     − Σ(remboursements SAV) + Σ(prélèvements)
```

**Un seul terme s'ajoute**, tous les autres retranchent : le prélèvement, seul
cas où de la marchandise sort sans qu'un client ait payé.

La dette naît **à la vente**, jamais au transfert : le stock non vendu qu'il
détient ne lui est pas compté.

Les comptes non-vendeurs sont neutralisés à 0. Sans cela, le chiffre d'affaires
d'un gérant apparaîtrait comme une dette envers lui-même.

Ses ventes comptent en revanche **partout ailleurs** : chiffre d'affaires, coût
des marchandises et marge du bilan les incluent. `creances()` et
`revenus_vendeurs()` le font donc figurer dès qu'il a vendu, sans quoi la somme
du tableau des vendeurs ne recouperait plus le bilan. `montant_a_recuperer`
garde, lui, son filtre sur les seuls vendeurs : il n'y a rien à récupérer auprès
de quelqu'un qui encaisse pour la maison.

> **Effet de bord réel** : corriger une vente à la baisse après qu'un vendeur a
> déjà reversé son solde produit une **dette négative**, c'est-à-dire un crédit
> en sa faveur. C'est comptablement juste.

### Prélèvements : la dette monte, le chiffre d'affaires non

Un vendeur repart avec de la marchandise pour lui. Il n'a rien encaissé, donc il
doit le tarif convenu.

**Ces lignes ne vivent pas dans `ventes`, et c'est le point qui compte.** Le
chiffre d'affaires doit rester ce que des clients ont payé : y verser la
consommation interne fausserait le CA, la marge et le nombre de ventes affichés
à tout le monde, sans qu'aucune erreur ne se déclare. La dette, elle, ne fait pas
la différence — de l'argent dû est de l'argent dû.

Le tarif est un couple **(vendeur, produit)**. `prix_preleves` ne contient que
les exceptions ; le repli est calculé :

```
prix_vente_conseille − commission_unitaire
```

Ce repli n'est pas arbitraire : c'est **exactement ce qu'un vendeur devrait à la
maison après avoir vendu l'unité au prix conseillé et gardé sa commission**.
Prélever au tarif par défaut coûte donc le même prix que vendre. Le calcul est
plancher à 0, sans quoi une commission supérieure au prix conseillé donnerait un
tarif négatif — une dette qui diminue en prenant de la marchandise.

Le tarif est **figé à la prise**, comme la commission d'une vente : le changer
plus tard ne réécrit aucune dette déjà constituée.

Trois choix de portée, tous vérifiés par `supabase/tests/15_prelevements.sql` :

| Règle | Pourquoi |
| --- | --- |
| Réservé au rôle `vendeur` | `mvt_coherence` exige un détenteur nommé, or un compte lié à l'entrepôt n'en a pas ; et `reste_a_verser` vaut 0 pour un non-vendeur, donc la dette ne serait comptée nulle part |
| La sortie vient du stock **détenu**, jamais de l'entrepôt | un prélèvement n'est pas un réassort déguisé |
| L'annulation est réservée aux gérants | laisser un débiteur effacer sa propre dette n'a pas de sens |

## Le service après-vente

Un SAV est **rattaché à une vente**, jamais flottant : c'est ce qui permet de
répondre à « cette vente a-t-elle posé problème ? ». Un ajustement de stock
motivé ferait baisser le stock tout aussi bien, mais ne se rattacherait à rien.
D'où une table et un sixième type de mouvement plutôt qu'un motif conventionnel.

**Règle métier : la maison assume la perte.** Deux dénouements :

|                   | Stock                                                  | Chiffre d'affaires | Dette du vendeur   |
| ----------------- | ------------------------------------------------------ | ------------------ | ------------------ |
| **Échange**       | −1 unité neuve, du stock du vendeur (ou de l'entrepôt) | inchangé           | inchangée          |
| **Remboursement** | inchangé                                               | − le montant rendu | − le montant rendu |

Trois choses **ne bougent pas**, et ce sont les plus importantes :

- **la vente d'origine.** Une écriture comptable ne se réécrit pas : un SAV est
  un _événement postérieur_, pas une correction de saisie. Corriger la vente
  aurait de surcroît effacé la question à laquelle le SAV doit répondre ;
- **la commission du vendeur.** Il a fait son travail, la défaillance ne vient
  pas de lui. Conséquence arithmétique à connaître : _un remboursement intégral
  rend sa dette négative à hauteur de sa commission_, c'est-à-dire un crédit en
  sa faveur. C'est exactement ce que « la maison assume » veut dire ;
- **l'article défaillant**, qui ne revient jamais en stock vendable. Il a quitté
  le stock à la vente et n'y rentre pas. Un remboursement n'écrit donc **aucun**
  mouvement ; seul l'échange en écrit un, pour l'unité de remplacement.

### L'égalité qui doit rester vraie à l'écran

```
marge nette = chiffre d'affaires − coût des marchandises − commissions
```

Le SAV entre par deux portes distinctes pour la préserver : les remboursements
sont retranchés du **chiffre d'affaires** (l'argent est reparti), le coût figé
des unités échangées est ajouté au **coût des marchandises** (la maison a offert
la marchandise). Toute évolution de `bilan_global()` doit reconduire cette
égalité : quatre indicateurs qui ne se recoupent plus sont pires que faux, ils
sont invérifiables.

Le SAV est daté de **son** jour, pas de celui de la vente : un remboursement de
janvier sur une vente de décembre appartient à janvier.

### Qui déclare, et ce que ça déclenche

Le vendeur est le seul à constater la panne : il déclare depuis son espace. Mais
un SAV touche à deux choses qui lui appartiennent : son stock et sa dette. D'où
**deux régimes, déduits en base de qui appelle et du dénouement**, jamais d'un
paramètre que l'appelant pourrait choisir :

| Déclaré par      | Échange              | Remboursement              |
| ---------------- | -------------------- | -------------------------- |
| **Gérant / dev** | validé               | validé                     |
| **Vendeur**      | validé immédiatement | **en attente** d'arbitrage |

L'échange est immédiat parce que le vendeur **a déjà remis l'unité au client**.
Refuser de l'écrire ferait mentir son stock jusqu'au passage d'un gérant. Le
risque est assumé et borné : la quantité ne peut pas dépasser ce que la vente
contenait, le dossier est nominatif, daté, motivé, et il apparaît dans l'écran
SAV comme dans le journal.

Le gérant garde deux recours, qui ne servent pas au même usage :

| | Effet sur le stock | Effet sur le dossier | Quand |
| --- | --- | --- | --- |
| `revoquer_sav()` | l'unité revient à son détenteur | conservé, statut `refuse`, **motif obligatoire** | désaccord : l'échange paraît abusif |
| `supprimer_sav()` | idem, par `on delete cascade` | effacé | saisie franchement erronée |

Le premier est la règle, le second l'exception. La raison tient en une phrase :
un abus se reconnaît à sa **répétition**, et un recours qui efface le dossier
efface précisément ce qui permettrait de la constater. C'est le même principe
que pour un remboursement refusé, conservé plutôt que supprimé parce qu'il fait
partie de la relation avec le vendeur.

Un remboursement révoqué ne demande, lui, aucune arithmétique : tous les
agrégats filtrent sur `statut = 'valide'`, donc le passage à `refuse` rend seul
son montant au chiffre d'affaires et à la dette.

Le remboursement attend, parce que c'est de l'argent **et qu'il diminue la dette
de celui qui le déclare**. Tant qu'il est en attente, il ne produit rien : ni le
chiffre d'affaires ni la dette ne bougent. Les agrégats filtrent tous sur
`statut = 'valide'`.

Quatre statuts : `valide`, `en_attente`, `refuse` (le gérant tranche, avec un
motif que le vendeur voit), `annule` (le vendeur retire sa demande). Un refus
est **conservé** plutôt que supprimé : il fait partie de la relation avec le
vendeur, exactement comme une demande de réassort refusée.

### Comment le vendeur apprend la décision

Un écran ne suffit pas : il faut y penser. `profils.sav_vu_le` retient sa
dernière consultation, et `sav_non_vus()` compte ce qui a bougé depuis,
**à deux conditions** :

```sql
coalesce(s.traite_le, s.cree_le) > coalesce(v_vu, '-infinity')
and coalesce(s.traite_par, s.cree_par) is distinct from auth.uid()
```

La seconde est ce qui rend la pastille utile. Sans elle, elle s'allumerait sur
ses propres déclarations (il sait déjà) et deviendrait un bruit qu'on apprend
à ignorer. Avec, elle ne signale que ce qu'il n'a pas fait lui-même : une
validation, un refus, ou un SAV ouvert par le gérant sur une de ses ventes.

`marquer_sav_vu()` est `security definer` par nécessité : `grant update on
profils` existe, mais la policy `profils_admin_all` réserve l'écriture aux
gérants. La fonction n'écrit que `sav_vu_le`, et que sur la ligne de l'appelant.
Cette colonne ne sert **jamais** à une décision d'autorisation.

### Quand l'entrepôt est chez le gérant

`profils.stock_lie_entrepot` déclare qu'un compte
d'encadrement **est** l'entrepôt. Cas réel : le stock est physiquement chez le
gérant, et lui faire transférer de la marchandise vers lui-même avant chaque
vente décrivait un déplacement qui n'existait pas.

Le drapeau est **par compte**, pas global : un second gérant qui vend sur le
terrain reçoit du stock comme un vendeur. Une contrainte de table le réserve à
l'encadrement, et `changer_role` le baisse en cas de rétrogradation, faute de
quoi celle-ci échouerait sur un message de contrainte illisible.

Il ne change que deux choses :

| Fonction | Ce qui change |
| --- | --- |
| `stock_disponible()` | lit l'entrepôt au lieu du stock détenu, via `source_stock()` |
| `enregistrer_vente()` | prend dans l'entrepôt ce qui manque au vendeur |

**Le transfert est écrit, pas contourné.** La contrainte `mvt_coherence`
impose qu'une vente sorte d'un détenteur nommé. L'assouplir pour
ce cas aurait affaibli un invariant qui tient pour tout le monde, afin
d'épargner deux lignes au registre. La vente écrit donc elle-même les deux
jambes du transfert, puis la sortie. Le geste disparaît de l'écran du gérant,
il reste dans le journal, où il décrit ce qui s'est réellement passé : la
marchandise a quitté l'entrepôt, puis le client l'a emportée.

L'ordre de verrouillage est celui de `transferer_stock` : entrepôt d'abord,
détenteur ensuite. En dévier produirait des interblocages intermittents entre
une vente et un transfert simultanés.

**L'annulation d'une vente doit rendre l'unité à l'entrepôt.** Le
`on delete cascade` d'`origine_vente_id` n'efface que la sortie de vente : les
deux jambes du transfert portent un `groupe_id`, pas une origine de vente, et
survivent. Sans retour explicite, les unités restaient chez le gérant, où
elles sont invisibles et invendables puisque `stock_disponible()` lui montre
l'entrepôt. Le total de la maison restait juste, donc
`verifier_coherence_stock()` ne signalait rien : c'est le genre de défaut
qu'aucun invariant global n'attrape.

Le retour est **écrit et motivé**, pas obtenu en supprimant le transfert.
Rattacher ses jambes à `origine_vente_id` les aurait fait tomber en cascade
sans une ligne de code, mais le registre n'aurait plus rien montré, et une
annulation est justement le moment où l'on veut lire ce qui s'est passé.

Ce que le drapeau ne change **pas** : le SAV (`declarer_sav` a son propre
`p_depuis_entrepot`), la dette (elle vaut déjà 0 pour un
non-vendeur), et l'attribution des ventes, qui restent les siennes.

### Comment le gérant apprend qu'il s'est passé quelque chose

Le même mécanisme, symétrique. Il manquait, et c'est ce qui
rendait le recours du gérant théorique : `sav_non_vus()` filtre sur
`ventes.vendeur_id = auth.uid()`, autrement dit c'est la pastille du **vendeur**.
Côté gestion, un échange déclaré par un vendeur ne produisait aucun signal,
puisqu'il est validé d'emblée et n'attend donc aucune décision.

`sav_gestion_non_vus()` reprend les deux conditions de `sav_non_vus` et en change deux
autres :

| | Pastille vendeur (`sav_non_vus`) | Pastille gestion (`sav_gestion_non_vus`) |
| --- | --- | --- |
| Périmètre | ses ventes à lui | **tous** les vendeurs |
| Statuts comptés | tous | **`valide` seulement** |
| Colonne de visite | `profils.sav_vu_le` | `profils.sav_gestion_vu_le` |

Deux colonnes distinctes parce qu'un gérant vend aussi : les confondre
éteindrait sa pastille de gestion au motif qu'il a consulté ses propres
dossiers, deux questions qui n'ont rien à voir.

Et le filtre sur `valide` parce que l'`en_attente` est **déjà** compté par la
pastille du layout, celle qui répond à « qu'est-ce qui attend ma décision ? ».
Les deux ensembles restent ainsi disjoints, et leur somme sur l'onglet SAV ne
compte jamais deux fois le même dossier.

### Les garde-fous, tous en SQL

- un vendeur n'ouvre un dossier que sur **ses** ventes ;
- pas plus d'unités en SAV que la vente n'en contient, **cumul compris** : les
  dossiers en attente sont comptés, sans quoi déclarer deux fois la même unité
  avant l'arbitrage passerait les deux fois ;
- pas de remboursement supérieur à ce que le client a payé pour ces unités-là ;
- motif obligatoire (« SAV » seul n'explique rien six mois plus tard) ;
- pour un échange : verrou pris **avant** lecture, puis contrôle du stock ;
- un dossier déjà tranché ne se retranche pas (verrou de ligne + contrôle de
  statut, y compris sur double-clic).

`supprimer_sav()` annule un dossier saisi par erreur ; le `on delete cascade`
du mouvement rend l'unité échangée à son détenteur d'origine.

## Les trois invariants que le SQL ne peut pas garantir

Une contrainte `CHECK` porte sur **une ligne**, pas sur une somme. Ces trois
propriétés portent sur des agrégats :

1. un stock ne devient jamais négatif ;
2. les deux jambes d'un déplacement s'annulent ;
3. l'en-tête d'une vente reflète ses lignes.

Elles sont tenues par la chaîne **« écriture par fonction uniquement + verrou
pris avant lecture »**, et vérifiées _a posteriori_ par
`verifier_coherence_stock()`, exposée par l'écran Intégrité réservé au dev.

### La règle de revue qui compte

> Tout nouveau chemin d'écriture du stock doit répondre oui à :
> **prend-il le verrou AVANT de lire le stock ?**

`verrouiller_stock(produit, détenteur)` sérialise les écritures concurrentes.
Sans lui, deux ventes simultanées lisent le même stock disponible et le total
peut passer sous zéro. **Ordre de verrouillage imposé**, sous peine
d'interblocage intermittent : produits par `produit_id` croissant, et pour un
même produit l'entrepôt (NULL) avant un vendeur.

## Correction des ventes

Fenêtre de **48 h** (`fenetre_correction()`, définie en un seul endroit). Au-delà,
seul un gérant intervient, sans limite de temps pour lui.

`modifier_vente()` **défait puis refait**, dans la même transaction. Deux
sous-décisions inscrites dans le SQL :

- **le coût est refigé** au CUMP courant : après suppression des anciens
  mouvements, le coût se recalcule comme si la vente n'avait jamais existé, donc
  c'est la seule valeur auto-cohérente. Conserver l'ancien coût serait de toute
  façon impossible pour une quantité _ajoutée_, qui n'en a pas ;
- **la commission reste celle d'origine** : c'est un terme contractuel au moment
  de la vente, une correction ne le renégocie pas.

Le garde-fou qui refusait l'annulation dès qu'une vente postérieure du même
produit existait est **levé dans la fenêtre**. Justification : les coûts déjà
figés des autres ventes ne changent pas, c'est tout l'intérêt du figeage. Seul
le coût moyen _courant_ se recale, donc les ventes à venir. Il reste conservé
au-delà de la fenêtre, où une annulation est rare et mérite un ralentisseur.

### Ce qui est effacé laisse une trace

Le journal comptable est **dérivé de l'état courant** : il lit `ventes`,
`restocks`, `versements`, `sav`. Conséquence directe, tout ce qu'une
suppression retire disparaît aussi du journal. Un achat de 345 € annulé
changeait les totaux sans laisser la moindre ligne pour l'expliquer.

`journal_operations` enregistre le **geste**, pas l'entité :
qui, quoi, quand, et de quoi il s'agissait. Sept fonctions l'alimentent.

| Fonction | Ce que la trace conserve |
| --- | --- |
| `supprimer_restock` | la référence, les unités, le total payé |
| `modifier_restock` | l'état d'avant, introuvable ailleurs après coup |
| `supprimer_versement` | le montant, et le vendeur dont la dette remonte |
| `supprimer_sav` | le motif, que la suppression efface |
| `revoquer_sav` | le motif du refus, le dossier sortant du journal |
| `modifier_vente` | les unités, le montant et le client d'avant |
| `retirer_produit` | le nom, et lequel des deux dénouements a eu lieu |

**Le libellé est rédigé pendant que l'entité existe.** Le reconstruire après le
`delete` serait impossible, et c'est tout l'objet de la table. C'est aussi la
propriété la plus facile à casser sans que rien n'échoue : une trace vide
s'écrit sans erreur.

Une archive par type supprimé aurait demandé sept tables jumelles à tenir à
jour. Ici on n'archive pas l'entité, on enregistre ce qui a été fait.

**Deux journaux, deux portées.** `journal_admin` est réservé au dev, parce
qu'il dit qui surveille qui. `journal_operations` regarde tout l'encadrement :
un achat annulé est une opération comptable, pas une action d'administration.

### Une vente annulée reste visible

`ventes_annulees` archive l'en-tête d'une vente au moment de
son annulation. Les deux listes de ventes et les deux journaux la réaffichent,
barrée et taguée ; aucun agrégat ne la voit plus.

**Une archive, et non un drapeau `annulee_le` laissé dans `ventes`.** C'est le
choix qui structure tout le reste. Vingt-et-une fonctions et deux vues lisent
`ventes` ou `vente_lignes` : le chiffre d'affaires, les commissions, la dette,
le bilan, les revenus par vendeur, et surtout `cout_moyen_pondere()`, qui déduit
les unités sorties. Un drapeau aurait demandé d'ajouter « et non annulée » aux
vingt-et-une, et en oublier une seule aurait faussé une dette ou une marge
**sans rien signaler**.

L'archive déplace le coût sur la LECTURE, où une omission se voit tout de suite
(la vente manque à l'écran), au lieu de la comptabilité, où elle ne se voit
jamais. Quatre fonctions de lecture ont été étendues, contre vingt-et-une à
auditer.

Seul l'**en-tête** est archivé : les deux listes n'affichent jamais le détail
des lignes. Archiver ce qui n'est jamais lu serait de la dette sans usage.

Conséquence à connaître : une vente annulée ne peut plus porter de SAV ni être
corrigée, ses lignes ayant disparu. C'est voulu, et `corrigeable` vaut faux
pour elle.

### Archive typée ou ligne de journal : la question tranchée une fois

`ventes_annulees` et `journal_operations` répondent au même moment — une entité
disparaît — et il est tentant de n'en garder qu'une. Ce serait une erreur, et
voici la règle qui l'évite :

> Une entité qui doit rester **affichable dans sa propre liste** reçoit une
> archive typée. Une entité dont la disparition doit seulement être
> **expliquée** reçoit une ligne de journal.

Ce que la fusion coûterait, concrètement. La branche `union all` de
`mes_ventes()` rend `a.id, a.date, a.client, a.quantite_totale, a.montant_total,
a.cree_le, …` : une vente annulée occupe **exactement la forme de ligne d'une
vente vivante**, et c'est ce qui lui permet de s'afficher dans le même tableau,
barrée. `journal_operations` porte un `libelle text` déjà rédigé, dont le
commentaire de la table dit que le reconstruire après coup serait impossible.
Faire tenir la première dans la seconde demanderait d'ajouter quatre colonnes
propres aux ventes à une table volontairement générique.

Et il n'y a rien à dédupliquer : `supprimer_vente` n'appelle **pas**
`tracer_operation`. Une vente annulée n'est écrite que dans `ventes_annulees`.
Les gestes qui, eux, ne laissent qu'une ligne de journal sont ceux dont l'entité
n'a pas de liste où revenir : suppression d'un produit, d'un versement, d'un
achat, d'un dossier SAV.

## Organisation du schéma

`supabase/schema/`, **rejoué intégralement à chaque exécution** :
`create table if not exists`, `create or replace`, `drop policy if exists`.
Cinq couches, appliquées dans l'ordre des noms de dossier puis des noms de
fichier — c'est le système de fichiers qui porte l'ordre, aucune liste n'est
tenue à jour à côté.

| Couche | Contenu | Ce que sa position garantit |
| --- | --- | --- |
| `10_types_et_tables/` | types énumérés, tables, contraintes, index, RLS | rien n'existe avant |
| `20_fonctions/` | les 83 fonctions, une seule définition chacune | après les tables qu'elles lisent |
| `30_vues_et_triggers/` | les 4 vues, le trigger d'inscription | `v_lignes_vente` appelle `est_admin()`, le trigger appelle `gerer_nouvel_utilisateur()` |
| `40_droits/` | policies, grants et revokes, commentaires | les 28 policies citent `est_admin` / `est_dev` / `est_actif` |
| `90_donnees/` | amorçage, reprises de données | tout le schéma est en place |

À l'intérieur d'une couche, l'ordre alphabétique suffit — sauf dans `10`, où les
noms sont numérotés selon les **clés étrangères** : `mouvements_stock` référence
`ventes`, `restocks` et `sav`, donc il vient après les trois, quel que soit le
domaine auquel il appartient par ailleurs.

### Pourquoi ce découpage plutôt que des migrations numérotées

Le dossier `migrations/` empilait deux natures incompatibles. Ce qui est
**incrémental** — une table, une colonne, un type — a un ordre porteur et ne
peut pas être remplacé. Ce qui est **idempotent** — une fonction, une vue, une
policy — s'écrit avec `create or replace` : l'ordre n'a aucune valeur, et
l'historique est déjà dans git.

Empiler les secondes comme les premières produisait des doublons : **125
définitions de fonctions pour 74 fonctions**. `journal_transactions` était
écrite six fois, de `0008` à `0037`, et seule la sixième comptait sans que rien
ne le dise à celui qui lit. 51 définitions sur 125 s'exécutaient au rejeu pour
se faire écraser aussitôt.

Le découpage a aussi corrigé un défaut que personne ne pouvait voir en lisant :
`revoke all on all tables in schema public from anon` ne couvre que les tables
existant à cet instant. Placé au milieu de la pile, il laissait `select` à
`anon` sur les cinq tables créées par des migrations postérieures — `sav`,
`ventes_annulees`, `journal_admin`, `journal_operations`, `ip_bloquees` —
jusqu'à la deuxième application. **Un premier déploiement était donc plus
permissif que la production.** En couche `40`, le revoke passe après toutes les
tables et les couvre toutes, dès la première passe.

### La règle qui reste : toute table pose sa RLS, toute fonction pose son grant

Une table sans RLS serait ouverte à tout détenteur d'un `grant` sans qu'aucune
erreur ne le signale ; une fonction sans `grant execute` ne serait appelable par
personne. Le filet est l'inventaire de `appliquer-schema.sh`, ligne
« tables SANS RLS (doit valoir 0) ».

### L'empreinte de schéma

`supabase/empreinte-schema.sh` rend un texte trié et déterministe décrivant tout
le schéma `public` : colonnes, contraintes, index, enums, corps de fonctions,
vues, triggers, RLS, policies, **droits**, commentaires. `diff` suffit à
comparer deux bases.

`supabase/empreinte-reference.txt` en est la version versionnée, et la CI refuse
tout écart. C'est ce qui a permis de remplacer 42 migrations par ce découpage en
prouvant que la base obtenue était identique à l'octet près, et c'est ce qui
empêche ensuite une dérive silencieuse — une contrainte, un `not null`, un
`revoke` perdus en réécrivant un fichier.

Les droits sont dans l'empreinte pour une raison précise : sur une base neuve,
PostgreSQL accorde `execute` à `PUBLIC` sur toute fonction créée. Un `revoke`
perdu ne casse rien de visible, aucun test de comportement ne bronche, et la
fonction devient appelable par `anon`. C'est le cas de `bloquer_ip`, fermée par
un `revoke` explicite.

Régénérer la référence après un changement voulu :

```bash
./supabase/empreinte-schema.sh > supabase/empreinte-reference.txt
```

### Une affirmation de garantie cite son test

Trois fois dans ce projet, un commentaire a promis une propriété de sécurité
que le code n'avait pas :

| Où | Affirmation | Réalité |
| --- | --- | --- |
| `bloquer_ip` | « le pire est de se bloquer lui-même » | `p_ip` est un paramètre libre : n'importe quelle adresse |
| `reinitialiser_donnees` | « deux verrous, et le second est le vrai » | le second était une constante publiée dans le dépôt |
| `14_reinitialiser.sql` | « le verrou qui compte n'est pas `est_dev()` » | c'est le seul qui compte |

Le point commun n'est pas l'inattention, c'est que **le commentaire décrivait
l'intention et non le code**. Personne ne l'a relu contre la fonction, parce
que rien n'y obligeait.

**La règle : une affirmation de garantie de sécurité cite le test qui la
tient, ou n'est pas écrite.** Le renvoi force la question « ce test
existe-t-il, et vérifie-t-il bien cela ? » au moment où la phrase est tapée,
c'est-à-dire au seul moment où elle est facile à poser.

Elle vise les propriétés **portantes**, pas les « jamais » de langue courante :
annoter les quarante occurrences noierait les trois qui comptent.

### `supautils` refuse un `delete` sans `where`

L'instance charge `supautils` en `session_preload_libraries`, qui arme
`safeupdate` pour les rôles non superutilisateur. Une suppression sans clause
`where` y échoue sur « DELETE requires a WHERE clause ».

```sql
set role authenticated;
delete from t;             -- ERROR: DELETE requires a WHERE clause
delete from t where true;  -- passe
```

**`security definer` n'y change rien** : il modifie l'utilisateur effectif, pas
les réglages de session, et c'est la connexion PostgREST qui les porte. Une
fonction propriété de `postgres` appelée par `authenticated` est donc soumise
au garde-fou.

Le seul endroit concerné est `reinitialiser_donnees`, dont la
suppression massive est l'objet même. Ses douze `delete` portent un
`where true` explicite, qui dit « oui, je sais ».

**Aucun test ne rattraperait sa suppression.** Le harnais pgTAP se connecte en
`postgres` et simule le rôle par `set role`, où `safeupdate` n'est pas armé :
le défaut n'apparaît qu'à travers l'application. C'est la seule règle de ce
document dont la violation ne casse aucun test.

### Changer les colonnes de sortie d'une fonction

`create or replace` **ne peut pas** modifier les paramètres `OUT` d'une fonction
(« cannot change return type of existing function »). Il faut la droper : ajouter
un `drop function if exists …(ancienne signature)` juste avant son
`create or replace`, dans le fichier de la fonction.

Même piège pour une **vue** : `create or replace view` ne sait qu'ajouter des
colonnes _en fin de liste_, et refuse d'en renommer une. Une colonne insérée au
milieu impose un `drop view if exists` avant le `create`.

Le découpage en couches a retiré les deux pièges qui rendaient l'opération
délicate du temps des migrations numérotées :

- le `drop` emporte le `grant execute`, mais la couche `40_droits` repose les
  82 `grant execute` **après** la couche `20_fonctions` : le droit revient tout
  seul ;
- il fallait aussi modifier le fichier d'**origine**, sinon le rejeu intégral
  échouait là-bas. Il n'y a plus de fichier d'origine : une fonction, un
  endroit.

Concernés à ce jour : `creances()`, `ma_dette()`, la vue `v_comptes_vendeurs`,
`revenus_vendeurs()`, `mes_ventes()`, `ventes_vendeur()`, `ventes_savables()`
et `dossiers_sav()`. Le contrôle qui l'attrape est gratuit : **`npm run test:db`**,
qui installe le schéma sur une base vide puis le rejoue deux fois.
