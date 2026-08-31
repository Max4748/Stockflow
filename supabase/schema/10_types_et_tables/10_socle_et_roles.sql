-- ============================================================
-- StockFlow — Socle : rôles, profils, invitations
-- ============================================================

-- ------------------------------------------------------------
-- Les rôles sont de la DONNÉE, pas du schéma.
--
-- Un enum aurait suffi pour deux rôles, mais une valeur d'enum Postgres ne se
-- supprime pas : renommer ou retirer un niveau devient impossible. Avec une
-- table, ajouter un quatrième niveau demain ne coûte plus une migration.
--
-- `niveau` porte la hiérarchie, et c'est ce qui rend les contrôles triviaux :
-- on ne gère jamais qu'un niveau STRICTEMENT inférieur au sien.
-- ------------------------------------------------------------
create table if not exists roles (
  cle     text primary key,
  libelle text not null,
  niveau  int  not null unique
);

-- ------------------------------------------------------------
-- profils : le rôle vit ICI, jamais dans un claim JWT.
-- Un claim est figé pour la durée du jeton (1 h) : rétrograder ou désactiver
-- un vendeur ne prendrait effet qu'à l'expiration. Une lecture en base est
-- immédiate.
-- ------------------------------------------------------------
create table if not exists profils (
  id                  uuid primary key references auth.users(id) on delete cascade,
  nom                 text not null,
  role                text not null default 'vendeur',
  -- Commission acquise par le vendeur, par unité vendue. Copiée dans la ligne
  -- de vente à l'enregistrement : la modifier ici ne réécrit aucune dette
  -- passée (voir le figeage comptable).
  commission_unitaire numeric(10,2) not null default 0 check (commission_unitaire >= 0),
  -- Un compte naît INACTIF : aucun accès tant que l'admin ne l'a pas activé.
  -- Toutes les gardes vérifient `actif`, jamais le rôle seul.
  actif               boolean not null default false,
  doit_changer_mdp    boolean not null default false,
  cree_le             timestamptz not null default now()
);

-- ------------------------------------------------------------
-- invitations : pré-autorise un email avant sa première connexion.
-- Sans invitation, un compte créé reste actif=false et n'a accès à rien.
-- ------------------------------------------------------------
create table if not exists invitations (
  email               text primary key,
  nom                 text not null,
  role                text not null default 'vendeur',
  commission_unitaire numeric(10,2) not null default 0 check (commission_unitaire >= 0),
  utilisee            boolean not null default false,
  doit_changer_mdp    boolean not null default true,
  cree_le             timestamptz not null default now()
);

-- ============================================================
-- « Du nouveau sur mes SAV depuis ma dernière visite ? »
-- ============================================================
--
-- Un vendeur déclarait un SAV et n'apprenait jamais ce qu'il devenait : un
-- dossier validé ou refusé disparaissait simplement de son écran. Un écran
-- dédié règle la moitié du problème ; l'autre moitié est qu'il faut y penser.
-- D'où une pastille sur l'onglet, allumée seulement s'il s'est passé quelque
-- chose qu'il n'a pas vu.

-- ------------------------------------------------------------
-- La date de dernière consultation.
--
-- Une colonne sur `profils` plutôt qu'un état par dossier : la question posée
-- est « du nouveau depuis quand ? », pas « ce dossier précis a-t-il été lu ? ».
-- Un état par dossier coûterait une table de liaison pour une pastille.
-- ------------------------------------------------------------
alter table profils add column if not exists sav_vu_le timestamptz;

-- ============================================================
-- Le gérant voit, et révoque sans effacer.
-- ============================================================
--
-- CE QUE CE FICHIER CORRIGE. Un vendeur déclare un échange, qui prend effet
-- immédiatement : c'est le bon arbitrage, il a déjà remis l'unité au
-- client et refuser de l'écrire ferait mentir son stock. Le contrepoids annoncé
-- était « le gérant garde un recours ». Ce recours existait — `supprimer_sav()`
-- — mais il souffrait de deux défauts qui le rendaient inopérant en
-- pratique :
--
--   1. RIEN N'AVERTISSAIT LE GÉRANT. `sav_non_vus()` filtre sur
--      `ventes.vendeur_id = auth.uid()` : c'est la pastille du VENDEUR. Côté
--      gestion, aucun signal. Le recours supposait que le gérant pense de
--      lui-même à ouvrir l'écran.
--
--   2. LE SEUL RECOURS DÉTRUISAIT LA PREUVE. `supprimer_sav()` fait un `delete`
--      sec : le stock revient, mais le dossier disparaît avec son motif, sa
--      date et son auteur. Or ce qui caractérise un abus n'est pas un incident,
--      c'est un MOTIF RÉPÉTÉ. Plus le gérant faisait son travail, moins il lui
--      restait de trace.
--
-- Le principe appliqué ici est déjà celui de `declarer_sav` pour un remboursement
-- refusé : « un refus est CONSERVÉ plutôt que supprimé, il fait partie de la
-- relation avec le vendeur ». Un échange abusif mérite le même traitement.
--
-- `supprimer_sav()` n'est pas retirée : elle garde son usage d'origine, la
-- saisie franchement erronée qu'on ne veut pas voir traîner dans l'historique.

-- ------------------------------------------------------------
-- La date de dernière consultation CÔTÉ GESTION.
--
-- Une seconde colonne plutôt que la réutilisation de `sav_vu_le` : un gérant
-- qui vend aussi utilise déjà celle-là dans son espace vendeur. Les
-- confondre éteindrait la pastille de gestion parce qu'il a consulté ses
-- propres dossiers — deux questions distinctes, deux colonnes.
-- ------------------------------------------------------------
alter table profils add column if not exists sav_gestion_vu_le timestamptz;

-- ============================================================
-- Un gérant dont le stock EST l'entrepôt.
-- ============================================================
-- Cas réel : l'entrepôt est chez le gérant. Lui faire transférer du stock
-- vers lui-même avant chaque vente est une écriture qui ne décrit aucun
-- déplacement — la marchandise n'a pas bougé d'un mètre.
--
-- Mais ce n'est pas vrai de tous les gérants : un second, sur le terrain,
-- reçoit du stock comme un vendeur. D'où un drapeau PAR COMPTE, et non un
-- réglage global qui serait faux pour l'un des deux.
--
-- CE QUE LE DRAPEAU CHANGE, et rien d'autre :
--   • `stock_disponible()` lit l'entrepôt au lieu du stock détenu ;
--   • `enregistrer_vente()` prend dans l'entrepôt ce qui manque, en écrivant
--     le transfert lui-même.
--
-- CE QU'IL NE CHANGE PAS, délibérément : le SAV (`declarer_sav` a déjà son
-- `p_depuis_entrepot`), la dette (elle vaut déjà 0 pour un
-- non-vendeur), et l'attribution des ventes — elles restent les SIENNES,
-- seule la source du stock diffère.
--
-- LE TRANSFERT EST ÉCRIT, PAS CONTOURNÉ. La contrainte `mvt_coherence`
-- impose qu'une vente sorte d'un détenteur nommé. L'assouplir
-- pour ce cas aurait affaibli un invariant qui tient pour tout le monde, afin
-- d'épargner deux lignes au registre. Le geste disparaît de l'écran du
-- gérant ; il reste dans le journal, où il décrit exactement ce qui s'est
-- passé : la marchandise a quitté l'entrepôt, puis le client l'a emportée.
-- ------------------------------------------------------------

alter table profils
  add column if not exists stock_lie_entrepot boolean not null default false;

-- Un vendeur n'a jamais accès à l'entrepôt : le drapeau n'a de sens que pour
-- l'encadrement. La contrainte le garantit même si une future rétrogradation
-- oubliait de le baisser — et `changer_role` le baisse, plus bas.
alter table profils drop constraint if exists profils_stock_lie_encadrement;

alter table profils add constraint profils_stock_lie_encadrement
  check (not stock_lie_entrepot or role <> 'vendeur');

-- ------------------------------------------------------------
-- 2. Activation de la RLS. Une table sans RLS activée est ouverte à tout
--    détenteur d'un GRANT : l'oubli ne produit aucune erreur.
-- ------------------------------------------------------------
alter table profils          enable row level security;

alter table invitations      enable row level security;

-- ------------------------------------------------------------
-- Privilèges. `roles` est en lecture pour tous les comptes authentifiés : le
-- libellé d'un rôle n'est pas une information sensible, et l'interface en a
-- besoin pour ses listes déroulantes.
-- ------------------------------------------------------------
alter table roles enable row level security;

-- Clés étrangères posées à part : `create table if not exists` ne les
-- ajouterait pas sur une table déjà créée par une version antérieure.
do $$ begin
  alter table profils add constraint profils_role_fk
    foreign key (role) references roles(cle);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table invitations add constraint invitations_role_fk
    foreign key (role) references roles(cle);
exception when duplicate_object then null; end $$;

