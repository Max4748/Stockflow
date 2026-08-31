-- ============================================================
-- StockFlow — 0035_journal_operations.sql
-- Ce qui est supprimé laisse une trace.
-- ============================================================
-- Le journal comptable est DÉRIVÉ de l'état courant : il lit `ventes`,
-- `restocks`, `versements`, `sav`. Conséquence directe, tout ce qu'une
-- suppression retire disparaît aussi du journal. Un achat de 345 € annulé, un
-- versement effacé, un SAV supprimé : le total change et rien n'explique
-- pourquoi.
--
-- Les ventes annulées avaient déjà leur réponse (`ventes_annulees`, 0029), mais
-- elle était propre aux ventes. Six autres opérations restaient muettes.
--
-- POURQUOI UNE TABLE PLUTÔT QU'UNE ARCHIVE PAR ENTITÉ. Archiver chaque type
-- supprimé demanderait une table jumelle par table, et six de plus à tenir à
-- jour. Ici on n'archive pas l'entité, on enregistre le GESTE : qui, quoi,
-- quand, et de quoi il s'agissait. C'est ce que le journal a besoin d'afficher,
-- et ça ne dépend pas de la forme de l'entité.
--
-- POURQUOI PAS `journal_admin`. Celui-là est réservé au dev, parce qu'il dit
-- qui surveille qui. Un achat annulé regarde tout l'encadrement : c'est une
-- opération comptable, pas une action d'administration. D'où deux tables, deux
-- portées, et deux écrans.
-- ------------------------------------------------------------

create table if not exists journal_operations (
  id        uuid primary key default gen_random_uuid(),
  cree_le   timestamptz not null default now(),
  acteur    uuid references profils(id) on delete set null,
  acteur_nom text,
  -- Le type d'entité et son identifiant d'ORIGINE. L'entité n'existe
  -- généralement plus : l'identifiant sert à relier la trace aux mouvements de
  -- stock, qui le citent dans leur motif.
  entite    text not null,
  entite_id uuid,
  action    text not null,
  -- Rédigé au moment du geste, quand l'entité existe encore. Le reconstruire
  -- après coup serait impossible, c'est tout l'objet de cette table.
  libelle   text not null,
  quantite  int,
  montant   numeric(12,2),
  detail    jsonb
);

comment on table journal_operations is
  'Trace des opérations qui effacent ou corrigent une écriture. Le journal comptable étant dérivé de l''état courant, sans elle une suppression est invisible.';

create index if not exists idx_journal_operations_date
  on journal_operations (cree_le desc);

alter table journal_operations enable row level security;

-- Lisible par l'encadrement, comme le journal comptable qu'elle complète.
drop policy if exists journal_operations_select on journal_operations;
create policy journal_operations_select on journal_operations
  for select using (est_admin());

grant select on journal_operations to authenticated;
revoke insert, update, delete on journal_operations from authenticated, anon;

-- ------------------------------------------------------------
-- Le seul chemin d'écriture. Non exposé : appelé uniquement depuis d'autres
-- fonctions `security definer`, comme `tracer_admin`. L'ouvrir permettrait de
-- forger une écriture comptable.
-- ------------------------------------------------------------
create or replace function tracer_operation(
  p_entite    text,
  p_entite_id uuid,
  p_action    text,
  p_libelle   text,
  p_quantite  int     default null,
  p_montant   numeric default null,
  p_detail    jsonb   default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into journal_operations (acteur, acteur_nom, entite, entite_id,
                                  action, libelle, quantite, montant, detail)
  values (auth.uid(),
          (select nom from profils where id = auth.uid()),
          p_entite, p_entite_id, p_action, p_libelle,
          p_quantite, p_montant, p_detail);
end $$;

revoke execute on function tracer_operation(text, uuid, text, text, int, numeric, jsonb)
  from public, authenticated, anon;
