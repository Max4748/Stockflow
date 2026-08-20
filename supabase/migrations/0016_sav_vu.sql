-- ============================================================
-- StockFlow — 0016_sav_vu.sql
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

comment on column profils.sav_vu_le is
  'Dernière ouverture de l''écran SAV par ce compte. Sert uniquement à la pastille de nouveauté, jamais à une décision d''autorisation.';

-- ------------------------------------------------------------
-- Marquer comme vu.
--
-- Une fonction est OBLIGATOIRE ici : `grant update on profils` existe bien
-- (0009), mais la policy `profils_admin_all` réserve l'écriture aux gérants —
-- un vendeur ne peut pas toucher sa propre ligne. Cette fonction est le seul
-- chemin, et elle n'écrit QUE `sav_vu_le`, QUE sur la ligne de l'appelant :
-- aucun autre champ n'est atteignable par ce biais.
-- ------------------------------------------------------------
create or replace function marquer_sav_vu()
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  update profils set sav_vu_le = now() where id = auth.uid();
end $$;

grant execute on function marquer_sav_vu() to authenticated;

-- ------------------------------------------------------------
-- Ce qui est nouveau POUR L'APPELANT.
--
-- Deux conditions, et la seconde est celle qui rend la pastille utile :
--
--   1. le dernier mouvement du dossier est postérieur à sa dernière visite ;
--   2. ce mouvement n'est PAS de son fait.
--
-- Sans (2), la pastille s'allumerait sur ses propres déclarations — il saurait
-- déjà, et elle deviendrait un bruit qu'on apprend à ignorer. Avec, elle ne
-- signale que ce qu'il n'a pas fait : une validation, un refus, ou un SAV
-- ouvert par le gérant sur une de ses ventes.
-- ------------------------------------------------------------
create or replace function sav_non_vus()
returns integer
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_vu  timestamptz;
  v_nb  int;
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  select p.sav_vu_le into v_vu from profils p where p.id = auth.uid();

  select count(*) into v_nb
    from sav s
    join ventes v on v.id = s.vente_id
   where v.vendeur_id = auth.uid()
     and coalesce(s.traite_le, s.cree_le) > coalesce(v_vu, '-infinity'::timestamptz)
     and coalesce(s.traite_par, s.cree_par) is distinct from auth.uid();

  return coalesce(v_nb, 0);
end $$;

grant execute on function sav_non_vus() to authenticated;

-- ------------------------------------------------------------
-- Les dossiers gagnent le « quand » et le « par qui » du traitement.
--
-- Sans ces deux colonnes l'écran du vendeur n'affiche qu'un statut nu, là où
-- « Refusé le 10/08 par Patron » se comprend sans explication.
-- ------------------------------------------------------------
drop function if exists dossiers_sav(int);
drop function if exists dossiers_sav(int, boolean);   -- arité ajoutée en 0018

create or replace function dossiers_sav(p_limite int default 100)
returns table (
  id            uuid,
  vente_id      uuid,
  date          date,
  statut        text,
  resolution    text,
  quantite      int,
  montant_rembourse numeric(12,2),
  motif         text,
  motif_refus   text,
  produit       text,
  client        text,
  vendeur       text,
  vendeur_id    uuid,
  declare_par   text,
  traite_par    text,
  traite_le     timestamptz,
  cree_le       timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not est_actif() then
    raise exception 'Compte inactif ou non authentifié.' using errcode = '42501';
  end if;

  return query
    select s.id, s.vente_id, s.date, s.statut, s.resolution, s.quantite,
           s.montant_rembourse, s.motif, s.motif_refus,
           p.nom, v.client, pr.nom, v.vendeur_id,
           coalesce(dp.nom, '—'),
           tp.nom,
           s.traite_le,
           s.cree_le
      from sav s
      join ventes   v  on v.id  = s.vente_id
      join profils  pr on pr.id = v.vendeur_id
      join produits p  on p.id  = s.produit_id
      left join profils dp on dp.id = s.cree_par
      left join profils tp on tp.id = s.traite_par
     where est_admin() or v.vendeur_id = auth.uid()
     -- En attente d'abord : c'est ce qui appelle une décision.
     order by (s.statut = 'en_attente') desc, s.cree_le desc
     limit least(greatest(coalesce(p_limite, 100), 1), 500);
end $$;

grant execute on function dossiers_sav(int) to authenticated;
