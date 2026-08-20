# Modèle de données et règles comptables

13 tables, 4 vues, 57 fonctions, 20 politiques RLS. Le SQL fait référence : les
migrations sont commentées et se lisent dans l'ordre.

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
dû = Σ(montant des ventes) − Σ(qté × commission figée) − Σ(versements)
```

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

### Comment le gérant apprend qu'il s'est passé quelque chose

Le même mécanisme, symétrique, ajouté en `0019`. Il manquait, et c'est ce qui
rendait le recours du gérant théorique : `sav_non_vus()` filtre sur
`ventes.vendeur_id = auth.uid()`, autrement dit c'est la pastille du **vendeur**.
Côté gestion, un échange déclaré par un vendeur ne produisait aucun signal,
puisqu'il est validé d'emblée et n'attend donc aucune décision.

`sav_gestion_non_vus()` reprend les deux conditions de `0016` et en change deux
autres :

| | Pastille vendeur (`0016`) | Pastille gestion (`0019`) |
| --- | --- | --- |
| Périmètre | ses ventes à lui | **tous** les vendeurs |
| Statuts comptés | tous | **`valide` seulement** |
| Colonne de visite | `profils.sav_vu_le` | `profils.sav_gestion_vu_le` |

Deux colonnes distinctes parce qu'un gérant vend aussi (`0013`) : les confondre
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

## Ordre des migrations

22 fichiers, **rejoués intégralement dans l'ordre à chaque exécution** :
`create table if not exists`, `create or replace`, `drop policy if exists`.

| Fichier                        | Contenu                                                                   |
| ------------------------------ | ------------------------------------------------------------------------- |
| `0000_migration_niveaux`       | pré-migration gardée : convertit une base d'avant les niveaux             |
| `0001_socle`                   | rôles, profils, invitations, helpers, trigger d'inscription               |
| `0002_catalogue`               | produits                                                                  |
| `0003_transactions`            | DDL pure des écritures                                                    |
| `0004_mouvements_stock`        | le registre, index, vues de stock, CUMP                                   |
| `0005_ecritures`               | achat, vente, retour, ajustement                                          |
| `0006_demandes`                | création, annulation, traitement des réassorts                            |
| `0007_dette`                   | créances et versements                                                    |
| `0008_lectures`                | stock, bilan, journal, audit                                              |
| `0009_rls_privileges`          | **toute** la posture de sécurité, en un bloc relisible                    |
| `0010_seed`                    | invitation du compte dev                                                  |
| `0011_comptes`                 | gestion des comptes, ferme l'escalade de privilèges                       |
| `0012_correction_ventes`       | fenêtre de correction                                                     |
| `0013_encadrement_vend`        | transfert direct de stock, l'encadrement qui vend entre dans les tableaux |
| `0014_sav`                     | défaillances rattachées à leur vente, et leur répercussion comptable      |
| `0015_sav_vendeur`             | le vendeur déclare ; échange immédiat, remboursement arbitré              |
| `0016_sav_vu`                  | le vendeur suit ses dossiers, pastille de nouveauté                       |
| `0017_savables_horodatage`     | l'heure de saisie, pour distinguer deux ventes du même jour               |
| `0018_totaux_et_cloisonnement` | totaux du stock calculés en SQL, espace vendeur cloisonné                 |
| `0019_sav_revocation`          | pastille SAV côté gestion, révocation d'un dossier validé sans l'effacer  |
| `0020_index_origines`          | index sur les clés d'origine de `mouvements_stock` (cascades et suppressions ciblées) |
| `0021_sav_vu_borne`            | les pastilles SAV enregistrent « vu jusqu'à », pas « vu maintenant » |

Trois points de séquencement non arbitraires :

- `0000` passe **avant** tout : convertir `profils.role` impose de supprimer la
  vue qui en dépend, dont le propriétaire est `0007`. En passant avant, ce
  fichier ne fait que défaire l'ancien modèle, aucun objet n'ayant deux
  définitions.
- `0003` avant `0004` : le registre référence les quatre tables d'écriture, ses
  clés étrangères et ses `CHECK` multi-colonnes se déclarent d'un bloc.
- `0009` regroupe la posture de sécurité : la base reste fermée pendant toute
  l'installation, et ce fichier répond à « qui peut faire quoi ». Les migrations
  postérieures reposent leur propre `grant execute` juste après la fonction
  concernée. Une fonction ajoutée après coup sans son grant ne serait appelable
  par personne.

### Changer les colonnes de sortie d'une fonction

`create or replace` **ne peut pas** modifier les paramètres `OUT` d'une fonction
(« cannot change return type of existing function »). Il faut la droper. Deux
conséquences, apprises en rejouant les migrations :

1. le `drop` emporte le `grant execute` : la migration qui recrée la fonction
   doit **reposer le grant** ;
2. le fichier d'**origine** doit lui aussi gagner un
   `drop function if exists …(signature)` avant son `create`, sinon le rejeu
   intégral échoue à ce fichier, la version en base étant déjà la nouvelle.

Même piège pour une **vue** : `create or replace view` ne sait qu'ajouter des
colonnes _en fin de liste_, et refuse d'en renommer une. Une colonne insérée au
milieu impose un `drop view` dans les deux fichiers.

Concernés à ce jour : `creances()` et `ma_dette()` (`0007`), la vue
`v_comptes_vendeurs` (`0007`), `revenus_vendeurs()` (`0008`), `mes_ventes()`
(`0012`), `ventes_vendeur()` et `ventes_savables()` (`0014`), `dossiers_sav()`
(`0015`). Le contrôle qui l'attrape est gratuit : **lancer le script de
migration deux fois de suite.**
