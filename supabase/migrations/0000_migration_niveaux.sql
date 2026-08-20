-- ============================================================
-- StockFlow — 0000_migration_niveaux.sql
-- PRÉ-MIGRATION : convertit une base créée avant les niveaux hiérarchiques.
-- ============================================================
--
-- Pourquoi un fichier `0000` plutôt qu'un `0011` : les migrations sont
-- rejouées DANS L'ORDRE à chaque exécution, et chaque objet doit avoir un seul
-- fichier propriétaire. Or convertir `profils.role` d'un enum vers du texte
-- impose de supprimer la vue `v_comptes_vendeurs` qui en dépend — vue dont le
-- propriétaire est 0007. Si la conversion vivait après 0007, il faudrait y
-- redéfinir la vue, donc la dupliquer.
--
-- En passant AVANT, ce fichier ne fait que défaire l'ancien modèle : 0001
-- recrée ensuite la structure, 0007 recrée sa vue. Aucun objet n'a deux
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
  -- type d'une colonne dont dépend une vue. 0007 la recréera.
  drop view if exists v_comptes_vendeurs;

  alter table profils     alter column role drop default;
  alter table invitations alter column role drop default;

  alter table profils     alter column role type text using role::text;
  alter table invitations alter column role type text using role::text;

  alter table profils     alter column role set default 'vendeur';
  alter table invitations alter column role set default 'vendeur';

  -- Le renommage : l'ancien sommet devient le niveau intermédiaire. `dev`
  -- s'ajoute au-dessus (voir 0001) et n'existe encore chez personne.
  update profils     set role = 'gerant' where role = 'admin';
  update invitations set role = 'gerant' where role = 'admin';

  -- Irréversible, et c'est justement l'intérêt : une valeur d'enum ne se
  -- supprimant pas, garder le type laisserait 'admin' disponible à jamais.
  drop type role_utilisateur;
end $$;
