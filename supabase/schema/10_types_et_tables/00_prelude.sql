-- ============================================================
-- StockFlow — Préalables, avant toute création d'objet
-- ============================================================

-- ============================================================
-- Comptes, rôles, helpers d'autorisation.
-- ============================================================
-- Rejouable : create if not exists / create or replace partout.

-- Postgres accorde par défaut EXECUTE sur toute nouvelle fonction au rôle
-- PUBLIC. La clé anon étant publique par construction, chaque RPC créée
-- ensuite serait appelable par n'importe qui. On inverse ce défaut AVANT de
-- créer la moindre fonction : les GRANT explicites de la couche 40 seront la seule
-- porte d'entrée.
alter default privileges in schema public revoke execute on functions from public;

-- ------------------------------------------------------------
-- CONVERSION D'UNE BASE ANTÉRIEURE AUX NIVEAUX.
--
-- Ne fait rien si le type `role_utilisateur` n'existe pas, c'est-à-dire sur
-- toute base à jour et sur toute base vide. Sa place est ICI et nulle part
-- ailleurs : elle supprime `v_comptes_vendeurs` et change le type d'une
-- colonne, donc elle doit passer avant que la couche 30 ne recrée la vue.
-- Plus bas, elle laisserait la vue supprimée.
-- ------------------------------------------------------------

-- ============================================================
-- PRÉ-MIGRATION : convertit une base créée avant les niveaux hiérarchiques.
-- ============================================================
--
-- Pourquoi dans le prélude, avant tout le reste : convertir `profils.role` d'un
-- enum vers du texte impose de supprimer la vue `v_comptes_vendeurs` qui en
-- dépend. Placée plus bas, la conversion supprimerait une vue que la couche 30
-- a déjà recréée, et la laisserait supprimée.
--
-- En passant AVANT, elle ne fait que défaire l'ancien modèle : la couche 10
-- recrée ensuite la structure, la couche 30 recrée la vue. Aucun objet n'a deux
-- définitions.
--
-- Ce fichier est ENTIÈREMENT gardé : sur une base neuve il ne fait rien.

do $$
begin
  -- Rien à convertir si l'ancien type n'existe pas (base neuve, ou migration
  -- déjà passée).
  if not exists (select 1 from pg_type where typname = 'role_utilisateur') then
    raise notice 'niveaux : rien à convertir';
    return;
  end if;

  raise notice 'niveaux : conversion de role_utilisateur vers texte';

  -- La vue expose profils.role typé en enum : Postgres refuse d'altérer le
  -- type d'une colonne dont dépend une vue. la couche 30 la recréera.
  drop view if exists v_comptes_vendeurs;

  alter table profils     alter column role drop default;
  alter table invitations alter column role drop default;

  alter table profils     alter column role type text using role::text;
  alter table invitations alter column role type text using role::text;

  alter table profils     alter column role set default 'vendeur';
  alter table invitations alter column role set default 'vendeur';

  -- Le renommage : l'ancien sommet devient le niveau intermédiaire. `dev`
  -- s'ajoute au-dessus et n'existe encore chez personne.
  update profils     set role = 'gerant' where role = 'admin';
  update invitations set role = 'gerant' where role = 'admin';

  -- Irréversible, et c'est justement l'intérêt : une valeur d'enum ne se
  -- supprimant pas, garder le type laisserait 'admin' disponible à jamais.
  drop type role_utilisateur;
end $$;
