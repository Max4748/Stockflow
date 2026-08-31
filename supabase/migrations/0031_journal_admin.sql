-- ============================================================
-- StockFlow — 0031_journal_admin.sql
-- Qui a fait quoi sur les comptes.
-- ============================================================
-- Les sept fonctions qui touchent un compte n'écrivaient aucune trace. Créer
-- un accès, changer un rôle, désactiver quelqu'un : rien ne restait de qui
-- l'avait fait ni de ce qu'il y avait avant. Sur un dispositif à plusieurs
-- gérants, c'est l'angle mort qui rend un désaccord insoluble.
--
-- DEUX PROPRIÉTÉS, et elles se tiennent :
--
--   La trace est écrite DANS LA MÊME TRANSACTION que l'action. Si l'insertion
--   échoue, l'action échoue avec elle. Une trace « au mieux » est une trace
--   absente le jour où elle compte.
--
--   La valeur AVANT est relevée avant l'`update`, sans quoi elle est déjà
--   perdue. C'est le seul point délicat des sept, et la raison pour laquelle
--   chaque fonction est réécrite plutôt qu'enveloppée dans un trigger : un
--   trigger sur `profils` verrait le changement, mais pas l'INTENTION (quelle
--   fonction, quel motif), ni les actions qui n'écrivent pas dans `profils`,
--   comme l'invitation.
--
-- Lecture réservée au dev : la liste dit qui surveille qui, et n'a rien à
-- faire sous les yeux d'un gérant surveillé.
-- ------------------------------------------------------------

create table if not exists journal_admin (
  id        uuid primary key default gen_random_uuid(),
  cree_le   timestamptz not null default now(),
  -- `set null` et non `restrict` : retirer un compte ne doit pas être empêché
  -- par les traces qu'il a laissées, et une trace sans acteur reste lisible
  -- grâce à `acteur_nom`.
  acteur    uuid references profils(id) on delete set null,
  acteur_nom text,
  cible     uuid references profils(id) on delete set null,
  cible_nom text,
  action    text not null,
  avant     jsonb,
  apres     jsonb
);

comment on table journal_admin is
  'Trace des actions d''administration de comptes. Écriture par tracer_admin() uniquement, lecture réservée au dev.';

create index if not exists idx_journal_admin_date on journal_admin (cree_le desc);

alter table journal_admin enable row level security;

drop policy if exists journal_admin_select on journal_admin;
create policy journal_admin_select on journal_admin
  for select using (est_dev());

grant select on journal_admin to authenticated;
revoke insert, update, delete on journal_admin from authenticated, anon;

-- ------------------------------------------------------------
-- Le seul chemin d'écriture.
--
-- Les NOMS sont copiés à côté des identifiants. Les clés étrangères passent à
-- NULL quand un compte est retiré : sans cette copie, la trace de sa
-- suppression perdrait justement le nom de qui a été supprimé.
-- ------------------------------------------------------------
create or replace function tracer_admin(
  p_action text,
  p_cible  uuid default null,
  p_avant  jsonb default null,
  p_apres  jsonb default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into journal_admin (acteur, acteur_nom, cible, cible_nom, action, avant, apres)
  values (
    auth.uid(),
    (select nom from profils where id = auth.uid()),
    p_cible,
    (select nom from profils where id = p_cible),
    p_action, p_avant, p_apres
  );
end $$;

-- Pas de `grant execute` à authenticated : la fonction n'est appelée que par
-- d'autres fonctions `security definer`, qui s'exécutent avec les droits du
-- propriétaire. L'exposer permettrait de forger une trace.
revoke execute on function tracer_admin(text, uuid, jsonb, jsonb) from public, authenticated, anon;

-- ------------------------------------------------------------
-- Lecture, réservée au dev.
-- ------------------------------------------------------------
create or replace function journal_admin(
  p_du      date default null,
  p_au      date default null,
  p_limite  int  default 100,
  p_offset  int  default 0
)
returns table (
  cree_le    timestamptz,
  acteur     text,
  action     text,
  cible      text,
  avant      jsonb,
  apres      jsonb
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_dev() then
    raise exception 'Réservé au propriétaire technique.' using errcode = '42501';
  end if;

  return query
    select j.cree_le,
           coalesce(j.acteur_nom, '(compte retiré)'),
           j.action,
           j.cible_nom,
           j.avant, j.apres
      from journal_admin j
     where (p_du is null or j.cree_le::date >= p_du)
       and (p_au is null or j.cree_le::date <= p_au)
     order by j.cree_le desc
     limit least(greatest(coalesce(p_limite, 100), 1), 500)
    offset greatest(coalesce(p_offset, 0), 0);
end $$;

grant execute on function journal_admin(date, date, int, int) to authenticated;
